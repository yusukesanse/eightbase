import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isPreviewMode } from "@/lib/preview";
import { getDb } from "@/lib/firebaseAdmin";
import { generatePasscode, hashPasscode } from "@/lib/passcode";
import { sendPasscodeEmail } from "@/lib/email";

export const dynamic = "force-dynamic";

const INVITATION_EXPIRY_DAYS = 7;
const MAX_PASSCODE_ATTEMPTS = 5;

/**
 * GET /api/admin/invitations
 * 招待一覧（ステータス付き、パスコードは返さない）
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isPreviewMode(req)) {
    return NextResponse.json({ invitations: [], _preview: true });
  }

  try {
    const db = getDb();
    const snap = await db.collection("invitations").orderBy("createdAt", "desc").get();
    const now = Date.now();

    const invitations = snap.docs.map((doc) => {
      const d = doc.data();
      const usedAt = d.usedAt as string | null;
      const lineUserId = d.lineUserId as string | null;
      const expiresAt = d.expiresAt as string;

      let status: "unused" | "used" | "expired" = "unused";
      if (usedAt || lineUserId) {
        status = "used";
      } else if (new Date(expiresAt).getTime() < now) {
        status = "expired";
      }

      return {
        id: doc.id,
        displayName: d.displayName || "",
        email: (d.email as string) || "",
        status,
        createdAt: d.createdAt as string,
        expiresAt,
        usedAt: usedAt || null,
      };
    });

    return NextResponse.json({ invitations });
  } catch (error) {
    console.error("[admin/invitations] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/invitations
 * 新規招待を作成（ワンタイムパスコード発行）
 * パスコードはハッシュで保存し、平文はこのレスポンスでのみ返却
 *
 * Body: { displayName: string }
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { displayName, email } = await req.json();
    if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
      return NextResponse.json({ error: "名前を入力してください" }, { status: 400 });
    }
    if (!email || typeof email !== "string" || !email.trim()) {
      return NextResponse.json({ error: "メールアドレスを入力してください" }, { status: 400 });
    }

    const db = getDb();

    // 重複チェック付きパスコード生成（最大5回）
    let passcode = "";
    let pHash = "";
    for (let i = 0; i < MAX_PASSCODE_ATTEMPTS; i++) {
      passcode = generatePasscode();
      pHash = hashPasscode(passcode);
      const dup = await db
        .collection("invitations")
        .where("passcodeHash", "==", pHash)
        .where("usedAt", "==", null)
        .limit(1)
        .get();
      if (dup.empty) break;
      if (i === MAX_PASSCODE_ATTEMPTS - 1) {
        return NextResponse.json({ error: "パスコード生成に失敗しました。再試行してください" }, { status: 500 });
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
    const nowStr = now.toISOString();

    const trimmedEmail = email.trim().toLowerCase();

    const inviteRef = await db.collection("invitations").add({
      displayName: displayName.trim(),
      email: trimmedEmail,
      passcodeHash: pHash,
      createdAt: nowStr,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      lineUserId: null,
    });

    // authorizedUsers にも即時作成（ユーザー一覧に表示するため）
    await db.collection("authorizedUsers").add({
      displayName: displayName.trim(),
      email: trimmedEmail,
      passwordHash: "",
      salt: "",
      lineUserId: null,
      active: true,
      profileComplete: false,
      createdAt: nowStr,
      lastLoginAt: null,
      invitationId: inviteRef.id,
      inviteStatus: "pending",
    });

    // メールでパスコードを送信
    let emailSent = false;
    try {
      await sendPasscodeEmail(trimmedEmail, displayName.trim(), passcode);
      emailSent = true;
    } catch (emailError) {
      console.error("[admin/invitations] Email send error:", emailError);
    }

    return NextResponse.json({
      success: true,
      id: inviteRef.id,
      passcode,
      emailSent,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/invitations] POST error:", error);
    return NextResponse.json({ error: "招待の作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/invitations
 * パスコードを再発行（新ハッシュで上書き、有効期限リセット）
 *
 * Body: { id: string }
 */
export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "IDは必須です" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("invitations").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: "招待が見つかりません" }, { status: 404 });
    }

    const data = doc.data()!;
    if (data.usedAt || data.lineUserId) {
      return NextResponse.json({ error: "使用済みの招待は再発行できません" }, { status: 400 });
    }

    const passcode = generatePasscode();
    const pHash = hashPasscode(passcode);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await docRef.update({
      passcodeHash: pHash,
      expiresAt: expiresAt.toISOString(),
    });

    // メールでパスコードを再送
    let emailSent = false;
    const savedEmail = data.email as string | undefined;
    if (savedEmail) {
      try {
        await sendPasscodeEmail(savedEmail, data.displayName || "", passcode);
        emailSent = true;
      } catch (emailError) {
        console.error("[admin/invitations] Email resend error:", emailError);
      }
    }

    return NextResponse.json({
      success: true,
      passcode,
      emailSent,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/invitations] PATCH error:", error);
    return NextResponse.json({ error: "再発行に失敗しました" }, { status: 500 });
  }
}
