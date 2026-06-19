import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * POST /api/mypage/skills
 * スキル・キャッチコピー・会社URL・SNSを保存する。
 * users.memberProfile と authorizedUsers.profile の両方に同期。
 *
 * Body: { skills: string[], catchphrase: string, companyUrl?: string,
 *         socialLinks?: { instagram?, x?, facebook?, other? } }
 */
export async function POST(req: NextRequest) {
  try {
    const lineUserId = await requireActiveUser(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { skills, catchphrase, companyUrl, socialLinks, lineUrl } = await req.json();

    if (!Array.isArray(skills)) {
      return NextResponse.json({ error: "skills は配列で指定してください" }, { status: 400 });
    }
    if (skills.length > 20) {
      return NextResponse.json({ error: "スキルは最大20個まで設定できます" }, { status: 400 });
    }

    const cleanSkills = skills
      .filter((s: unknown): s is string => typeof s === "string")
      .map((s: string) => s.trim())
      .filter((s: string) => s.length > 0 && s.length <= 30);

    const cleanCatchphrase =
      typeof catchphrase === "string" ? catchphrase.trim().slice(0, 40) : "";

    const cleanCompanyUrl =
      typeof companyUrl === "string" ? companyUrl.trim() : "";

    // LINE 友だち追加URL（メンバー同士の直接連絡に使う）
    const cleanLineUrl =
      typeof lineUrl === "string" ? lineUrl.trim().slice(0, 300) : "";

    // SNS（入力された項目のみ保持。各200文字まで）
    const cleanSocialLinks: Record<string, string> = {};
    if (socialLinks && typeof socialLinks === "object") {
      for (const key of ["instagram", "x", "facebook", "other"] as const) {
        const v = (socialLinks as Record<string, unknown>)[key];
        if (typeof v === "string" && v.trim()) {
          cleanSocialLinks[key] = v.trim().slice(0, 200);
        }
      }
    }

    const db = getDb();
    const now = new Date().toISOString();

    // ── users.memberProfile を更新（既存フィールド保持） ──
    const userRef = db.collection("users").doc(lineUserId);
    const existingDoc = await userRef.get();
    const existingMp = existingDoc.exists ? (existingDoc.data()?.memberProfile || {}) : {};

    await userRef.set(
      {
        memberProfile: {
          ...existingMp,
          skills: cleanSkills,
          catchphrase: cleanCatchphrase,
          companyUrl: cleanCompanyUrl,
          socialLinks: cleanSocialLinks,
          lineUrl: cleanLineUrl,
        },
        updatedAt: now,
      },
      { merge: true }
    );

    // ── authorizedUsers.profile にも skills/companyUrl を同期 ──
    const authSnap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", lineUserId)
      .where("active", "==", true)
      .limit(1)
      .get();

    if (!authSnap.empty) {
      const authRef = authSnap.docs[0].ref;
      const existingProfile = authSnap.docs[0].data().profile || {};

      await authRef.update({
        profile: {
          ...existingProfile,
          skills: cleanSkills,
          companyUrl: cleanCompanyUrl || existingProfile.companyUrl || "",
        },
        profileUpdatedAt: now,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/mypage/skills] error:", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
}
