/**
 * 単体テスト: カレンダー連携機能 — Firestore施設CRUD
 * getFacilities / getAllFacilities / createFacility / updateFacility / deleteFacility のテスト
 */
import type { Facility } from "@/types";

// Firestoreモックデータ
const mockFacilities: Record<string, Partial<Facility>> = {
  "room-a": { name: "会議室A", type: "meeting_room", capacity: 6, calendarId: "cal-a@google.com", active: true, order: 1 },
  "room-b": { name: "会議室B", type: "meeting_room", capacity: 4, calendarId: "cal-b@google.com", active: false, order: 2 },
  "booth-1": { name: "ブース1", type: "booth", capacity: 1, calendarId: "cal-c@google.com", active: true, order: 3 },
};

let lastSetData: Record<string, unknown> = {};
let lastDeletedId = "";
let lastUpdatedId = "";
let lastUpdateData: Record<string, unknown> = {};

// Firestoreモック
jest.mock("@/lib/firebaseAdmin", () => ({
  getDb: () => ({
    collection: () => ({
      get: async () => ({
        empty: false,
        docs: Object.entries(mockFacilities).map(([id, data]) => ({
          id,
          data: () => data,
          exists: true,
        })),
      }),
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            empty: false,
            docs: [{ data: () => ({ order: 3 }) }],
          }),
        }),
      }),
      doc: (id: string) => ({
        get: async () => {
          const data = mockFacilities[id];
          return {
            exists: !!data,
            id,
            data: () => data,
          };
        },
        set: async (d: Record<string, unknown>) => { lastSetData = d; },
        update: async (d: Record<string, unknown>) => { lastUpdatedId = id; lastUpdateData = d; },
        delete: async () => { lastDeletedId = id; },
      }),
      add: async (d: Record<string, unknown>) => { lastSetData = d; return { id: "new-id" }; },
    }),
  }),
}));

import { getFacilities, getAllFacilities, getFacilityById, createFacility, updateFacility, deleteFacility } from "@/lib/facilities";

describe("カレンダー連携 — 施設CRUD", () => {
  beforeEach(() => {
    lastSetData = {};
    lastDeletedId = "";
    lastUpdatedId = "";
    lastUpdateData = {};
  });

  // ─── getFacilities（公開用：activeのみ） ─────────────────────
  test("getFacilities はactiveな施設のみ返す", async () => {
    const facilities = await getFacilities();
    const names = facilities.map((f) => f.name);
    expect(names).toContain("会議室A");
    expect(names).toContain("ブース1");
    expect(names).not.toContain("会議室B"); // active: false
  });

  test("getFacilities はorder昇順でソートされる", async () => {
    const facilities = await getFacilities();
    for (let i = 1; i < facilities.length; i++) {
      expect((facilities[i].order ?? 0)).toBeGreaterThanOrEqual((facilities[i - 1].order ?? 0));
    }
  });

  // ─── getAllFacilities（管理用：全件） ────────────────────────
  test("getAllFacilities は全施設（非アクティブ含む）を返す", async () => {
    const facilities = await getAllFacilities();
    expect(facilities.length).toBe(3);
    const names = facilities.map((f) => f.name);
    expect(names).toContain("会議室B"); // active: false も含む
  });

  test("getAllFacilities もorder昇順でソートされる", async () => {
    const facilities = await getAllFacilities();
    for (let i = 1; i < facilities.length; i++) {
      expect((facilities[i].order ?? 0)).toBeGreaterThanOrEqual((facilities[i - 1].order ?? 0));
    }
  });

  // ─── getFacilityById ────────────────────────────────────────
  test("getFacilityById で存在する施設を取得できる", async () => {
    const facility = await getFacilityById("room-a");
    expect(facility).toBeDefined();
    expect(facility?.name).toBe("会議室A");
    expect(facility?.type).toBe("meeting_room");
  });

  test("getFacilityById で存在しないIDはフォールバックを検索する", async () => {
    const facility = await getFacilityById("meetingroom-a");
    // フォールバックデータに含まれるID
    expect(facility).toBeDefined();
  });

  // ─── createFacility ─────────────────────────────────────────
  test("createFacility で施設データが保存される", async () => {
    const result = await createFacility({
      name: "会議室D",
      calendarId: "cal-d@google.com",
      type: "meeting_room",
      capacity: 8,
      active: true,
    });
    expect(result).toBeDefined();
    expect(result.name).toBe("会議室D");
    expect(result.calendarId).toBe("cal-d@google.com");
  });

  // ─── updateFacility ─────────────────────────────────────────
  test("updateFacility でupdatedAtが設定される", async () => {
    await updateFacility("room-a", { name: "会議室A改" });
    expect(lastUpdatedId).toBe("room-a");
    expect(lastUpdateData.name).toBe("会議室A改");
    expect(lastUpdateData.updatedAt).toBeDefined();
  });

  // ─── deleteFacility ─────────────────────────────────────────
  test("deleteFacility で施設が削除される", async () => {
    await deleteFacility("room-b");
    expect(lastDeletedId).toBe("room-b");
  });
});
