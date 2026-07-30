/**
 * 単体テスト: src/lib/switchbot.ts
 *
 * 認証ヘッダ生成（HMAC署名）・パスコード生成は HTTP を呼ばない純関数として検証。
 * それ以外は fetch をモックして、2026-07-30 の実機検証で判明した API 実仕様を固定する:
 *   - createKey/deleteKey は **Keypad** のコマンド（ロックIDが設定されていても解決する）
 *   - startTime/endTime は **秒**（ms を送るとパスコードが永久に使えない）
 *   - createKey は id を返さないので keyList から name で引く
 *   - 同名キーがあれば作成せず再利用（リトライで重複パスコードを作らない）
 *   - permanent（管理者用）は絶対に削除しない
 */
import {
  buildAuthHeaders,
  generatePasscode,
  toEpochSeconds,
  resolveKeypad,
  issueTimeLimitPasscode,
  deletePasscodeByName,
  KEY_LOOKUP_DELAYS_MS,
  PASSCODE_GRACE_MINUTES,
} from "@/lib/switchbot";

const LOCK_ID = "LOCK123";
const KEYPAD_ID = "KEYPAD456";

type Key = { id: number; name: string; type: string; status: string };

/** デバイス一覧＋コマンドの fetch をモックする。作成/削除は keys 配列へ反映する。 */
function mockSwitchBot(options: { keys: Key[]; createAppearsAfter?: number }) {
  const keys = [...options.keys];
  const appearsAfter = options.createAppearsAfter ?? 0; // 何回目の一覧取得で現れるか
  let listCalls = 0;
  const commands: { deviceId: string; body: Record<string, unknown> }[] = [];
  let pendingCreate: Key | null = null;

  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const ok = (body: unknown) => ({
      ok: true,
      json: async () => ({ statusCode: 100, message: "success", body }),
    });

    if (url.endsWith("/devices") && (!init || init.method === "GET")) {
      listCalls++;
      if (pendingCreate && listCalls > appearsAfter) {
        keys.push(pendingCreate);
        pendingCreate = null;
      }
      return ok({
        deviceList: [
          { deviceId: LOCK_ID, deviceType: "Smart Lock" },
          { deviceId: KEYPAD_ID, deviceType: "Keypad", lockDeviceId: LOCK_ID, keyList: keys },
        ],
        infraredRemoteList: [],
      });
    }

    // コマンド（createKey / deleteKey）
    const m = url.match(/\/devices\/([^/]+)\/commands$/);
    const deviceId = m ? decodeURIComponent(m[1]) : "";
    const body = JSON.parse(String(init?.body ?? "{}"));
    commands.push({ deviceId, body });

    if (deviceId !== KEYPAD_ID) {
      // 実機と同じ: Smart Lock に createKey を送ると 160 unknown command
      return { ok: true, json: async () => ({ statusCode: 160, message: "unknown command" }) };
    }
    if (body.command === "createKey") {
      pendingCreate = {
        id: 99,
        name: String(body.parameter.name),
        type: "timeLimit",
        status: "normal",
      };
      return ok({}); // ⚠️ 実機同様、応答ボディは空で id を返さない
    }
    if (body.command === "deleteKey") {
      const i = keys.findIndex((k) => k.id === Number(body.parameter.id));
      if (i >= 0) keys.splice(i, 1);
      return ok({});
    }
    return ok({});
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return { commands, keys, fetchMock };
}

beforeEach(() => {
  process.env.SWITCHBOT_TOKEN = "tok";
  process.env.SWITCHBOT_SECRET = "sec";
});

describe("switchbot — 認証ヘッダ buildAuthHeaders", () => {
  const token = "testtoken";
  const secret = "testsecret";
  const t = 1700000000000;
  const nonce = "fixed-nonce";

  test("既知ベクトルと一致する sign（HMAC-SHA256(token+t+nonce, secret) の base64大文字）", () => {
    const h = buildAuthHeaders(token, secret, t, nonce);
    expect(h.sign).toBe("IGHYMQBUZVJ4YZ9V3VIPSMP/UXYTQ398EXZVBHV8TLK=");
  });

  test("ヘッダに Authorization / t / nonce / Content-Type が入る", () => {
    const h = buildAuthHeaders(token, secret, t, nonce);
    expect(h.Authorization).toBe(token);
    expect(h.t).toBe("1700000000000");
    expect(h.nonce).toBe(nonce);
    expect(h["Content-Type"]).toContain("application/json");
  });

  test("sign は大文字（base64を大文字化）", () => {
    const h = buildAuthHeaders(token, secret, t, nonce);
    expect(h.sign).toBe(h.sign.toUpperCase());
  });

  test("nonce が違えば sign も変わる", () => {
    const a = buildAuthHeaders(token, secret, t, "nonce-a");
    const b = buildAuthHeaders(token, secret, t, "nonce-b");
    expect(a.sign).not.toBe(b.sign);
  });
});

describe("switchbot — generatePasscode", () => {
  test("常に6桁の数字文字列（先頭ゼロ許容）", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePasscode();
      expect(p).toMatch(/^\d{6}$/);
    }
  });

  test("値は 000000〜999999 の範囲", () => {
    for (let i = 0; i < 200; i++) {
      const n = Number(generatePasscode());
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThanOrEqual(999999);
    }
  });

  test("6〜12桁の API 制約を満たす", () => {
    expect(generatePasscode()).toMatch(/^\d{6,12}$/);
  });
});

describe("switchbot — toEpochSeconds（ms→秒。ここを間違えるとパスコードが永久に使えない）", () => {
  test("ミリ秒を10桁の秒に落とす", () => {
    expect(toEpochSeconds(1785376147000)).toBe(1785376147);
    expect(String(toEpochSeconds(Date.now()))).toHaveLength(10);
  });

  test("端数は切り捨て", () => {
    expect(toEpochSeconds(1785376147999)).toBe(1785376147);
  });
});

