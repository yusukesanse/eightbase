import { NextRequest } from "next/server";
import { GET } from "@/app/api/avatar/route";

const originalFetch = global.fetch;

function request(url: string) {
  return new NextRequest(
    `http://localhost/api/avatar?url=${encodeURIComponent(url)}`
  );
}

describe("GET /api/avatar", () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("rejects non-allowlisted hosts without fetching", async () => {
    global.fetch = jest.fn();

    const response = await GET(request("https://example.com/avatar.jpg"));

    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("disables redirects to prevent allowlist bypass", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1" } })
    );

    const response = await GET(
      request("https://profile.line-scdn.net/avatar.jpg")
    );

    expect(response.status).toBe(502);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://profile.line-scdn.net/avatar.jpg",
      expect.objectContaining({ redirect: "error" })
    );
  });

  it("rejects non-image and active SVG responses", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("<svg/>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      })
    );

    const response = await GET(
      request("https://lh3.googleusercontent.com/avatar")
    );

    expect(response.status).toBe(415);
  });

  it("rejects images over the configured size before buffering", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("x", {
        status: 200,
        headers: {
          "content-type": "image/jpeg",
          "content-length": String(5 * 1024 * 1024 + 1),
        },
      })
    );

    const response = await GET(
      request("https://profile.line-scdn.net/avatar.jpg")
    );

    expect(response.status).toBe(413);
  });

  it("returns a bounded image with defensive response headers", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png; charset=binary" },
      })
    );

    const response = await GET(
      request("https://profile.line-scdn.net/avatar.png")
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
