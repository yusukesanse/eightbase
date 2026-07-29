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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 5_000;

function isAllowedAvatarUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    ALLOWED_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix)) &&
    !url.username &&
    !url.password &&
    !url.port
  );
}

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

  if (!isAllowedAvatarUrl(parsed)) {
    return NextResponse.json({ error: "許可されていないURLです" }, { status: 400 });
  }

  try {
    // Redirect を自動追従すると、許可ホストの 3xx を踏み台に内部ネットワークへ
    // 到達できるため禁止する。画像用途なので応答時間とサイズにも上限を設ける。
    const res = await fetch(parsed.toString(), {
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "取得に失敗しました" }, { status: 502 });
    }

    const contentType = (res.headers.get("content-type") || "")
      .split(";", 1)[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
      return NextResponse.json({ error: "画像ではありません" }, { status: 415 });
    }

    const declaredLength = Number(res.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "画像サイズが大きすぎます" }, { status: 413 });
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "画像サイズが大きすぎます" }, { status: 413 });
    }

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buf.byteLength),
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[avatar] proxy error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 502 });
  }
}
