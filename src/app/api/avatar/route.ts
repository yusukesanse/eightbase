import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/avatar?url=...
 * LINE / Google のプロフィール画像を同一オリジンでプロキシする。
 * WebGL テクスチャ（canvas 合成）が CORS で弾かれないようにするための画像中継。
 * SSRF 防止のためホストを許可リストに限定。
 */
const ALLOWED_HOST_SUFFIXES = [
  ".line-scdn.net",
  ".googleusercontent.com",
];

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "url が必要です" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "url が不正です" }, { status: 400 });
  }

  if (
    parsed.protocol !== "https:" ||
    !ALLOWED_HOST_SUFFIXES.some((s) => parsed.hostname.endsWith(s))
  ) {
    return NextResponse.json({ error: "許可されていないURLです" }, { status: 400 });
  }

  try {
    const res = await fetch(parsed.toString());
    if (!res.ok) {
      return NextResponse.json({ error: "取得に失敗しました" }, { status: 502 });
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (error) {
    console.error("[avatar] proxy error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 502 });
  }
}
