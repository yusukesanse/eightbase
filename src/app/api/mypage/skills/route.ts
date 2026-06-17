import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/mypage/skills
 * スキルとキャッチコピーを保存する。
 *
 * Body: { skills: string[], catchphrase: string }
 */
export async function POST(req: NextRequest) {
  try {
    const lineUserId = await requireActiveUser(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { skills, catchphrase } = await req.json();

    // バリデーション
    if (!Array.isArray(skills)) {
      return NextResponse.json(
        { error: "skills は配列で指定してください" },
        { status: 400 }
      );
    }
    if (skills.length > 20) {
      return NextResponse.json(
        { error: "スキルは最大20個まで設定できます" },
        { status: 400 }
      );
    }

    const cleanSkills = skills
      .filter((s: unknown): s is string => typeof s === "string")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && s.length <= 30);

    const cleanCatchphrase =
      typeof catchphrase === "string" ? catchphrase.trim().slice(0, 40) : "";

    const db = getDb();
    const userRef = db.collection("users").doc(lineUserId);

    // 既存 memberProfile を読み取ってマージ（他フィールドを消さないため）
    const existingDoc = await userRef.get();
    const existingMp = existingDoc.exists ? (existingDoc.data()?.memberProfile || {}) : {};

    await userRef.set(
      {
        memberProfile: {
          ...existingMp,
          skills: cleanSkills,
          catchphrase: cleanCatchphrase,
        },
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/mypage/skills] error:", error);
    return NextResponse.json(
      { error: "保存に失敗しました" },
      { status: 500 }
    );
  }
}
