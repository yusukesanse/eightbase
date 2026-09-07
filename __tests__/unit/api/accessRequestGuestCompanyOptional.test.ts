/**
 * 単体テスト: POST /api/auth/access-request の会社名の必須／任意。
 *
 * 固定する仕様:
 *  - ゲスト（requestedRole="guest"）は会社名が空でも申請できる
 *  - オフィス契約者（member）・社員（staff）は従来どおり空なら 400
 *  - 会社名が空のときの管理者通知は「（会社名なし）」と書く
 *  - 空白だけの会社名も「空」として扱う（member は 400 / guest は通る）
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/rateLimit", () => ({
  checkRateLimit: jest.fn(() => true),
  getClientIp: jest.fn(() => "127.0.0.1"),
}));
jest.mock("@/lib/lineAuth", () => ({
  verifyLineAccessToken: jest.fn(),
  fetchLineProfile: jest.fn(),
}));
jest.mock("@/lib/adminNotify", () => ({ notifyAdmin: jest.fn() }));

import type { NextRequest } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { verifyLineAccessToken, fetchLineProfile } from "@/lib/lineAuth";
import { notifyAdmin } from "@/lib/adminNotify";
import { POST } from "@/app/api/auth/access-request/route";

type Data = Record<string, unknown>;

const LINE_ID = "U_applicant";

function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  let seq = 0;
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const query = (c: string, conds: [string, unknown][], max: number | null) => ({
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]], max),
    limit: (n: number) => query(c, conds, n),
    get: async () => {
      let docs = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({
          id,
          data: () => v,
          ref: {
            id,
            update: async (d: Data) => { col(c).set(id, { ...(col(c).get(id) ?? {}), ...d }); },
          },
        }));
      if (max !== null) docs = docs.slice(0, max);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  return {
    __seed: (c: string, id: string, d: Data) => { col(c).set(id, d); },
    __all: (c: string) => [...col(c).values()],
    collection: (c: string) => ({
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]], null),
      add: async (d: Data) => {
        const id = `doc${++seq}`;
        col(c).set(id, { ...d });
        return { id };
      },
    }),
  };
}

let db: ReturnType<typeof makeDb>;

function req(body: Record<string, unknown>): NextRequest {
  return { json: async () => body, headers: new Headers() } as unknown as NextRequest;
}

function baseBody(over: Record<string, unknown>) {
  return {
    accessToken: "tok",
    displayName: "山田 太郎",
    email: "taro@example.com",
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (verifyLineAccessToken as jest.Mock).mockResolvedValue("valid");
  (fetchLineProfile as jest.Mock).mockResolvedValue({
    userId: LINE_ID,
    displayName: "LINE表示名",
    pictureUrl: "",
  });
  (notifyAdmin as jest.Mock).mockResolvedValue(undefined);
});

describe("POST /api/auth/access-request の会社名", () => {
  it("ゲストは会社名が空でも申請できる", async () => {
    const res = await POST(req(baseBody({ companyName: "", requestedRole: "guest" })));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(db.__all("accessRequests")[0]).toMatchObject({
      lineUserId: LINE_ID,
      companyName: "",
      requestedRole: "guest",
      status: "pending",
    });
  });

  it("ゲストで会社名が空なら管理者通知は「（会社名なし）」", async () => {
    await POST(req(baseBody({ companyName: "   ", requestedRole: "guest" })));

    expect(notifyAdmin).toHaveBeenCalledTimes(1);
    const message = (notifyAdmin as jest.Mock).mock.calls[0][1] as string;
    expect(message).toContain("（会社名なし）");
    expect(message).toContain("ゲスト");
  });

  it("ゲストでも入力があれば会社名を通知に載せる", async () => {
    await POST(req(baseBody({ companyName: "株式会社サンプル", requestedRole: "guest" })));

    const message = (notifyAdmin as jest.Mock).mock.calls[0][1] as string;
    expect(message).toContain("株式会社サンプル");
    expect(message).not.toContain("（会社名なし）");
  });

  it("オフィス契約者は会社名が空なら 400", async () => {
    const res = await POST(req(baseBody({ companyName: "", requestedRole: "member" })));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBe("会社名を入力してください");
    expect(db.__all("accessRequests")).toHaveLength(0);
    expect(notifyAdmin).not.toHaveBeenCalled();
  });

  it("オフィス契約者は空白だけの会社名でも 400", async () => {
    const res = await POST(req(baseBody({ companyName: "   ", requestedRole: "member" })));

    expect(res.status).toBe(400);
    expect(db.__all("accessRequests")).toHaveLength(0);
  });

  it("社員は会社名が空なら 400（クライアントが固定値を送る前提を崩さない）", async () => {
    const res = await POST(req(baseBody({ companyName: "", requestedRole: "staff" })));

    expect(res.status).toBe(400);
    expect(db.__all("accessRequests")).toHaveLength(0);
  });

  it("未知のロールは member 扱いなので会社名が空なら 400", async () => {
    const res = await POST(req(baseBody({ companyName: "", requestedRole: "superuser" })));

    expect(res.status).toBe(400);
  });

  it("ゲストでも氏名・メールの検証は緩めない", async () => {
    const noName = await POST(req(baseBody({ displayName: "", companyName: "", requestedRole: "guest" })));
    expect(noName.status).toBe(400);

    const badEmail = await POST(
      req(baseBody({ email: "not-an-email", companyName: "", requestedRole: "guest" }))
    );
    expect(badEmail.status).toBe(400);
    expect(db.__all("accessRequests")).toHaveLength(0);
  });

  it("既存の pending 申請は上書きする（会社名を空へ戻せる）", async () => {
    db.__seed("accessRequests", "r1", {
      lineUserId: LINE_ID,
      status: "pending",
      displayName: "旧名",
      email: "old@example.com",
      companyName: "旧会社",
      requestedRole: "member",
      createdAt: "2026-09-01T00:00:00.000Z",
    });

    const res = await POST(req(baseBody({ companyName: "", requestedRole: "guest" })));

    expect(res.status).toBe(200);
    expect(db.__all("accessRequests")).toHaveLength(1);
    expect(db.__all("accessRequests")[0]).toMatchObject({
      displayName: "山田 太郎",
      companyName: "",
      requestedRole: "guest",
    });
  });
});
