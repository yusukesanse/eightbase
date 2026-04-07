import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/** ADMIN_EMAILS 環境変数のスーパー管理者リスト */
const SUPER_ADMIN_EMAILS: string[] = (() => {
  const envEmails = process.env.ADMIN_EMAILS;
  if (envEmails) return envEmails.split(",").map((e) => e.trim().toLowerCase());
  return [];
})();

/**
 * GET /api/admin/admin-users
 * 管理者ユーザー一覧を取得
 */
export async function GET(req: NextRequest) {
  const email = await checkAdminAuth(req);
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snapshot = await db
      .collection("adminUsers")
      .orderBy("createdAt", "desc")
      .get();

    interface AdminEntry {
      id: string;
      email: string;
      name: string;
      role: string;
      createdAt: string;
      createdBy: string;
      isSuperAdmin: boolean;
    }

    const admins: AdminEntry[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        email: (data.email as string) || "",
        name: (data.name as string) || "",
        role: (data.role as string) || "admin",
        createdAt: (data.createdAt as string) || "",
        createdBy: (data.createdBy as string) || "",
        isSuperAdmin: SUPER_ADMIN_EMAILS.includes(
          ((data.email as string) || "").toLowerCase()
        ),
      };
    });

    // ADMIN_EMAILS にいるがFirestoreにないスーパー管理者を補完
    const existingEmails = new Set(
      admins.map((a) => a.email.toLowerCase())
    );
    for (const superEmail of SUPER_ADMIN_EMAILS) {
      if (!existingEmails.has(superEmail)) {
        admins.unshift({
          id: `env_${superEmail}`,
          email: superEmail,
          name: "スーパー管理者",
          role: "super_admin",
          createdAt: "",
          createdBy: "環境変数",
          isSuperAdmin: true,
        });
      }
    }

    // 現在のユーザーがスーパー管理者かどうかも返す
    const currentIsSuperAdmin = SUPER_ADMIN_EMAILS.includes(email.toLowerCase());

    return NextResponse.json({ admins, currentEmail: email, currentIsSuperAdmin });
  } catch (error) {
    console.error("[admin-users] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/**
 * POST /api/admin/admin-users
 * 管理者ユーザーを追加（スーパー管理者のみ）
 *
 * Body: { email: string, name?: string }
 */
export async function POST(req: NextRequest) {
  const currentEmail = await checkAdminAuth(req);
  if (!currentEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // スーパー管理者チェック
  if (!SUPER_ADMIN_EMAILS.includes(currentEmail.toLowerCase())) {
    return NextResponse.json(
      { error: "管理者の追加はスーパー管理者のみ可能です" },
      { status: 403 }
    );
  }

  try {
    const { email, name } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "メールアドレスは必須です" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // メールアドレス形式チェック
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return NextResponse.json(
        { error: "有効なメールアドレスを入力してください" },
        { status: 400 }
      );
    }

    const db = getDb();

    // 既存チェック
    const existing = await db
      .collection("adminUsers")
      .where("email", "==", normalizedEmail)
      .get();

    if (!existing.empty) {
      return NextResponse.json(
        { error: "このメールアドレスは既に登録されています" },
        { status: 409 }
      );
    }

    // 追加
    const docRef = await db.collection("adminUsers").add({
      email: normalizedEmail,
      name: name?.trim() || "",
      role: "admin",
      createdAt: new Date().toISOString(),
      createdBy: currentEmail,
    });

    console.log(
      `[admin-users] Added: ${normalizedEmail} by ${currentEmail} (id: ${docRef.id})`
    );

    return NextResponse.json({
      success: true,
      id: docRef.id,
      email: normalizedEmail,
    });
  } catch (error) {
    console.error("[admin-users] POST error:", error);
    return NextResponse.json({ error: "追加に失敗しました" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/admin-users
 * 管理者ユーザーを削除（スーパー管理者のみ）
 *
 * Body: { id: string }
 */
export async function DELETE(req: NextRequest) {
  const currentEmail = await checkAdminAuth(req);
  if (!currentEmail) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // スーパー管理者チェック
  if (!SUPER_ADMIN_EMAILS.includes(currentEmail.toLowerCase())) {
    return NextResponse.json(
      { error: "管理者の削除はスーパー管理者のみ可能です" },
      { status: 403 }
    );
  }

  try {
    const { id } = await req.json();

    if (!id || typeof id !== "string") {
      return NextResponse.json(
        { error: "IDは必須です" },
        { status: 400 }
      );
    }

    // 環境変数のスーパー管理者は削除不可
    if (id.startsWith("env_")) {
      return NextResponse.json(
        { error: "スーパー管理者は削除できません" },
        { status: 403 }
      );
    }

    const db = getDb();
    const docRef = db.collection("adminUsers").doc(id);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json(
        { error: "管理者が見つかりません" },
        { status: 404 }
      );
    }

    const data = doc.data()!;

    // スーパー管理者は削除不可
    if (SUPER_ADMIN_EMAILS.includes((data.email || "").toLowerCase())) {
      return NextResponse.json(
        { error: "スーパー管理者は削除できません" },
        { status: 403 }
      );
    }

    // 自分自身は削除不可
    if ((data.email || "").toLowerCase() === currentEmail.toLowerCase()) {
      return NextResponse.json(
        { error: "自分自身を削除することはできません" },
        { status: 403 }
      );
    }

    await docRef.delete();

    console.log(
      `[admin-users] Deleted: ${data.email} by ${currentEmail} (id: ${id})`
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin-users] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
