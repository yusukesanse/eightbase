/**
 * 単体テスト: GET /api/reservations — 同伴者として参加している予約もマイ予約に混ぜる
 *
 * ここで守りたいこと:
 *  - 同伴者に解錠コード・決済情報を渡さない（同伴者が単独で施設を開けられないこと）
 *  - array-contains に status を重ねない（複合インデックス不足で本番が落ちるのを防ぐ）
 */
type MockRes = { status: number; _data: Record<string, any> };

let mockUserId: string | null = "U-me";
jest.mock("@/lib/auth", () => ({
  requireMember: jest.fn(() => Promise.resolve(mockUserId)),
  requireMemberProfileComplete: jest.fn(() => Promise.resolve(mockUserId)),
}));

interface Doc {
  id: string;
  data: Record<string, unknown>;
}

let ownDocs: Doc[] = [];
let companionDocs: Doc[] = [];
let whereCalls: { field: string; op: string; value: unknown }[][] = [];

const mockDb = {
  collection: jest.fn((name: string) => {
    if (name !== "reservations") throw new Error(`unexpected collection: ${name}`);
    const calls: { field: string; op: string; value: unknown }[] = [];
    whereCalls.push(calls);
    const query = {
      where(field: string, op: string, value: unknown) {
        calls.push({ field, op, value });
        return query;
      },
      async get() {
        const isCompanionQuery = calls.some((c) => c.op === "array-contains");
        const docs = isCompanionQuery ? companionDocs : ownDocs;
        return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
      },
    };
    return query;
  }),
};

jest.mock("@/lib/firebaseAdmin", () => ({ getDb: () => mockDb }));
jest.mock("@/lib/facilities", () => ({ getFacilityById: jest.fn() }));
jest.mock("@/lib/googleCalendar", () => ({
  checkAvailability: jest.fn(),
  createCalendarEvent: jest.fn(),
  deleteCalendarEvent: jest.fn(),
}));
jest.mock("@/lib/line", () => ({ sendReservationConfirmed: jest.fn() }));

jest.mock("next/server", () => ({
  NextResponse: {
    json: (data: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      _data: data,
    }),
  },
}));

import { GET } from "@/app/api/reservations/route";

const asMock = (res: unknown): MockRes => res as MockRes;
const req = {} as never;

function confirmed(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    facilityId: "sauna",
    facilityName: "サウナ",
    lineUserId: "U-owner",
    date: "2026-08-01",
    startTime: "10:00",
    endTime: "12:00",
    googleEventId: "ev",
    status: "confirmed",
    createdAt: "2026-07-29T00:00:00.000Z",
    ...over,
  };
}

