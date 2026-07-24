/**
 * 単体テスト: 管理施設API /api/admin/facilities
 * 認証チェック、CRUD操作、バリデーション、Square認証情報の分離保存のテスト
 */
import type { Facility } from "@/types";

/** NextResponse モックの戻り値型（_data はモックが付与する） */
type MockRes = { status: number; _data: Record<string, any>; json: () => Promise<unknown> };

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

// facilitySecrets モック（Square認証情報は facilities ドキュメントと分離して保存される）
const mockSaveSecrets = jest.fn().mockResolvedValue(undefined);
const mockClearSecrets = jest.fn().mockResolvedValue(undefined);
const mockStatusMap = jest.fn().mockResolvedValue({});
let mockKeyConfigured = true;
jest.mock("@/lib/facilitySecrets", () => ({
  saveFacilitySquareSecrets: (...args: unknown[]) => mockSaveSecrets(...args),
  clearFacilitySquareSecrets: (...args: unknown[]) => mockClearSecrets(...args),
  getFacilitySquareStatusMap: (...args: unknown[]) => mockStatusMap(...args),
  isSecretsKeyConfigured: () => mockKeyConfigured,
  SECRETS_KEY_MISSING_MESSAGE: "FACILITY_SECRETS_KEY が未設定のため保存できません。",
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

const asMock = (res: unknown): MockRes => res as MockRes;

describe("管理施設API — /api/admin/facilities", () => {
  beforeEach(() => {
    mockIsAdmin = true;
    mockKeyConfigured = true;
    jest.clearAllMocks();
    mockGetAllFacilities.mockResolvedValue(mockFacilities);
    mockStatusMap.mockResolvedValue({});
  });

  // ─── 認証チェック ──────────────────────────────────────────
  describe("認証", () => {
    test("GET: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities");
      const res = asMock(await GET(req));
      expect(res.status).toBe(401);
    });

    test("POST: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "test", calendarId: "cal", type: "booth", capacity: 1 }),
      });
      const res = asMock(await POST(req));
      expect(res.status).toBe(401);
    });

    test("PUT: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", name: "updated" }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(401);
    });

    test("DELETE: 未認証は401を返す", async () => {
      mockIsAdmin = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "DELETE",
        body: JSON.stringify({ id: "room-a" }),
      });
      const res = asMock(await DELETE(req));
      expect(res.status).toBe(401);
    });
  });

  // ─── GET ────────────────────────────────────────────────────
  describe("GET", () => {
    test("施設一覧を取得できる", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities");
      const res = asMock(await GET(req));
      expect(res.status).toBe(200);
      expect(res._data.facilities).toBeDefined();
    });

    test("Square設定は「状態」のみ付与され、秘密値は含まれない", async () => {
      mockStatusMap.mockResolvedValue({
        "room-a": { configured: true, environment: "production", locationIdLast4: "ABCD" },
      });
      const req = new NextRequest("http://localhost/api/admin/facilities");
      const res = asMock(await GET(req));
      const facility = res._data.facilities[0];
      expect(facility.square).toEqual({ configured: true, environment: "production", locationIdLast4: "ABCD" });
      expect(res._data.squareKeyConfigured).toBe(true);
      const raw = JSON.stringify(res._data);
      expect(raw).not.toContain("AccessToken");
      expect(raw).not.toContain("squareAccessTokenEnc");
    });

    test("migrate=trueでマイグレーション実行", async () => {
      mockMigrate.mockResolvedValueOnce(6);
      const req = new NextRequest("http://localhost/api/admin/facilities?migrate=true");
      const res = asMock(await GET(req));
      expect(res._data.migrated).toBe(6);
      expect(mockMigrate).toHaveBeenCalled();
    });

    test("migrate=trueでも移行済みなら通常取得", async () => {
      mockMigrate.mockResolvedValueOnce(0);
      const req = new NextRequest("http://localhost/api/admin/facilities?migrate=true");
      const res = asMock(await GET(req));
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
      const res = asMock(await POST(req));
      expect(res.status).toBe(201);
      expect(mockCreateFacility).toHaveBeenCalled();
    });

    test("必須フィールド不足で400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "会議室D" }),
      });
      const res = asMock(await POST(req));
      expect(res.status).toBe(400);
    });

    test("不正なtypeで400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "テスト", calendarId: "cal@google.com", type: "invalid_type", capacity: 1 }),
      });
      const res = asMock(await POST(req));
      expect(res.status).toBe(400);
    });

    test("requirePayment=true で決済額なしは400", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({ name: "トレーラー", calendarId: "cal@google.com", type: "activity", capacity: 4, requirePayment: true }),
      });
      const res = asMock(await POST(req));
      expect(res.status).toBe(400);
      expect(res._data.error).toContain("決済額");
    });

    test("Square認証情報つき作成は facilitySecrets へ保存され、施設ドキュメントには入らない", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "POST",
        body: JSON.stringify({
          name: "トレーラー", calendarId: "cal@google.com", type: "activity", capacity: 4,
          requirePayment: true, paymentAmount: 22000,
          squareAccessToken: "EAAAtoken", squareLocationId: "LOC123", squareEnvironment: "sandbox",
        }),
      });
      const res = asMock(await POST(req));
      expect(res.status).toBe(201);
      expect(mockSaveSecrets).toHaveBeenCalledWith("new-id", {
        accessToken: "EAAAtoken",
        locationId: "LOC123",
        environment: "sandbox",
      });
      // createFacility に渡るデータに秘密値が含まれない
      const created = mockCreateFacility.mock.calls[0][0];
      expect(JSON.stringify(created)).not.toContain("EAAAtoken");
      expect(JSON.stringify(created)).not.toContain("LOC123");
    });
  });

  // ─── PUT ────────────────────────────────────────────────────
  describe("PUT", () => {
    test("idありで施設を更新できる", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", name: "会議室A改" }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(200);
      expect(mockUpdateFacility).toHaveBeenCalled();
      expect(mockSaveSecrets).not.toHaveBeenCalled();
    });

    test("id未指定で400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ name: "test" }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(400);
    });

    test("不正なtypeで400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", type: "invalid" }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(400);
    });

    test("requirePayment=true で決済額なしは400", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", requirePayment: true, paymentAmount: 0 }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(400);
      expect(mockUpdateFacility).not.toHaveBeenCalled();
    });

    test("Square認証情報は facilitySecrets へ保存され、updateFacility には渡らない", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({
          id: "room-a", requirePayment: true, paymentAmount: 22000,
          squareAccessToken: "EAAAnew-token", squareLocationId: "LOC999",
        }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(200);
      expect(mockSaveSecrets).toHaveBeenCalledWith("room-a", {
        accessToken: "EAAAnew-token",
        locationId: "LOC999",
        environment: undefined,
      });
      const updated = mockUpdateFacility.mock.calls[0][1];
      expect(JSON.stringify(updated)).not.toContain("EAAAnew-token");
      expect(JSON.stringify(updated)).not.toContain("LOC999");
      expect(updated.squareAccessToken).toBeUndefined();
      expect(updated.squareLocationId).toBeUndefined();
    });

    test("FACILITY_SECRETS_KEY未設定時、認証情報の保存は400", async () => {
      mockKeyConfigured = false;
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", squareAccessToken: "EAAAtoken", squareLocationId: "LOC1" }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(400);
      expect(res._data.error).toContain("FACILITY_SECRETS_KEY");
      expect(mockUpdateFacility).not.toHaveBeenCalled();
      expect(mockSaveSecrets).not.toHaveBeenCalled();
    });

    test("clearSquareCredentials=true で登録済み認証情報を削除する", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", clearSquareCredentials: true }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(200);
      expect(mockClearSecrets).toHaveBeenCalledWith("room-a");
      expect(mockSaveSecrets).not.toHaveBeenCalled();
    });

    test("不正なsquareEnvironmentは400", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "PUT",
        body: JSON.stringify({ id: "room-a", squareEnvironment: "staging" }),
      });
      const res = asMock(await PUT(req));
      expect(res.status).toBe(400);
    });
  });

  // ─── DELETE ─────────────────────────────────────────────────
  describe("DELETE", () => {
    test("idありで施設を削除でき、Square認証情報も削除される", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "DELETE",
        body: JSON.stringify({ id: "room-a" }),
      });
      const res = asMock(await DELETE(req));
      expect(res.status).toBe(200);
      expect(mockDeleteFacility).toHaveBeenCalledWith("room-a");
      expect(mockClearSecrets).toHaveBeenCalledWith("room-a");
    });

    test("id未指定で400を返す", async () => {
      const req = new NextRequest("http://localhost/api/admin/facilities", {
        method: "DELETE",
        body: JSON.stringify({}),
      });
      const res = asMock(await DELETE(req));
      expect(res.status).toBe(400);
    });
  });
});
