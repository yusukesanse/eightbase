import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { isProduction } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * 麻雀リーグの動作確認用ツール（管理者専用・検証用途）
 *
 * POST body:
 *  - { action: "seedUsers", count?: number }
 *      ダミーLINEユーザー（users/testmj_N、_testMahjong: true）を作成
 *  - { action: "cleanup", seasonId?: string }
 *      指定シーズン（既定: アクティブ）の麻雀テストデータ
 *      （entries / tables / leagueAssignments / csEvents）と
 *      ダミーユーザーを削除。schedule と season 本体は残す。
 *
 * ガード: 本番では常に 404（ダミー投入を本番へ入れない）。加えて admin 認証必須。
 */
const TEST_PREFIX = "testmj_";

export async function POST(req: NextRequest) {
  // DEV-ONLY: 本番では機能自体を隠す（ダミーデータ投入を本番で不可に）。
  if (isProduction()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  try {
    if (action === "seedUsers") {
      const count = Math.min(8, Math.max(1, Number(body?.count) || 4));
      const now = new Date().toISOString();
      const ids: { lineUserId: string; displayName: string }[] = [];
      const batch = db.batch();
      for (let i = 1; i <= count; i++) {
        const id = `${TEST_PREFIX}${i}`;
        const displayName = `テスト${i}`;
        batch.set(
          db.collection("users").doc(id),
          { displayName, pictureUrl: "", _testMahjong: true, createdAt: now },
          { merge: true }
        );
        ids.push({ lineUserId: id, displayName });
      }
      await batch.commit();
      return NextResponse.json({ success: true, users: ids });
    }

    if (action === "cleanup") {
      let seasonId: string | undefined = body?.seasonId;
      if (!seasonId) {
        const season = await getActiveSeason();
        seasonId = season?.seasonId;
      }
      const deleted: Record<string, number> = {};

      const deleteWhere = async (coll: string) => {
        if (!seasonId) return;
        const snap = await db.collection(coll).where("seasonId", "==", seasonId).get();
        let n = 0;
        // バッチは500件まで
        let batch = db.batch();
        let inBatch = 0;
        for (const doc of snap.docs) {
          batch.delete(doc.ref);
          n++;
          inBatch++;
          if (inBatch >= 450) {
            await batch.commit();
            batch = db.batch();
            inBatch = 0;
          }
        }
        if (inBatch > 0) await batch.commit();
        deleted[coll] = n;
      };

      await deleteWhere("mahjongEntries");
      await deleteWhere("mahjongTables");
      await deleteWhere("mahjongLeagueAssignments");
      await deleteWhere("mahjongCsEvents");

      // ダミーユーザー削除
      const userSnap = await db.collection("users").where("_testMahjong", "==", true).get();
      let un = 0;
      const ubatch = db.batch();
      userSnap.docs.forEach((d) => {
        ubatch.delete(d.ref);
        un++;
      });
      if (un > 0) await ubatch.commit();
      deleted["users(dummy)"] = un;

      return NextResponse.json({ success: true, seasonId, deleted });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (error) {
    console.error("[admin/mahjong/test] error:", error);
    return NextResponse.json({ error: "失敗しました" }, { status: 500 });
  }
}
