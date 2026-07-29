/**
 * 単体テスト: 同伴者の Firestore 解決（validateCompanionsForReservation）
 *
 * ここで守りたいこと:
 *  - ゲスト・非アクティブ・未登録は同伴者にできない（要件の核）
 *  - 同伴者必須OFFかつ同伴者なしなら Firestore を1件も読まない（既存施設の回帰）
 *  - `in` に `active == true` を重ねない（複合インデックス不足で本番が落ちるのを防ぐ）
 */
import type { Facility } from "@/types";
import { validateCompanionsForReservation } from "@/lib/companions";

const SELF = "U-self";

interface AuthDoc {
  lineUserId: string;
  displayName?: string;
  active?: boolean;
  role?: string;
}

/** authorizedUsers の `where("lineUserId","in",[...])` だけを再現する最小モック */
function makeDb(docs: AuthDoc[]) {
  const whereCalls: { field: string; op: string; value: unknown }[] = [];
  const collection = jest.fn((name: string) => {
    if (name !== "authorizedUsers") throw new Error(`unexpected collection: ${name}`);
    const query = {
      where(field: string, op: string, value: unknown) {
        whereCalls.push({ field, op, value });
        return query;
      },
      async get() {
        const inCall = whereCalls.find((c) => c.op === "in");
        const ids = (inCall?.value as string[]) ?? [];
        return {
          docs: docs
            .filter((d) => ids.includes(d.lineUserId))
            .map((d) => ({ data: () => d })),
        };
      },
    };
    return query;
  });
  return { db: { collection } as unknown as FirebaseFirestore.Firestore, collection, whereCalls };
}

function facility(over: Partial<Facility> = {}): Facility {
  return {
    id: "sauna",
    name: "サウナ",
    type: "activity",
    capacity: 6,
    calendarId: "cal@example.com",
    ...over,
  };
}

const SAUNA = facility({ requireCompanions: true, minPartySize: 2 });

const MEMBER: AuthDoc = { lineUserId: "U-a", displayName: "山田太郎", active: true, role: "member" };
const STAFF: AuthDoc = { lineUserId: "U-b", displayName: "エイト社員", active: true, role: "staff" };
const GUEST: AuthDoc = { lineUserId: "U-g", displayName: "ゲスト", active: true, role: "guest" };
const INACTIVE: AuthDoc = { lineUserId: "U-x", displayName: "退会済", active: false, role: "member" };
const NO_ROLE: AuthDoc = { lineUserId: "U-n", displayName: "旧データ", active: true };
const SELF_DOC: AuthDoc = { lineUserId: SELF, displayName: "予約者", active: true, role: "member" };

describe("validateCompanionsForReservation", () => {
  test("同伴者必須OFF・同伴者なしは Firestore を一切読まない（既存施設の回帰）", async () => {
    const { db, collection } = makeDb([]);
    const r = await validateCompanionsForReservation(db, facility(), SELF, undefined);
    expect(r).toEqual({ ok: true, companions: [], companionIds: [], partySize: 1 });
    expect(collection).not.toHaveBeenCalled();
  });

  test("同伴者必須ON・同伴者なしは Firestore を読む前に COMPANION_REQUIRED", async () => {
    const { db, collection } = makeDb([]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("COMPANION_REQUIRED");
    expect(collection).not.toHaveBeenCalled();
  });

  test("会員を同伴者にできる。予約者名も同じクエリで解決する（追加読み取りゼロ）", async () => {
    const { db, collection } = makeDb([MEMBER, SELF_DOC]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-a"]);
    expect(r).toEqual({
      ok: true,
      companions: [{ lineUserId: "U-a", displayName: "山田太郎" }],
      companionIds: ["U-a"],
      partySize: 2,
      organizerName: "予約者",
    });
    expect(collection).toHaveBeenCalledTimes(1);
  });

  test("エイト社員は同伴者にできる（会員同等）", async () => {
    const { db } = makeDb([STAFF, SELF_DOC]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-b"]);
    expect(r.ok).toBe(true);
  });

  test("role 未設定の旧データは member 扱いで同伴者にできる", async () => {
    const { db } = makeDb([NO_ROLE, SELF_DOC]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-n"]);
    expect(r.ok).toBe(true);
  });

  test("ゲストは同伴者にできない", async () => {
    const { db } = makeDb([GUEST, SELF_DOC]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-g"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("COMPANION_INVALID");
    expect(r.ok === false && r.invalidIds).toEqual(["U-g"]);
  });

  test("active=false は同伴者にできない", async () => {
    const { db } = makeDb([INACTIVE, SELF_DOC]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-x"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.invalidIds).toEqual(["U-x"]);
  });

  test("authorizedUsers に存在しない ID は同伴者にできない", async () => {
    const { db } = makeDb([SELF_DOC]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-unknown"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.invalidIds).toEqual(["U-unknown"]);
  });

  test("同一 lineUserId の doc が複数（有効/無効）でも、有効な doc が1件あれば通る", async () => {
    const { db } = makeDb([
      { lineUserId: "U-a", displayName: "旧レコード", active: false, role: "member" },
      MEMBER,
      SELF_DOC,
    ]);
    const r = await validateCompanionsForReservation(db, SAUNA, SELF, ["U-a"]);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.companions[0].displayName).toBe("山田太郎");
  });

  test("重複を除いた結果が最低人数に届かなければ COMPANION_REQUIRED", async () => {
    const { db, collection } = makeDb([MEMBER, SELF_DOC]);
    const f = facility({ requireCompanions: true, minPartySize: 3 });
    const r = await validateCompanionsForReservation(db, f, SELF, ["U-a", "U-a"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("COMPANION_REQUIRED");
    expect(collection).not.toHaveBeenCalled();
  });

  test("`in` クエリに active/role の等値条件を重ねない（複合インデックス回避の回帰）", async () => {
    const { db, whereCalls } = makeDb([MEMBER, SELF_DOC]);
    await validateCompanionsForReservation(db, SAUNA, SELF, ["U-a"]);
    expect(whereCalls).toEqual([
      { field: "lineUserId", op: "in", value: ["U-a", SELF] },
    ]);
  });

  test("同伴者必須OFFの施設に同伴者が来たら Firestore を読む前に弾く", async () => {
    const { db, collection } = makeDb([MEMBER]);
    const r = await validateCompanionsForReservation(db, facility(), SELF, ["U-a"]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe("COMPANION_NOT_ALLOWED");
    expect(collection).not.toHaveBeenCalled();
  });
});
