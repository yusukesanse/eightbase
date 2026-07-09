import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason } from "@/lib/mahjong";
import type {
  MahjongCsEntrant,
  MahjongCsEvent,
  MahjongLeagueAssignment,
} from "@/types";

export const dynamic = "force-dynamic";

/**
 * 利用者による CS 自己エントリー（WP6）。
 * 資料では CS は誰でも参加可。従来は管理者が確定リーグ編成から取り込むだけだったが、
 * リーグ未参加者も含めて自分でエントリー/取消できるようにする。
 *
 * - POST   /api/mahjong/cs/entry … 自分を参戦者に追加
 * - DELETE /api/mahjong/cs/entry … 自分を参戦者から取消
 *
 * 受付は status="setup"（トーナメント未生成）の間のみ。確定日到来で予選が自動生成
 *（status="running"）されると締め切る。tier/rank/seed はリーグ確定編成があれば
 * それを引き継ぎ（M1=シード）、無ければ非シード・末尾送りの番兵順位で登録する。
 * 参加資格（5試合以上）による制限は設けない方針（誰でも参加可）。
 */

/** リーグ未参加の自己エントリーに与える順位。シード対象外＝並びの末尾へ寄せる。 */
const NON_LEAGUE_RANK = 100000;

function byIsoDesc(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

/** アクティブシーズンの最新CSイベント doc を取得（無ければ null）。 */
async function findLatestCsEventId(seasonId: string): Promise<string | null> {
  const snap = await getDb()
    .collection("mahjongCsEvents")
    .where("seasonId", "==", seasonId)
    .get();
  const docs = snap.docs
    .map((d) => ({ id: d.id, createdAt: (d.data() as MahjongCsEvent).createdAt }))
    .sort((a, b) => byIsoDesc(a.createdAt, b.createdAt));
  return docs[0]?.id ?? null;
}

async function resolveCurrentCsEventId(): Promise<
  | { status: 200; seasonId: string; csEventId: string }
  | { status: 400 | 404; error: string }
> {
  const season = await getActiveSeason();
  if (!season) {
    return { status: 400, error: "アクティブなシーズンがありません" };
  }
  const csEventId = await findLatestCsEventId(season.seasonId);
  if (!csEventId) {
    return { status: 404, error: "エントリー可能なCSがありません" };
  }
  return { status: 200, seasonId: season.seasonId, csEventId };
}

/** リーグ確定編成から本人の tier/rank/seed を求める（未参加なら非シード）。 */
async function resolveLeagueSeed(
  seasonId: string,
  userId: string
): Promise<Pick<MahjongCsEntrant, "tier" | "rank" | "seed">> {
  const asgnSnap = await getDb()
    .collection("mahjongLeagueAssignments")
    .where("seasonId", "==", seasonId)
    .get();
  const latest = asgnSnap.docs
    .map((d) => d.data() as MahjongLeagueAssignment)
    .sort((a, b) => byIsoDesc(a.confirmedAt, b.confirmedAt))[0];
  const mine = latest?.entries.find((e) => e.lineUserId === userId);
  if (!mine) return { rank: NON_LEAGUE_RANK, seed: false };
  return { tier: mine.tier, rank: mine.rank, seed: mine.tier === "M1" };
}

/** 参戦者に含めるための本人表示情報。 */
async function resolveProfile(userId: string): Promise<{ displayName: string; pictureUrl: string }> {
  const userDoc = await getDb().collection("users").doc(userId).get();
  const u = (userDoc.data() ?? {}) as { displayName?: string; pictureUrl?: string };
  return { displayName: u.displayName || "ユーザー", pictureUrl: u.pictureUrl || "" };
}

/** POST: 自分を参戦者に追加（冪等）。 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const target = await resolveCurrentCsEventId();
    if (target.status !== 200) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    // 契約読み込み（本人プロフィール・シード判定）は競合docではないため tx 外で先に取得。
    const [seedInfo, profile] = await Promise.all([
      resolveLeagueSeed(target.seasonId, userId),
      resolveProfile(userId),
    ]);

    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(target.csEventId);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent;
      if (event.status !== "setup") {
        return { status: 409 as const, error: "エントリーの受付は終了しました" };
      }
      const entrants = event.entrants ?? [];
      if (entrants.some((e) => e.lineUserId === userId)) {
        return { status: 200 as const, entered: true, count: entrants.length };
      }
      const entrant: MahjongCsEntrant = {
        lineUserId: userId,
        displayName: profile.displayName,
        pictureUrl: profile.pictureUrl,
        ...seedInfo,
      };
      const next = [...entrants, entrant];
      tx.update(ref, { entrants: next, updatedAt: now });
      return { status: 200 as const, entered: true, count: next.length };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, entered: result.entered, count: result.count });
  } catch (error) {
    console.error("[mahjong/cs/entry] POST error:", error);
    return NextResponse.json({ error: "エントリーに失敗しました" }, { status: 500 });
  }
}

/** DELETE: 自分を参戦者から取消（冪等）。 */
export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireGameUser(req);
    if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

    const target = await resolveCurrentCsEventId();
    if (target.status !== 200) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(target.csEventId);
    const now = new Date().toISOString();

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent;
      if (event.status !== "setup") {
        return { status: 409 as const, error: "エントリーの受付は終了しました" };
      }
      const entrants = event.entrants ?? [];
      const next = entrants.filter((e) => e.lineUserId !== userId);
      if (next.length !== entrants.length) {
        tx.update(ref, { entrants: next, updatedAt: now });
      }
      return { status: 200 as const, entered: false, count: next.length };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, entered: result.entered, count: result.count });
  } catch (error) {
    console.error("[mahjong/cs/entry] DELETE error:", error);
    return NextResponse.json({ error: "取消に失敗しました" }, { status: 500 });
  }
}
