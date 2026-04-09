import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const ITERATIONS = 100_000;

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, 64, "sha256").toString("hex");
}

/**
 * POST /api/admin/users
 * 管理者がユーザーを新規登録する。
 * Headers: Authorization: Bearer {ADMIN_API_TOKEN}
 * Body: { email, password, displayName, tenantName? }
 */
export async function POST(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { email, password, displayName, tenantName = "" } = await req.json();

    if (!email || !password || !displayName) {
      return NextResponse.json(
        { error: "email, password, displayName は必須です" },
        { status: 400 }
      );
    }

    const db = getDb();

    // 重複チェック
    const existing = await db
      .collection("authorizedUsers")
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();

    if (!existing.empty) {
      return NextResponse.json(
        { error: "このメールアドレスは既に登録されています" },
        { status: 409 }
      );
    }

    const salt = crypto.randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);

    const docRef = await db.collection("authorizedUsers").add({
      email: email.toLowerCase().trim(),
      passwordHash,
      salt,
      iterations: ITERATIONS,
      displayName,
      tenantName,
      lineUserId: null,
      active: true,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    });

    return NextResponse.json({ success: true, id: docRef.id });
  } catch (error) {
    console.error("[admin/users] POST error:", error);
    return NextResponse.json(
      { error: "ユーザー作成に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/users
 * 管理者がユーザー一覧を取得する。
 * Headers: Authorization: Bearer {ADMIN_API_TOKEN}
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db
      .collection("authorizedUsers")
      .orderBy("createdAt", "desc")
      .get();

    const users = snap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        email: d.email,
        displayName: d.displayName,
        tenantName: d.tenantName,
        lineUserId: d.lineUserId ?? null,
        active: d.active,
        profileComplete: !!d.profileComplete,
        createdAt: d.createdAt,
        lastLoginAt: d.lastLoginAt ?? null,
      };
    });

    return NextResponse.json({ users });
  } catch (error) {
    console.error("[admin/users] GET error:", error);
    return NextResponse.json(
      { error: "ユーザー一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/admin/users
 * ユーザーのステータス変更（有効化/無効化）やパスワードリセット。
 * Body: { id, active?, newPassword? }
 */
export async function PATCH(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id, active, newPassword } = await req.json();
    if (!id) {
      return NextResponse.json({ error: "id は必須です" }, { status: 400 });
    }

    const db = getDb();
    const docRef = db.collection("authorizedUsers").doc(id);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};
    if (active !== undefined) updates.active = active;
    if (newPassword) {
      const salt = crypto.randomBytes(16).toString("hex");
      updates.salt = salt;
      updates.passwordHash = hashPassword(newPassword, salt);
      updates.iterations = ITERATIONS;
      // パスワードリセット時はLINEID連携も解除
      updates.lineUserId = null;
    }

    await docRef.update(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/users] PATCH error:", error);
    return NextResponse.json(
      { error: "更新に失敗しました" },
      { status: 500 }
    );
  }
}
