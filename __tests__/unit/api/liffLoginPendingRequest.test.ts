/**
 * 単体テスト: POST /api/auth/liff-login の「現在申請中です」情報（pendingRequest）。
 *
 * 固定する仕様:
 *  - 未連携（authorizedUsers に無い）かつ accessRequests に status="pending" があれば
 *    needsLinking:true に加えて pendingRequest を返す
 *  - pending が無ければ pendingRequest を返さない（従来どおり needsLinking だけ）
 *  - pending 以外（approved/rejected）は拾わない
 *  - 連携済みなら needsLinking にならない（success:true）
 *  - accessRequests の読み取りが失敗しても needsLinking は返す（ログインを止めない）
 */
jest.mock("@/lib/firebaseAdmin", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/lineAuth", () => ({
  verifyLineAccessToken: jest.fn(),
  fetchLineProfile: jest.fn(),
}));
jest.mock("@/lib/reviewMode", () => ({ isReviewModeEnabled: jest.fn() }));
jest.mock("@/lib/session", () => ({
  signSession: jest.fn(),
  setSessionCookie: jest.fn(),
}));

import type { NextRequest } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { verifyLineAccessToken, fetchLineProfile } from "@/lib/lineAuth";
import { isReviewModeEnabled } from "@/lib/reviewMode";
import { signSession } from "@/lib/session";
import { POST } from "@/app/api/auth/liff-login/route";

type Data = Record<string, unknown>;

const LINE_ID = "U_applicant";

/** where(...).where(...).limit(n).get() と doc().set(_, {merge}) だけを持つ簡易 Firestore。 */
function makeDb() {
  const store = new Map<string, Map<string, Data>>();
  const failing = new Set<string>();
  const col = (n: string) => {
    if (!store.has(n)) store.set(n, new Map());
    return store.get(n)!;
  };
  const query = (c: string, conds: [string, unknown][], max: number | null) => ({
    where: (f: string, _op: string, v: unknown) => query(c, [...conds, [f, v]], max),
    limit: (n: number) => query(c, conds, n),
    get: async () => {
      if (failing.has(c)) throw new Error(`firestore unavailable: ${c}`);
      let docs = [...col(c).entries()]
        .filter(([, v]) => conds.every(([f, val]) => v[f] === val))
        .map(([id, v]) => ({ id, data: () => v }));
      if (max !== null) docs = docs.slice(0, max);
      return { docs, empty: docs.length === 0, size: docs.length };
    },
  });
  return {
    __seed: (c: string, id: string, d: Data) => { col(c).set(id, d); },
    __get: (c: string, id: string) => col(c).get(id),
    __failCollection: (c: string) => { failing.add(c); },
    collection: (c: string) => ({
      doc: (id: string) => ({
        set: async (d: Data, opt?: { merge?: boolean }) => {
          const cur = opt?.merge ? (col(c).get(id) ?? {}) : {};
          col(c).set(id, { ...cur, ...d });
        },
      }),
      where: (f: string, _op: string, v: unknown) => query(c, [[f, v]], null),
    }),
  };
}

let db: ReturnType<typeof makeDb>;

function req(): NextRequest {
  return { json: async () => ({ accessToken: "tok" }) } as unknown as NextRequest;
}

beforeEach(() => {
  jest.clearAllMocks();
  db = makeDb();
  (getDb as jest.Mock).mockReturnValue(db);
  (isReviewModeEnabled as jest.Mock).mockResolvedValue(false);
  (verifyLineAccessToken as jest.Mock).mockResolvedValue("valid");
  (fetchLineProfile as jest.Mock).mockResolvedValue({
    userId: LINE_ID,
    displayName: "LINE表示名",
    pictureUrl: "https://example.com/a.png",
  });
  (signSession as jest.Mock).mockResolvedValue("session-token");
});

describe("POST /api/auth/liff-login の pendingRequest", () => {
  it.each(["guest", "member", "staff"])("%s の利用者区分をログイン後の振り分け用に返す", async (role) => {
    db.__seed("authorizedUsers", "u1", {
      lineUserId: LINE_ID, active: true, role, profileComplete: false,
    });
    const json = await (await POST(req())).json();
    expect(json).toMatchObject({ success: true, role, profileComplete: false });
  });

  it("未連携かつ pending 申請があれば pendingRequest を返す", async () => {
    db.__seed("accessRequests", "r1", {
      lineUserId: LINE_ID,
      status: "pending",
      displayName: "山田 太郎",
      email: "taro@example.com",
      requestedRole: "guest",
      createdAt: "2026-09-01T02:00:00.000Z",
    });

    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.needsLinking).toBe(true);
    expect(json.pendingRequest).toEqual({
      displayName: "山田 太郎",
      email: "taro@example.com",
      requestedRole: "guest",
      createdAt: "2026-09-01T02:00:00.000Z",
    });
  });

  it("pending 申請が無ければ pendingRequest を返さない", async () => {
    const res = await POST(req());
    const json = await res.json();

    expect(json.needsLinking).toBe(true);
    expect(json.pendingRequest).toBeUndefined();
  });

  it("pending 以外（approved）の申請は拾わない", async () => {
    db.__seed("accessRequests", "r1", {
      lineUserId: LINE_ID,
      status: "approved",
      displayName: "山田 太郎",
      email: "taro@example.com",
      requestedRole: "member",
      createdAt: "2026-09-01T02:00:00.000Z",
    });

    const json = await (await POST(req())).json();

    expect(json.needsLinking).toBe(true);
    expect(json.pendingRequest).toBeUndefined();
  });

  it("他人の pending 申請は拾わない", async () => {
    db.__seed("accessRequests", "r1", {
      lineUserId: "U_other",
      status: "pending",
      displayName: "別人",
      email: "other@example.com",
      requestedRole: "member",
      createdAt: "2026-09-01T02:00:00.000Z",
    });

    const json = await (await POST(req())).json();

    expect(json.pendingRequest).toBeUndefined();
  });

  it("未知の requestedRole は member に丸める（欠けた項目は空文字）", async () => {
    db.__seed("accessRequests", "r1", {
      lineUserId: LINE_ID,
      status: "pending",
      requestedRole: "superuser",
    });

    const json = await (await POST(req())).json();

    expect(json.pendingRequest).toEqual({
      displayName: "",
      email: "",
      requestedRole: "member",
      createdAt: "",
    });
  });

  it("accessRequests の読み取りが失敗してもログインを止めない", async () => {
    db.__failCollection("accessRequests");

    const res = await POST(req());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.needsLinking).toBe(true);
    expect(json.pendingRequest).toBeUndefined();
  });

  it("連携済みなら needsLinking にならない（pending 申請が残っていても）", async () => {
    db.__seed("authorizedUsers", "u1", {
      lineUserId: LINE_ID,
      active: true,
      displayName: "登録済み太郎",
      profileComplete: true,
    });
    db.__seed("accessRequests", "r1", {
      lineUserId: LINE_ID,
      status: "pending",
      displayName: "山田 太郎",
      email: "taro@example.com",
      requestedRole: "member",
      createdAt: "2026-09-01T02:00:00.000Z",
    });

    const json = await (await POST(req())).json();

    expect(json.success).toBe(true);
    expect(json.role).toBe("member"); // role未設定の既存会員との互換
    expect(json.needsLinking).toBeUndefined();
    expect(json.pendingRequest).toBeUndefined();
  });
});
