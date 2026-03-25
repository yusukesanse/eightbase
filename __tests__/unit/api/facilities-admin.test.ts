/**
 * 単体テスト: 管理施設API /api/admin/facilities
 * 認証チェック、CRUD操作、バリデーションのテスト
 */
import type { Facility } from "@/types";

const mockFacilities: Facility[] = [
  { id: "room-a", name: "会議室A", type: "meeting_room", capacity: 6, calendarId: "cal-a@google.com", active: true, order: 1 },
];

let mockIsAdmin = true;

// adminAuth モック
jest.mock("@/lib/adminAuth", () => ({
  checkAdminAuth: jest.fn().mockImplementation(() => Promise.resolve(mockIsAdmin)),
  validateFields: jest.fn().mockReturnValue(null),
  pickAllowedFields: jest.fn().mockImplementation((body: Record<string, unknown>, fields: string[]) => {
    const result: Record<string, unknown> = {};
    for (const key of fields) {
      if (key in body) result[key] = body[key];
    }
    return result;
  }),
}));

// facilities モック
const mockGetAllFacilities = jest.fn().mockResolvedValue(mockFacilities);
const mockCreateFacility = jest.fn().mockResolvedValue({ id: "new-id", name: "新施設", type: "meeting_room", capacity: 4, calendarId: "cal@google.com", active: true });
const mockUpdateFacility = jest.fn().mockResolvedValue(undefined);
const mockDeleteFacility = jest.fn().mockResolvedValue(undefined);
const mockMigrate = jest.fn().mockResolvedValue(0);

jest.mock("@/lib/facilities", () => ({
  getAllFacilities: (...args: unknown[]) => mockGetAllFacilities(...args),
  createFacility: (...args: unknown[]) => mockCreateFacility(...args),
  updateFacility: (...args: unknown[]) => mockUpdateFacility(...args),
  deleteFacility: (...args: unknown[]) => mockDeleteFacility(...args),
  migrateFallbackToFirestore: (...args: unknown[]) => mockMigrate(...args),
}));

// NextResponse モック
jest.mock("next/server", () => {
  class MockNextRequest {
    private _body: string;
    nextUrl: { searchParams: URLSearchParams };
    cookies: Map<string, unknown>;
    headers: Map<string, string>;

    constructor(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) {
      this._body = init?.body ?? "{}";
      const parsedUrl = new URL(url, "http://localhost");
      this.nextUrl = { searchParams: parsedUrl.searchParams };
      this.cookies = new Map();
      this.headers = new Map(Object.entries(init?.headers ?? {}));
    }
    async json() { return JSON.parse(this._body); }
  }
  return {
    NextRequest: MockNextRequest,
    NextResponse: {
      json: (data: unknown, init?: { status?: number }) => ({
        status: init?.status ?? 200,
        _data: data,
        json: async () => data,
      }),
    },
  };
});

import { GET, POST, PUT, DELETE } from "@/app/api/admin/facilities/route";
import { NextRequest } from "next/server";

describe("管理施設API — /api/admin/facilities", () => {
  beforeEach(() => {
    mockIsAdmin = true;
    jest.clearAllMocks();
  });

  // ─── 認証チェック ──────────────────────────────────────────
  describe("認証", () => {
    test("GET: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities");
      const res = await GET(req);
      expect(res.status).toBe(401);
    });

    test("POST: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "test", calendarId: "cal", type: "booth", capacity: 1 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    test("PUT: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", name: "updated" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(401);
    });

    test("DELETE: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "DELETE",
        body: JSON.stringify({ id: "room-a" }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(401);
    });
  });

  // ─── GET ────────────────────────────────────────────────────
  describe("GET", () => {
    test("施設一覧を取得できる", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities");
      const res = await GET(req);
      expect(res.status).toBe(200);
      expect(res._data.facilities).toBeDefined();
    });

    test("migrate=trueでマイグレーション実行", async () => {
      mockMigrate.mockResolvedValueOnce(6);
      const req = new NextRequest("http://localhost/api/admin/facilities?migrate=true");
      const res = await GET(req);
      expect(res._data.migrated).toBe(6);
      expect(mockMigrate).toHaveBeenCalled();
    });

    test("migrate=trueでも移行済みなら通常取得", async () => {
      mockMigrate.mockResolvedValueOnce(0);
      const req = new NextRequest("http://localhost/api/admin/facilities?migrate=true");
      const res = await GET(req);
      expect(res._data.facilities).toBeDefined();
    });
  });

  // ─── POST ───────────────────────────────────────────────────
  describe("POST", () => {
    test("必須フィールドありで施設を作成できる", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "会議室D", calendarId: "cal-d@google.com", type: "meeting_room", capacity: 8 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(mockCreateFacility).toHaveBeenCalled();
    });

    test("必須フィールド不足で400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "会議室D" }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    test("不正なtypeで400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "テスト", calendarId: "cal@google.com", type: "invalid_type", capacity: 1 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // ─── PUT ────────────────────────────────────────────────────
  describe("PUT", () => {
    test("idありで施設を更新できる", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", name: "会議室A改" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(200);
      expect(mockUpdateFacility).toHaveBeenCalled();
    });

    test("id未指定で400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ name: "test" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });

    test("不正なtypeで400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", type: "invalid" }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE ─────────────────────────────────────────────────
  describe("DELETE", () => {
    test("idありで施設を削除できる", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "DELETE",
        body: JSON.stringify({ id: "room-a" }),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(200);
      expect(mockDeleteFacility).toHaveBeenCalledWith("room-a");
    });

    test("id未指定で400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = await DELETE(req);
      expect(res.status).toBe(400);
    });
  });
});
