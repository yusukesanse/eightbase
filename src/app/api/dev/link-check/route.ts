import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { isProduction, getAppEnv } from "@/lib/env";
import { getActiveSeason } from "@/lib/mahjong";
import type { MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * GET /api/dev/link-check
 *
 * 利用者アプリと管理者アプリで「同じデータを見ているか」を切り分ける診断。
 * 両方のURLで開いて突き合わせる:
 *  - firebaseProjectId が違う → 別Firebaseを見ている＝環境変数の不一致（連携NGの主因）
 *  - projectId 同じ・activeMahjongSeasonId 同じなら tables も一致するはず
 * 認証不要（非本番のみ・読み取りのみ）。
 */
export async function GET() {
  if (isProduction()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  try {
    const season = await getActiveSeason("mahjong");
    let tables: {
      tableId: string;
      round: number | null;
      status: string;
      eventDate: string;
      reported: string; // n/4
      demoDummy: boolean;
    }[] = [];
    if (season) {
      const snap = await getDb()
        .collection("mahjongTables")
        .where("seasonId", "==", season.seasonId)
        .get();
      tables = snap.docs
        .map((d) => {
          const t = d.data() as MahjongTable & { demoDummy?: boolean };
          const reportedCount = t.members.filter((m) => m.points !== null).length;
          return {
            tableId: d.id,
            round: t.round ?? null,
            status: t.status,
            eventDate: t.eventDate,
            reported: `${reportedCount}/${t.members.length}`,
            demoDummy: t.demoDummy === true,
          };
        })
        .sort((a, b) => a.eventDate.localeCompare(b.eventDate) || (a.round ?? 0) - (b.round ?? 0));
    }

    return NextResponse.json({
      appEnv: getAppEnv(),
      firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? null,
      activeMahjongSeasonId: season?.seasonId ?? null,
      activeMahjongSeasonName: season?.name ?? null,
      tableCount: tables.length,
      tables,
    });
  } catch (error) {
    console.error("[dev/link-check] error:", error);
    return NextResponse.json({ error: "diagnostic failed" }, { status: 500 });
  }
}