describe("switchbot — resolveKeypad", () => {
  test("ロックの deviceId でも lockDeviceId を辿って Keypad に解決する", async () => {
    mockSwitchBot({ keys: [] });
    const r = await resolveKeypad(LOCK_ID);
    expect(r.keypadDeviceId).toBe(KEYPAD_ID);
  });

  test("Keypad の deviceId はそのまま使う", async () => {
    mockSwitchBot({ keys: [{ id: 1, name: "x", type: "permanent", status: "normal" }] });
    const r = await resolveKeypad(KEYPAD_ID);
    expect(r.keypadDeviceId).toBe(KEYPAD_ID);
    expect(r.keys).toHaveLength(1);
  });

  test("対応する Keypad が無ければ throw", async () => {
    mockSwitchBot({ keys: [] });
    await expect(resolveKeypad("UNKNOWN")).rejects.toThrow(/Keypad が見つかりません/);
  });
});

describe("switchbot — issueTimeLimitPasscode", () => {
  const base = {
    deviceId: LOCK_ID,
    name: "res-1",
    password: "123456",
    startMs: 1785376147000,
    endMs: 1785379747000,
    lookupDelaysMs: [0, 0, 0],
  };

  test("createKey は Keypad へ送られ、時刻は秒＋前後グレースで渡る", async () => {
    const { commands } = mockSwitchBot({ keys: [] });
    await issueTimeLimitPasscode(base);
    const create = commands.find((c) => c.body.command === "createKey")!;
    expect(create.deviceId).toBe(KEYPAD_ID); // ロックへ送ると 160 になる
    const grace = PASSCODE_GRACE_MINUTES * 60;
    expect(create.body.parameter).toMatchObject({
      name: "res-1",
      type: "timeLimit",
      password: "123456",
      // 秒（ms のままだと実機で永久に使えない）＋端末の時計ずれ用グレース。
      // ちょうど予約時間の窓にすると実機で解錠できない（2026-07-30 検証）。
      startTime: 1785376147 - grace,
      endTime: 1785379747 + grace,
    });
  });

  test("窓は予約時間より前に始まり、後に終わる（グレースが効いている）", async () => {
    const { commands } = mockSwitchBot({ keys: [] });
    await issueTimeLimitPasscode(base);
    const p = commands.find((c) => c.body.command === "createKey")!.body.parameter as {
      startTime: number;
      endTime: number;
    };
    expect(p.startTime).toBeLessThan(toEpochSeconds(base.startMs));
    expect(p.endTime).toBeGreaterThan(toEpochSeconds(base.endMs));
  });

  test("グレースは実測ずれ(5分未満)を吸収し、かつ広げすぎない", () => {
    // 5分では将来のドリフトに耐えられず、30分を超えると予約時間外に開けすぎる
    expect(PASSCODE_GRACE_MINUTES).toBeGreaterThanOrEqual(5);
    expect(PASSCODE_GRACE_MINUTES).toBeLessThanOrEqual(30);
  });

  test("keyList への反映が遅れても keyId を取得できる", async () => {
    mockSwitchBot({ keys: [], createAppearsAfter: 2 });
    const r = await issueTimeLimitPasscode(base);
    expect(r.keyId).toBe(99);
    expect(r.keypadDeviceId).toBe(KEYPAD_ID);
  });

  test("待っても現れなければ keyId=null（パスコードは有効なので発行は成功扱い）", async () => {
    mockSwitchBot({ keys: [], createAppearsAfter: 99 });
    const r = await issueTimeLimitPasscode(base);
    expect(r.keyId).toBeNull();
  });

  test("同名キーがあれば作成せず既存を返す（リトライで重複を作らない）", async () => {
    const { commands } = mockSwitchBot({
      keys: [{ id: 42, name: "res-1", type: "timeLimit", status: "normal" }],
    });
    const r = await issueTimeLimitPasscode(base);
    expect(r.keyId).toBe(42);
    expect(commands.filter((c) => c.body.command === "createKey")).toHaveLength(0);
  });

  test("反映待ちの既定値は実機の遅延(~5秒)を吸収できる長さ", () => {
    const total = KEY_LOOKUP_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(10000);
  });
});

describe("switchbot — deletePasscodeByName", () => {
  test("name 一致の timeLimit キーを削除する", async () => {
    const { commands, keys } = mockSwitchBot({
      keys: [
        { id: 11, name: "常に有効", type: "permanent", status: "normal" },
        { id: 20, name: "res-1", type: "timeLimit", status: "normal" },
      ],
    });
    const deleted = await deletePasscodeByName(LOCK_ID, "res-1");
    expect(deleted).toBe(20);
    const del = commands.find((c) => c.body.command === "deleteKey")!;
    expect(del.deviceId).toBe(KEYPAD_ID);
    expect(keys.map((k) => k.id)).toEqual([11]);
  });

  test("permanent（管理者用）は絶対に削除しない", async () => {
    const { commands } = mockSwitchBot({
      keys: [{ id: 11, name: "常に有効", type: "permanent", status: "normal" }],
    });
    const deleted = await deletePasscodeByName(LOCK_ID, "常に有効");
    expect(deleted).toBeNull();
    expect(commands.filter((c) => c.body.command === "deleteKey")).toHaveLength(0);
  });

  test("該当キーが無ければ何もしない", async () => {
    const { commands } = mockSwitchBot({ keys: [] });
    expect(await deletePasscodeByName(LOCK_ID, "none")).toBeNull();
    expect(commands.filter((c) => c.body.command === "deleteKey")).toHaveLength(0);
  });
});
