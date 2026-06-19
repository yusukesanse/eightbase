import { NextRequest, NextResponse } from "next/server";
import { requireActiveUser } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/members
 * メンバー一覧を返す。
 *
 * クエリパラメータ:
 *   skill  - スキルでフィルタ（完全一致）
 *   q      - 名前またはキャッチコピーのキーワード検索（部分一致）
 *
 * レスポンス: MemberListItem[]
 */
export interface MemberListItem {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  companyName: string;
  jobTitle: string;
}

export async function GET(req: NextRequest) {
  try {
    const lineUserId = await requireActiveUser(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const skillFilter = searchParams.get("skill") || "";
    const query = searchParams.get("q") || "";

    const db = getDb();

    // users コレクションから memberProfile を持つユーザーを取得
    // Firestore では配列の contains クエリが使えるのでスキルフィルタに利用
    let usersQuery: FirebaseFirestore.Query = db.collection("users");

    if (skillFilter) {
      usersQuery = usersQuery.where(
        "memberProfile.skills",
        "array-contains",
        skillFilter
      );
    }

    const snap = await usersQuery.get();

    const members: MemberListItem[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const mp = data.memberProfile || {};

      // スキルが未設定のユーザーはメンバー一覧に表示しない
      const skills: string[] = mp.skills || [];
      if (skills.length === 0) continue;

      const displayName = data.displayName || data.lineDisplayName || "";
      const catchphrase: string = mp.catchphrase || "";
      const companyName: string = mp.companyName || "";
      const jobTitle: string = mp.jobTitle || "";

      // キーワード検索（名前 or キャッチコピー or スキル or 会社名に部分一致）
      if (query) {
        const q = query.toLowerCase();
        const nameMatch = displayName.toLowerCase().includes(q);
        const catchMatch = catchphrase.toLowerCase().includes(q);
        const skillMatch = skills.some((s: string) =>
          s.toLowerCase().includes(q)
        );
        const companyMatch = companyName.toLowerCase().includes(q);
        if (!nameMatch && !catchMatch && !skillMatch && !companyMatch) continue;
      }

      members.push({
        lineUserId: doc.id,
        displayName,
        pictureUrl: data.pictureUrl || "",
        catchphrase,
        skills,
        companyName,
        jobTitle,
      });
    }

    // 名前順でソート
    members.sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));

    // HTTP層ではキャッシュさせず常に最新を返す。鮮度管理はクライアント側で行う。
    return NextResponse.json(members, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[api/members] error:", error);
    return NextResponse.json(
      { error: "メンバー一覧の取得に失敗しました" },
      { status: 500 }
    );
  }
}
