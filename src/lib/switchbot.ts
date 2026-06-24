/**
 * SwitchBot Open API v1.1 クライアント（キーパッド/ロックの時限パスコード発行・削除）
 *
 * トレーラー等の予約に対し、予約開始〜終了だけ有効な使い捨てパスコード（type=timeLimit）を発行する。
 * - 管理者用の永続パスコード（permanent）には一切触れない（timeLimit の作成/削除のみ）。
 * - 認証: sign = base64(HMAC-SHA256(token + t + nonce, secret)).toUpperCase()
 *   ヘッダ: Authorization=<token> / sign / t(13桁ms) / nonce(UUID)
 *
 * 参考: https://github.com/OpenWonderLabs/SwitchBotAPI
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

/** デバイスにコマンドを送る共通処理。statusCode=100 以外は throw。 */
async function sendCommand(
  deviceId: string,
  command: { command: string; parameter: unknown }
): Promise<Record<string, unknown>> {
  const { token, secret } = getCreds();
  const headers = buildAuthHeaders(token, secret, Date.now(), randomUUID());
  const res = await fetch(
    `${API_BASE}/devices/${encodeURIComponent(deviceId)}/commands`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ commandType: "command", ...command }),
      cache: "no-store",
    }
  );
  const json = (await res.json().catch(() => ({}))) as SwitchBotResponse;
  if (!res.ok || json.statusCode !== 100) {
    throw new Error(
      `[switchbot] command "${command.command}" failed: status=${json.statusCode ?? res.status} ${json.message ?? ""}`
    );
  }
  return json.body ?? {};
}

/**
 * 時限パスコードを発行する（type=timeLimit / startTime〜endTime のみ有効）。
 * @returns SwitchBot が割り当てたキーID（deleteKey 用）
 */
export async function issueTimeLimitPasscode(params: {
  deviceId: string;
  name: string;       // 識別名（例: 予約ID）
  password: string;   // 数字パスコード（generatePasscode）
  startMs: number;    // 有効開始（epoch ms）= 予約開始
  endMs: number;      // 有効終了（epoch ms）= 予約終了
}): Promise<{ keyId: number }> {
  const body = await sendCommand(params.deviceId, {
    command: "createKey",
    parameter: {
      name: params.name,
      type: "timeLimit",
      password: params.password,
      startTime: params.startMs,
      endTime: params.endMs,
    },
  });
  const keyId = Number(body.id);
  if (!Number.isFinite(keyId)) {
    throw new Error("[switchbot] createKey 応答に id がありません");
  }
  return { keyId };
}

/** 時限パスコードを削除する（予約キャンセル時の即時無効化）。 */
export async function deletePasscode(deviceId: string, keyId: number): Promise<void> {
  await sendCommand(deviceId, {
    command: "deleteKey",
    parameter: { id: keyId },
  });
}

/**
 * 発行をリトライ付きで実行する（要件: 数回リトライ→なお失敗なら呼び出し側で管理者通知）。
 */
export async function issueTimeLimitPasscodeWithRetry(
  params: Parameters<typeof issueTimeLimitPasscode>[0],
  attempts = 3
): Promise<{ keyId: number }> {
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
