/**
 * 単体テスト: src/lib/line.ts の配信結果まわり
 *
 * 背景（2026-07-31 本番障害）:
 *   LINE公式アカウントの**月間配信通数の上限超過**でニュース/イベント/管理メッセージが
 *   届かなくなった。にもかかわらず管理画面は「N名へ送信しました」と成功表示していたため、
 *   コードの不具合か LINE 側かの切り分けに時間がかかった。
 *   ここでは「失敗が失敗として伝わること」を固定する。
 */
const mockGetIds = jest.fn();
jest.mock("@/lib/firebaseAdmin", () => ({ getActiveLineUserIdsByRoles: (...a: unknown[]) => mockGetIds(...a) }));

import { sendAdminMessage, notifyContentPublishedOnce, getMessageQuota } from "@/lib/line";

const okFetch = () => Promise.resolve({ ok: true, status: 200, text: async () => "" } as Response);
const quotaExceededFetch = () =>
  Promise.resolve({
    ok: false,
    status: 429,
    text: async () => JSON.stringify({ message: "You have reached your monthly limit." }),
  } as Response);

/* In-memory doc モック（runTransaction + doc.update）。 */
function makeDb(seed: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(Object.entries(seed).map(([id, d]) => [id, { ...d }]));
  const docRef = (id: string) => ({
    __id: id,
    get: async () => ({ exists: store.has(id), data: () => store.get(id) }),
    update: async (u: Record<string, unknown>) => store.set(id, { ...(store.get(id) ?? {}), ...u }),
  });
  const tx = {
    get: async (ref: { get: () => Promise<unknown> }) => ref.get(),
    update: (ref: { __id: string }, u: Record<string, unknown>) => store.set(ref.__id, { ...(store.get(ref.__id) ?? {}), ...u }),
  };
  return {
    collection: () => ({ doc: (id: string) => docRef(id) }),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
    __store: store,
  } as unknown as FirebaseFirestore.Firestore & { __store: Map<string, Record<string, unknown>> };
}

beforeEach(() => {
  mockGetIds.mockReset().mockResolvedValue(["u1", "u2"]);
  global.fetch = jest.fn().mockImplementation(okFetch) as unknown as typeof fetch;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "test-line-token";
});

describe("sendAdminMessage は配信結果を返す（失敗を握りつぶさない）", () => {
  test("成功時は ok=true と実配信数を返す", async () => {
    const r = await sendAdminMessage(["u1", "u2", "u3"], "こんにちは");
    expect(r).toMatchObject({ ok: true, deliveredCount: 3, failedBatches: 0 });
  });

  test("配信上限超過(429)は ok=false で、原因が分かる日本語のエラーを返す", async () => {
    (global.fetch as jest.Mock).mockImplementation(quotaExceededFetch);
    const r = await sendAdminMessage(["u1", "u2"], "こんにちは");
    expect(r.ok).toBe(false);
    expect(r.deliveredCount).toBe(0);
    expect(r.error).toMatch(/月間配信上限/);
    // LINE の生レスポンスも残す（サポート問い合わせ用）
    expect(r.error).toMatch(/monthly limit/);
  });

  test("トークン未設定なら送信せず ok=false（Bearer undefined で叩かない）", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const r = await sendAdminMessage(["u1"], "こんにちは");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/LINE_CHANNEL_ACCESS_TOKEN/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("宛先0件・空文字は送らずに成功扱い", async () => {
    expect(await sendAdminMessage([], "本文")).toMatchObject({ ok: true, deliveredCount: 0 });
    expect(await sendAdminMessage(["u1"], "   ")).toMatchObject({ ok: true, deliveredCount: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("公開通知は失敗の理由を doc に残す", () => {
  const call = (db: ReturnType<typeof makeDb>, options?: { force?: boolean }) =>
    notifyContentPublishedOnce(db, "news", "n1", "news", "タイトル", true, ["member"], options);

  test("上限超過なら lineNotifyResult に上限の説明が入る（管理画面のバッジに出る）", async () => {
    (global.fetch as jest.Mock).mockImplementation(quotaExceededFetch);
    const db = makeDb({ n1: { published: true } });
    const r = await call(db);
    expect(r).toMatchObject({ sent: false, reason: "partial_failure" });
    const result = db.__store.get("n1")!.lineNotifyResult as { ok: boolean; error: string; deliveredCount: number };
    expect(result.ok).toBe(false);
    expect(result.deliveredCount).toBe(0);
    expect(result.error).toMatch(/月間配信上限/);
  });

  test("force=true は「通知済み」を突破して再送できる（増枠後の救済経路）", async () => {
    // 1回目: 上限超過で失敗。claim は残る＝通常経路ではもう送れない。
    (global.fetch as jest.Mock).mockImplementation(quotaExceededFetch);
    const db = makeDb({ n1: { published: true } });
    await call(db);
    expect(db.__store.get("n1")!.lineNotifiedAt).toBeTruthy();
    expect(await call(db)).toMatchObject({ sent: false, reason: "already_notified" });

    // 増枠後を想定して成功に戻し、force で再送する。
    (global.fetch as jest.Mock).mockImplementation(okFetch);
    const r = await call(db, { force: true });
    expect(r).toMatchObject({ sent: true, recipientCount: 2 });
    expect((db.__store.get("n1")!.lineNotifyResult as { ok: boolean }).ok).toBe(true);
  });

  test("force=false（既定）では二重送信しない", async () => {
    const db = makeDb({ n1: { published: true } });
    await call(db);
    (global.fetch as jest.Mock).mockClear();
    expect(await call(db)).toMatchObject({ sent: false, reason: "already_notified" });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("getMessageQuota", () => {
  test("上限ありプランは残量を計算して返す", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url.includes("consumption")
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ totalUsage: 180 }) } as Response)
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ type: "limited", value: 200 }) } as Response),
    ) as unknown as typeof fetch;

    expect(await getMessageQuota()).toMatchObject({
      configured: true, type: "limited", limit: 200, used: 180, remaining: 20,
    });
  });

  test("上限なしプランは remaining=null（上限は原因ではない）", async () => {
    global.fetch = jest.fn().mockImplementation((url: string) =>
      url.includes("consumption")
        ? Promise.resolve({ ok: true, status: 200, json: async () => ({ totalUsage: 5000 }) } as Response)
        : Promise.resolve({ ok: true, status: 200, json: async () => ({ type: "none" }) } as Response),
    ) as unknown as typeof fetch;

    expect(await getMessageQuota()).toMatchObject({ configured: true, type: "none", limit: null, remaining: null });
  });

  test("トークン未設定なら configured=false", async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    expect(await getMessageQuota()).toMatchObject({ configured: false });
  });
});
