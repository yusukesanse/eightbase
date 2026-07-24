/**
 * 単体テスト: src/lib/line.ts notifyContentPublishedOnce
 * コンテンツ公開通知の「1 doc 最大1回」＋送信結果記録＋失敗時の扱い。
 * getActiveLineUserIdsByRoles はモック、LINE送信(fetch)もモックする。
 */
const mockGetIds = jest.fn();
jest.mock("@/lib/firebaseAdmin", () => ({ getActiveLineUserIdsByRoles: (...a: unknown[]) => mockGetIds(...a) }));

import { notifyContentPublishedOnce } from "@/lib/line";

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

const okFetch = () => Promise.resolve({ ok: true, text: async () => "" } as Response);
const failFetch = () => Promise.resolve({ ok: false, text: async () => "429" } as Response);

beforeEach(() => {
  mockGetIds.mockReset().mockResolvedValue(["u1", "u2"]);
  global.fetch = jest.fn().mockImplementation(okFetch) as unknown as typeof fetch;
});

const call = (db: ReturnType<typeof makeDb>) =>
  notifyContentPublishedOnce(db, "news", "n1", "news", "タイトル", true, ["member"]);

test("公開通知を送り、送信済み時刻と結果を記録する", async () => {
  const db = makeDb({ n1: { published: true } });
  const r = await call(db);
  expect(r).toMatchObject({ sent: true, recipientCount: 2 });
  const doc = db.__store.get("n1")!;
  expect(doc.lineNotifiedAt).toBeTruthy();
  expect(doc.lineNotifyResult).toMatchObject({ ok: true, recipientCount: 2, audience: ["member"] });
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test("2回目は送らない（already_notified）＝再公開・二重発火でも一度だけ", async () => {
  const db = makeDb({ n1: { published: true } });
  await call(db);
  (global.fetch as jest.Mock).mockClear();
  const r2 = await call(db);
  expect(r2).toMatchObject({ sent: false, reason: "already_notified" });
  expect(global.fetch).not.toHaveBeenCalled();
});

test("lineNotify=false / 空 audience は送らない", async () => {
  const db = makeDb({ n1: { published: true } });
  expect(await notifyContentPublishedOnce(db, "news", "n1", "news", "t", false, ["member"])).toMatchObject({ sent: false, reason: "disabled" });
  expect(await notifyContentPublishedOnce(db, "news", "n1", "news", "t", true, [])).toMatchObject({ sent: false, reason: "disabled" });
  expect(db.__store.get("n1")!.lineNotifiedAt).toBeFalsy();
  expect(global.fetch).not.toHaveBeenCalled();
});

test("LINE配信の一部失敗は結果に残すが claim は維持（二重送信しない）", async () => {
  (global.fetch as jest.Mock).mockImplementation(failFetch);
  const db = makeDb({ n1: { published: true } });
  const r = await call(db);
  expect(r).toMatchObject({ sent: false, reason: "partial_failure" });
  const doc = db.__store.get("n1")!;
  expect(doc.lineNotifiedAt).toBeTruthy(); // claim 維持
  expect(doc.lineNotifyResult).toMatchObject({ ok: false });
  // 再実行しても再送しない
  (global.fetch as jest.Mock).mockClear();
  expect(await call(db)).toMatchObject({ sent: false, reason: "already_notified" });
  expect(global.fetch).not.toHaveBeenCalled();
});

test("送信前の例外（宛先取得失敗）は claim を解除して再試行可能にする", async () => {
  mockGetIds.mockRejectedValueOnce(new Error("db down"));
  const db = makeDb({ n1: { published: true } });
  const r = await call(db);
  expect(r).toMatchObject({ sent: false, reason: "error" });
  const doc = db.__store.get("n1")!;
  expect(doc.lineNotifiedAt).toBeFalsy(); // claim 解除＝再試行可能
  expect(doc.lineNotifyResult).toMatchObject({ ok: false });
  // 再試行すると今度は成功する
  const r2 = await call(db);
  expect(r2).toMatchObject({ sent: true, recipientCount: 2 });
});
