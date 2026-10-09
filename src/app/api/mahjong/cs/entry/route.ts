import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { isManualCs, rebalanceEntries, waitlistPosition } from "@/lib/mahjongCsEntry";
import { hasPlayedMahjongLeague } from "@/lib/mahjongCsServer";
import { getActiveSeason } from "@/lib/mahjong";
import type {
  MahjongCsEntrant,
  MahjongCsEvent,
  MahjongLeagueAssignment,
} from "@/types";

export const dynamic = "force-dynamic";

/** 利用者のCS参加表明・取消。新方式はリーグ参加済みの人だけが期間内に表明できる。 */

/** 確定リーグ編成にいない参加者の末尾順位。 */
const NON_LEAGUE_RANK = 100000;

const BAD_WINDOW = "参加受付の期間が設定されていません";

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

    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(target.csEventId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    if (!isManualCs(snap.data() as MahjongCsEvent)) {
      return NextResponse.json({ error: "エントリーの受付は終了しました" }, { status: 409 });
    }
    if (!(await hasPlayedMahjongLeague(target.seasonId, userId))) {
      return NextResponse.json({ error: "リーグ戦に1回以上参加した人だけが参加できます" }, { status: 403 });
    }
    // プロフィール・確定編成・参加資格の読み取りは transaction の外で行う。
    const [seedInfo, profile] = await Promise.all([
      resolveLeagueSeed(target.seasonId, userId),
      resolveProfile(userId),
    ]);

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent;
      if (!isManualCs(event)) {
        return { status: 409 as const, error: "エントリーの受付は終了しました" };
      }
      const now = new Date().toISOString();
      if (event.status !== "entry") {
        return { status: 409 as const, error: "参加受付は終了しました" };
      }
      const opens = Date.parse(event.entryOpensAt ?? "");
      const closes = Date.parse(event.entryClosesAt ?? "");
      if (Number.isNaN(opens) || Number.isNaN(closes)) {
        return { status: 409 as const, error: BAD_WINDOW };
      }
      if (Date.parse(now) < opens) {
        return { status: 409 as const, error: "参加受付の開始前です" };
      }
      if (Date.parse(now) >= closes) {
        return { status: 409 as const, error: "参加受付は終了しました" };
      }
      const entries = event.entries ?? [];
      const existing = entries.find((e) => e.lineUserId === userId);
      if (existing) {
        return { status: 200 as const, state: existing.state, waitlistPosition: waitlistPosition(entries, userId) };
      }
      const next = rebalanceEntries([...entries, {
        lineUserId: userId,
        ...profile,
        tier: seedInfo.tier ?? "M3",
        rank: seedInfo.rank,
        enteredAt: now,
        state: "confirmed",
      }], { capacity: event.capacity!, priorityUserIds: event.priorityUserIds ?? [], phase: "entry" });
      tx.update(ref, { entries: next, updatedAt: now });
      return { status: 200 as const, state: next.find((e) => e.lineUserId === userId)!.state,
        waitlistPosition: waitlistPosition(next, userId) };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ success: true, entered: true, state: result.state, waitlistPosition: result.waitlistPosition });
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
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = doc.data() as MahjongCsEvent;
      const now = new Date().toISOString();
      if (isManualCs(event)) {
        const opens = Date.parse(event.entryOpensAt ?? "");
        const closes = Date.parse(event.entryClosesAt ?? "");
        if (Number.isNaN(opens) || Number.isNaN(closes)) {
          return { status: 409 as const, error: BAD_WINDOW };
        }
        if (event.status !== "entry" || Date.parse(now) >= closes) {
          return { status: 409 as const, error: "締切後は取り消せません。管理者に連絡してください" };
        }
        const entries = event.entries ?? [];
        const remaining = entries.filter((e) => e.lineUserId !== userId);
        if (remaining.length !== entries.length) {
          const next = rebalanceEntries(remaining, {
            capacity: event.capacity!, priorityUserIds: event.priorityUserIds ?? [], phase: "entry",
          });
          tx.update(ref, { entries: next, updatedAt: now });
        }
        return { status: 200 as const, entered: false };
      }
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
