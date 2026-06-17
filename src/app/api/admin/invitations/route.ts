import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { isPreviewMode } from "@/lib/preview";
import { getDb } from "@/lib/firebaseAdmin";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const INVITATION_EXPIRY_DAYS = 7;

/**
 * GET /api/admin/invitations
 * 招待一覧を取得（ステータス付き）
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
    const snap = await db
      .collection("invitations")
      .orderBy("createdAt", "desc")
      .get();

    const now = Date.now();
    const invitations = snap.docs.map((doc) => {
      const d = doc.data();
      const createdAt = d.createdAt as string;
      const expiresAt = d.expiresAt as string;
      const usedAt = d.usedAt as string | null;
      const lineUserId = d.lineUserId as string | null;

      let status: "unused" | "used" | "expired" = "unused";
      if (usedAt || lineUserId) {
        status = "used";
      } else if (new Date(expiresAt).getTime() < now) {
        status = "expired";
      }

      return {
        id: doc.id,
        displayName: d.displayName || "",
        token: d.token || "",
        status,
        createdAt,
        expiresAt,
        usedAt: usedAt || null,
        lineUserId: lineUserId || null,
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
 * 新規ユーザーの招待を作成（ワンタイムURL用トークン発行）
 *
 * Body: { displayName: string }
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { displayName } = await req.json();

    if (!displayName || typeof displayName !== "string" || !displayName.trim()) {
      return NextResponse.json(
        { error: "名前を入力してください" },
        { status: 400 }
      );
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const db = getDb();
    const nowStr = now.toISOString();

    // 招待レコード作成
    const inviteRef = await db.collection("invitations").add({
      displayName: displayName.trim(),
      token,
      createdAt: nowStr,
      expiresAt: expiresAt.toISOString(),
      usedAt: null,
      lineUserId: null,
    });

    // authorizedUsers にも即時作成（ユーザー一覧に表示するため）
    await db.collection("authorizedUsers").add({
      displayName: displayName.trim(),
      email: "",
      passwordHash: "",
      salt: "",
      lineUserId: null,
      active: true,
      profileComplete: false,
      createdAt: nowStr,
      lastLoginAt: null,
      invitationId: inviteRef.id,
    });

    return NextResponse.json({
      success: true,
      id: inviteRef.id,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/invitations] POST error:", error);
    return NextResponse.json({ error: "招待の作成に失敗しました" }, { status: 500 });
  }
}

/**
 * PATCH /api/admin/invitations
 * 招待URLを再発行（既存トークンを無効化して新しいトークンを発行）
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

    const token = crypto.randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITATION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await docRef.update({
      token,
      expiresAt: expiresAt.toISOString(),
    });

    return NextResponse.json({
      success: true,
      token,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("[admin/invitations] PATCH error:", error);
    return NextResponse.json({ error: "再発行に失敗しました" }, { status: 500 });
  }
}
