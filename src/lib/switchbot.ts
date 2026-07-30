/**
 * SwitchBot Open API v1.1 クライアント（キーパッドの時限パスコード発行・削除）
 *
 * トレーラー等の予約に対し、予約開始〜終了だけ有効な使い捨てパスコード（type=timeLimit）を発行する。
 * - 管理者用の永続パスコード（permanent）には一切触れない（timeLimit の作成/削除のみ）。
 * - 認証: sign = base64(HMAC-SHA256(token + t + nonce, secret)).toUpperCase()
 *   ヘッダ: Authorization=<token> / sign / t(13桁ms) / nonce(UUID)
 *
 * ⚠️ 2026-07-30 の実機検証で判明した API の実仕様（ドキュメントだけでは分からず、
 *    以前の実装は3点すべて誤っていた。壊さないこと）:
 *
 *  1. **createKey / deleteKey は Keypad のコマンド。Smart Lock に送ると `160 unknown command`。**
 *     施設設定の `switchBotDeviceId` にロックのIDが入っていても動くよう、
 *     `resolveKeypad()` が `lockDeviceId` を辿って Keypad に読み替える。
 *  2. **startTime / endTime は Unix epoch「秒」（10桁）。** ミリ秒を渡すと数万年後の
 *     有効期間として登録され、パスコードは永久に使えない（作成自体は成功するので気づけない）。
 *  3. **createKey の応答ボディは空 `{}` で keyId を返さない。**（結果は webhook で非同期通知される）
 *     削除に必要な id は `GET /v1.1/devices` の Keypad の `keyList` から **name で引く**。
 *     そのため `name` は端末内で一意でなければならない（重複作成は API が拒否する）。
 *
 * 参考: https://github.com/OpenWonderLabs/SwitchBotAPI/blob/main/devices/locks-security/keypad.md
 */

import { createHmac, randomUUID, randomInt } from "crypto";

const API_BASE = "https://api.switch-bot.com/v1.1";

function getCreds(): { token: string; secret: string } {
  const token = process.env.SWITCHBOT_TOKEN ?? "";
  const secret = process.env.SWITCHBOT_SECRET ?? "";
  if (!token || !secret) {
    throw new Error("[switchbot] SWITCHBOT_TOKEN / SWITCHBOT_SECRET が未設定です");
  }
  return { token, secret };
}

/**
 * 認証ヘッダを生成する（純粋関数・テスト容易化のため t/nonce を注入可能）。
 */
export function buildAuthHeaders(
  token: string,
  secret: string,
  t: number,
  nonce: string
): Record<string, string> {
  const sign = createHmac("sha256", secret)
    .update(`${token}${t}${nonce}`)
    .digest("base64")
    .toUpperCase();
  return {
    Authorization: token,
    sign,
    t: String(t),
    nonce,
    "Content-Type": "application/json; charset=utf-8",
  };
}

/** 6桁の数字パスコードを生成（予約ごとに使い捨て。先頭ゼロ許容）。 */
export function generatePasscode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

interface SwitchBotResponse {
  statusCode?: number;
  message?: string;
  body?: Record<string, unknown>;
}

/** Keypad の keyList の1件。`deleteKey` に必要な id はここからしか取れない。 */
export interface SwitchBotKey {
  id: number;
  name: string;
  type: string;   // permanent / timeLimit / disposable / urgent
  status: string; // normal 等
}

interface SwitchBotDevice {
  deviceId: string;
  deviceName?: string;
  deviceType?: string;
  /** Keypad のみ: 紐づくスマートロックの deviceId */
  lockDeviceId?: string;
  /** Keypad のみ: 登録済みパスコード一覧 */
  keyList?: SwitchBotKey[];
}

/** 署名付きで API を叩く共通処理。statusCode=100 以外は throw。 */
async function callApi(
  path: string,
  init: { method: "GET" | "POST"; body?: string }
): Promise<Record<string, unknown>> {
  const { token, secret } = getCreds();
  const headers = buildAuthHeaders(token, secret, Date.now(), randomUUID());
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as SwitchBotResponse;
  if (!res.ok || json.statusCode !== 100) {
    throw new Error(
      `[switchbot] ${init.method} ${path} failed: status=${json.statusCode ?? res.status} ${json.message ?? ""}`
    );
  }
  return json.body ?? {};
}

/** デバイスにコマンドを送る。statusCode=100 以外は throw。 */
async function sendCommand(
  deviceId: string,
  command: { command: string; parameter: unknown }
): Promise<Record<string, unknown>> {
  return callApi(`/devices/${encodeURIComponent(deviceId)}/commands`, {
    method: "POST",
    body: JSON.stringify({ commandType: "command", ...command }),
  });
}

