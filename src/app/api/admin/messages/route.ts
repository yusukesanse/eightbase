import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb, getActiveLineUserIdsByRoles } from "@/lib/firebaseAdmin";
import { sendAdminMessage, getMessageQuota } from "@/lib/line";
import type { UserRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const VALID_ROLES: UserRole[] = ["member", "staff", "guest"];
const MAX_TEXT = 5000; // LINE テキストメッセージの上限

/** クエリ/ボディの roles を既知 role 配列に正規化（重複排除）。 */
function parseRoles(input: unknown): UserRole[] {
  const arr = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];
  return Array.from(
    new Set(arr.map((r) => String(r).trim()).filter((r): r is UserRole => VALID_ROLES.includes(r as UserRole)))
  );
}

/**
 * GET /api/admin/messages?roles=member,staff
 * 送信前の確認用に「対象人数」と「今月の残り配信通数」を返す（送信はしない）。
 *
 * 残量を返すのは、LINE が **宛先1人＝1通** で数えるため。対象人数 > 残量なら送っても
 * 上限超過で弾かれるので、送信前に気づけるようにする。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const roles = parseRoles(req.nextUrl.searchParams.get("roles"));
    // 残量の取得に失敗しても人数表示は出す（送信前の目安であり、送信可否の最終判定ではない）。
    const quota = await getMessageQuota().catch(() => undefined);
    if (roles.length === 0) return NextResponse.json({ count: 0, roles: [], quota });
    const ids = await getActiveLineUserIdsByRoles(roles);
    return NextResponse.json({ count: ids.length, roles, quota });
  } catch (error) {
    console.error("[admin/messages] GET error:", error);
    return NextResponse.json({ error: "対象人数の取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/messages
 * body: { text: string; linkUrl?: string; roles: UserRole[] }
 * 指定 role の登録ユーザーのみへ LINE 配信（未登録フォロワー＝第三者には届かない）。
 */
export async function POST(req: NextRequest) {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const linkUrl = typeof body.linkUrl === "string" ? body.linkUrl.trim() : "";
    const roles = parseRoles(body.roles);

    if (!text) return NextResponse.json({ error: "本文を入力してください" }, { status: 400 });
    if (text.length > MAX_TEXT) {
      return NextResponse.json({ error: `本文は${MAX_TEXT}文字以内で入力してください` }, { status: 400 });
    }
    if (roles.length === 0) {
      return NextResponse.json({ error: "宛先を1つ以上選択してください" }, { status: 400 });
    }
    if (linkUrl && !/^https?:\/\//.test(linkUrl)) {
      return NextResponse.json({ error: "リンクは http(s) のURLで入力してください" }, { status: 400 });
    }

    const ids = await getActiveLineUserIdsByRoles(roles);
    if (ids.length === 0) {
      return NextResponse.json({ success: true, sent: 0, message: "対象ユーザーがいません" });
    }

    const outcome = await sendAdminMessage(ids, text, linkUrl || undefined);

    // 送信履歴（監査）。本処理は止めない。成否も残す（後から「送ったのに届かない」を追える）。
    try {
      await getDb().collection("adminMessageLogs").add({
        actor: admin,
        roles,
        recipientCount: ids.length,
        deliveredCount: outcome.deliveredCount,
        ok: outcome.ok,
        ...(outcome.error ? { error: outcome.error } : {}),
        textPreview: text.slice(0, 200),
        hasLink: !!linkUrl,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error("[admin/messages] audit log failed:", e);
    }

    // LINE が拒否したのに success を返さない。配信上限超過はここに出る。
    if (!outcome.ok) {
      return NextResponse.json(
        {
          error: outcome.error ?? "LINE配信に失敗しました",
          sent: outcome.deliveredCount,
          recipientCount: ids.length,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true, sent: outcome.deliveredCount });
  } catch (error) {
    console.error("[admin/messages] POST error:", error);
    return NextResponse.json({ error: "送信に失敗しました" }, { status: 500 });
  }
}