describe("GET /api/reservations — 同伴者の予約", () => {
  beforeEach(() => {
    mockUserId = "U-me";
    ownDocs = [];
    companionDocs = [];
    whereCalls = [];
    jest.clearAllMocks();
  });

  test("未認証は401", async () => {
    mockUserId = null;
    expect(asMock(await GET(req)).status).toBe(401);
  });

  test("自分の予約と同伴予約の両方が返り、isCompanion で区別できる", async () => {
    ownDocs = [{ id: "r-own", data: confirmed({ lineUserId: "U-me", startTime: "09:00" }) }];
    companionDocs = [
      { id: "r-comp", data: confirmed({ companionIds: ["U-me"], organizerName: "山田太郎" }) },
    ];

    const res = asMock(await GET(req));
    expect(res.status).toBe(200);
    const list = res._data.reservations;
    expect(list).toHaveLength(2);
    expect(list.find((r: any) => r.reservationId === "r-own").isCompanion).toBe(false);
    const companion = list.find((r: any) => r.reservationId === "r-comp");
    expect(companion.isCompanion).toBe(true);
    expect(companion.organizerName).toBe("山田太郎");
  });

  test("同伴者には解錠コードと決済情報を渡さない", async () => {
    companionDocs = [
      {
        id: "r-comp",
        data: confirmed({
          companionIds: ["U-me"],
          switchBotPasscode: "123456",
          switchBotKeyId: 42,
          switchBotPasscodeExpiresAt: "2026-08-01T03:00:00.000Z",
          switchBotStatus: "issued",
          paymentId: "sq-payment",
          paymentTransactionId: "sq-order",
        }),
      },
    ];

    const res = asMock(await GET(req));
    const companion = res._data.reservations[0];
    expect(companion.switchBotPasscode).toBeUndefined();
    expect(companion.switchBotKeyId).toBeUndefined();
    expect(companion.switchBotPasscodeExpiresAt).toBeUndefined();
    expect(companion.switchBotStatus).toBeUndefined();
    expect(companion.paymentId).toBeUndefined();
    expect(companion.paymentTransactionId).toBeUndefined();
    // 施設・日時は同伴者にも必要
    expect(companion.facilityName).toBe("サウナ");
  });

  test("予約者本人には解錠コードを渡す（回帰）", async () => {
    ownDocs = [
      { id: "r-own", data: confirmed({ lineUserId: "U-me", switchBotPasscode: "123456" }) },
    ];
    const res = asMock(await GET(req));
    expect(res._data.reservations[0].switchBotPasscode).toBe("123456");
  });

  test("同伴側のキャンセル済みはメモリで除外する", async () => {
    companionDocs = [
      { id: "r-cancelled", data: confirmed({ companionIds: ["U-me"], status: "cancelled" }) },
      { id: "r-pending", data: confirmed({ companionIds: ["U-me"], status: "pending_payment" }) },
      { id: "r-ok", data: confirmed({ companionIds: ["U-me"] }) },
    ];
    const res = asMock(await GET(req));
    expect(res._data.reservations.map((r: any) => r.reservationId)).toEqual(["r-ok"]);
  });

  test("予約者かつ同伴者の重複は1件に畳み、予約者側を優先する", async () => {
    const data = confirmed({ lineUserId: "U-me", companionIds: ["U-me"], switchBotPasscode: "999999" });
    ownDocs = [{ id: "r-dup", data }];
    companionDocs = [{ id: "r-dup", data }];

    const res = asMock(await GET(req));
    expect(res._data.reservations).toHaveLength(1);
    expect(res._data.reservations[0].isCompanion).toBe(false);
    expect(res._data.reservations[0].switchBotPasscode).toBe("999999");
  });

  test("合成後も 日付 → 開始時刻 の昇順になる", async () => {
    ownDocs = [
      { id: "a", data: confirmed({ lineUserId: "U-me", date: "2026-08-02", startTime: "09:00" }) },
      { id: "b", data: confirmed({ lineUserId: "U-me", date: "2026-08-01", startTime: "15:00" }) },
    ];
    companionDocs = [
      { id: "c", data: confirmed({ companionIds: ["U-me"], date: "2026-08-01", startTime: "10:00" }) },
    ];
    const res = asMock(await GET(req));
    expect(res._data.reservations.map((r: any) => r.reservationId)).toEqual(["c", "b", "a"]);
  });

  /* ── 決済待ちの仮押さえ（見えないと枠を握ったまま解放できない） ── */
  describe("自分の仮押さえ（pending_payment）", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();

    test("有効な仮押さえは返す（利用者が自分で取り消して枠を解放できるように）", async () => {
      ownDocs = [
        {
          id: "r-pending",
          data: confirmed({
            lineUserId: "U-me",
            status: "pending_payment",
            pendingExpiresAt: future,
          }),
        },
      ];
      const res = asMock(await GET(req));
      const list = res._data.reservations;
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe("pending_payment");
      expect(list[0].pendingExpiresAt).toBe(future);
    });

    test("失効した仮押さえは返さない（枠を握っていないので出す意味がない）", async () => {
      ownDocs = [
        {
          id: "r-expired",
          data: confirmed({ lineUserId: "U-me", status: "pending_payment", pendingExpiresAt: past }),
        },
      ];
      expect(asMock(await GET(req))._data.reservations).toHaveLength(0);
    });

    test("pendingExpiresAt が無い仮押さえは返さない", async () => {
      ownDocs = [
        { id: "r-noexp", data: confirmed({ lineUserId: "U-me", status: "pending_payment" }) },
      ];
      expect(asMock(await GET(req))._data.reservations).toHaveLength(0);
    });

    test("自分のキャンセル済みは返さない（回帰）", async () => {
      ownDocs = [
        { id: "r-cancelled", data: confirmed({ lineUserId: "U-me", status: "cancelled" }) },
        { id: "r-ok", data: confirmed({ lineUserId: "U-me" }) },
      ];
      expect(asMock(await GET(req))._data.reservations.map((r: any) => r.reservationId)).toEqual([
        "r-ok",
      ]);
    });

    test("自分側クエリに status の等値条件を重ねない（メモリで絞る＝複合インデックスを増やさない）", async () => {
      await GET(req);
      const ownQuery = whereCalls.find((calls) =>
        calls.some((c) => c.field === "lineUserId")
      );
      expect(ownQuery).toEqual([{ field: "lineUserId", op: "==", value: "U-me" }]);
    });
  });

  test("同伴側クエリに status の等値条件を重ねない（複合インデックス回避の回帰）", async () => {
    await GET(req);
    const companionQuery = whereCalls.find((calls) =>
      calls.some((c) => c.op === "array-contains")
    );
    expect(companionQuery).toEqual([
      { field: "companionIds", op: "array-contains", value: "U-me" },
    ]);
  });
});