/** 物理デバイス一覧を取得する（Keypad の keyList / lockDeviceId を含む）。 */
async function getDeviceList(): Promise<SwitchBotDevice[]> {
  const body = await callApi("/devices", { method: "GET" });
  const list = body.deviceList;
  return Array.isArray(list) ? (list as SwitchBotDevice[]) : [];
}

/**
 * パスコードを書き込む対象の Keypad を解決する。
 *
 * 施設設定 `switchBotDeviceId` には Keypad でも Smart Lock でも入れてよい
 * （運用ドキュメントが長らくロックのIDを指示していたため、両方受け付ける）。
 * ロックのIDが来たら `lockDeviceId` が一致する Keypad に読み替える。
 *
 * @returns Keypad の deviceId と、その時点の登録済みパスコード一覧
 */
export async function resolveKeypad(
  configuredDeviceId: string
): Promise<{ keypadDeviceId: string; keys: SwitchBotKey[] }> {
  const devices = await getDeviceList();

  const exact = devices.find((d) => d.deviceId === configuredDeviceId);
  if (exact?.deviceType === "Keypad" || exact?.keyList) {
    return { keypadDeviceId: exact.deviceId, keys: exact.keyList ?? [] };
  }

  // ロック（や Hub）のIDが設定されている場合: それに紐づく Keypad を探す
  const linked = devices.find((d) => d.lockDeviceId === configuredDeviceId);
  if (linked) {
    return { keypadDeviceId: linked.deviceId, keys: linked.keyList ?? [] };
  }

  throw new Error(
    `[switchbot] deviceId "${configuredDeviceId}" に対応する Keypad が見つかりません` +
      "（施設設定の SwitchBotデバイスID を確認してください）"
  );
}

/** 指定 name のパスコードを keyList から探す。 */
function findKeyByName(keys: SwitchBotKey[], name: string): SwitchBotKey | undefined {
  return keys.find((k) => k.name === name);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * createKey 後に keyList へ反映されるまでの待ち時間（累積 ~13秒）。
 * 実機では約5秒で現れた。短すぎると keyId が取れず自動失効できなくなる。
 */
export const KEY_LOOKUP_DELAYS_MS = [2000, 2000, 3000, 3000, 3000];

/** epoch ms → SwitchBot が要求する epoch 秒（10桁）。 */
export function toEpochSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/**
 * 有効期間の前後に足すグレース（分）。**端末の時計ずれを吸収するために必須**。
 *
 * 実機検証（2026-07-30）: `startTime = 予約開始ちょうど` の窓は**パスコードが機能しない**。
 * 作成もクラウド登録もアプリ表示も成功し `status` は `normal` なのに、キーパッドで通らない。
 * キーパッドの時計がクラウドより数分遅れているため、端末視点では「まだ開始前」になる。
 *   - ±24時間の窓 → 解錠できた
 *   - **±5分の窓 → 解錠できた**（＝ずれは5分未満）
 *   - 開始=現在・終了=+5/20/60分の窓 → **すべて解錠できなかった**
 * 5分で足りているが、電池消耗によるドリフトを見込んで倍の余裕を取る。
 *
 * ⚠️ これは「予約時間外にも解錠できる時間」そのもの。安全側に広げすぎないこと。
 *    利用者に見せる有効期限（`switchBotPasscodeExpiresAt`）は**予約終了そのまま**にし、
 *    グレースは端末に書く窓だけに適用する（案内と課金の整合を崩さない）。
 */
export const PASSCODE_GRACE_MINUTES = 10;
const GRACE_SEC = PASSCODE_GRACE_MINUTES * 60;

export interface IssuedPasscode {
  /**
   * deleteKey 用のキーID。**null になり得る**。
   * createKey は id を返さないので keyList から name で引くが、反映は非同期なので
   * 取り切れないことがある。その場合もパスコード自体は有効なので発行は成功扱いにし、
   * 「後から自動失効できない」ことだけ呼び出し側が管理者へ知らせる。
   */
  keyId: number | null;
  /** 実際に書き込んだ Keypad の deviceId（施設設定がロックIDでも解決済み） */
  keypadDeviceId: string;
}

/**
 * 時限パスコードを発行する（type=timeLimit / startTime〜endTime のみ有効）。
 *
 * `name` は端末内で一意でなければならない（API が重複を拒否する）。予約IDを渡す想定。
 * 同名が既にあれば作成せずそれを返す（＝冪等。リトライで重複を作らない）。
 */
export async function issueTimeLimitPasscode(params: {
  deviceId: string;
  name: string;       // 識別名（例: 予約ID）。端末内で一意
  password: string;   // 数字パスコード（generatePasscode）
  startMs: number;    // 有効開始（epoch ms）= 予約開始
  endMs: number;      // 有効終了（epoch ms）= 予約終了
  /** keyList 反映待ちの間隔（テストで 0 を注入するため。既定 KEY_LOOKUP_DELAYS_MS） */
  lookupDelaysMs?: number[];
}): Promise<IssuedPasscode> {
  const { keypadDeviceId, keys } = await resolveKeypad(params.deviceId);

  // 既に同名がある（前回の試行が実際は成功していた等）ならそれを使う。
  const existing = findKeyByName(keys, params.name);
  if (existing) {
    return { keyId: existing.id, keypadDeviceId };
  }

  await sendCommand(keypadDeviceId, {
    command: "createKey",
    parameter: {
      name: params.name,
      type: "timeLimit",
      password: params.password,
      // ⚠️ 秒。ms を渡すと有効期間が数万年後になりパスコードが使えない
      // ⚠️ 前後に GRACE を足す。ちょうど予約時間の窓だと端末の時計ずれで解錠できない
      //    （PASSCODE_GRACE_MINUTES のコメント参照。実機で確認済み）
      startTime: toEpochSeconds(params.startMs) - GRACE_SEC,
      endTime: toEpochSeconds(params.endMs) + GRACE_SEC,
    },
  });

  // createKey は id を返さないので keyList から引く。
  // ⚠️ 反映は非同期で、実機では **約5秒** かかった（2026-07-30 検証）。
  //    3.6秒で諦めていたら keyId が取れず「キャンセルしても失効できない予約」になったので、
  //    ここは十分に待つこと。合計 ~13秒（決済完了フローの許容範囲）。
  for (const waitMs of params.lookupDelaysMs ?? KEY_LOOKUP_DELAYS_MS) {
    await sleep(waitMs);
    try {
      const { keys: fresh } = await resolveKeypad(params.deviceId);
      const created = findKeyByName(fresh, params.name);
      if (created) return { keyId: created.id, keypadDeviceId };
    } catch {
      // 一覧取得の一時失敗は無視して再試行（パスコード自体は作成済み）
    }
  }

  // id は取れなかったが、パスコードは有効。発行成功として扱う。
  return { keyId: null, keypadDeviceId };
}

/**
 * 時限パスコードを削除する（予約キャンセル時の即時無効化）。
 * deviceId は施設設定の値（ロックIDでもよい）。内部で Keypad に解決する。
 */
export async function deletePasscode(deviceId: string, keyId: number): Promise<void> {
  const { keypadDeviceId } = await resolveKeypad(deviceId);
  await sendCommand(keypadDeviceId, {
    command: "deleteKey",
    parameter: { id: keyId },
  });
}

/**
 * 指定 name のパスコードを削除する（無ければ何もしない）。
 *
 * 再発行の前処理に使う。`issueTimeLimitPasscode` は同名キーがあると**作成せず既存を返す**ので、
 * 先に name で消しておかないと「新しいコードを保存したのに端末には書かれていない」状態になる。
 * `switchBotKeyId` が保存されていないケース（keyId 未取得）でも確実に消せる。
 *
 * @returns 削除したキーの id（無ければ null）。permanent は対象にしない。
 */
export async function deletePasscodeByName(
  deviceId: string,
  name: string
): Promise<number | null> {
  const { keypadDeviceId, keys } = await resolveKeypad(deviceId);
  const target = findKeyByName(keys, name);
  // 管理者用の永続パスコードには絶対に触れない
  if (!target || target.type === "permanent") return null;
  await sendCommand(keypadDeviceId, {
    command: "deleteKey",
    parameter: { id: target.id },
  });
  return target.id;
}

/**
 * 発行をリトライ付きで実行する（要件: 数回リトライ→なお失敗なら呼び出し側で管理者通知）。
 * `issueTimeLimitPasscode` が同名を再利用するので、リトライで重複パスコードは作られない。
 */
export async function issueTimeLimitPasscodeWithRetry(
  params: Parameters<typeof issueTimeLimitPasscode>[0],
  attempts = 3
): Promise<IssuedPasscode> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await issueTimeLimitPasscode(params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("[switchbot] 発行に失敗しました");
}
