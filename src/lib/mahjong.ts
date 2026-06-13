/**
 * 麻雀リーグ 共有ロジック
 * - 卓の申告検証（合計100,000点・順位整合性）
 * - シーズン通算アベレージと順位・リーグ振り分けの計算
 */

import { getDb } from "@/lib/firebaseAdmin";
import {
  MAHJONG_CS_MIN_GAMES,
  MAHJONG_TABLE_TOTAL,
  type MahjongLeagueTier,
  type MahjongStanding,
  type MahjongTable,
  type MahjongTableMember,
} from "@/types";

// ─── 検証 ─────────────────────────────────────────────────────────────────────

export interface MahjongValidationResult {
  ok: boolean;
  /** 全員申告済みか */
  allReported: boolean;
  /** 申告合計（全員申告済みの場合のみ） */
  total: number | null;
  error?: string;
}

/**
 * 卓の申告内容を検証する。
 * - 全員の申告が揃っているか
 * - 合計が 100,000 点か
 * - 順位が 1〜4 の重複なしか
 * - 点数と順位の整合性（点数が多い人がより上の順位か。同点は順不同を許容）
 */
export function validateTableReports(
  members: MahjongTableMember[]
): MahjongValidationResult {
  const reported = members.filter(
    (m) => m.points !== null && m.rank !== null
  );
  if (reported.length < members.length) {
    return {
      ok: false,
      allReported: false,
      total: null,
      error: `未申告のメンバーが ${members.length - reported.length} 人います`,
    };
  }

  const total = reported.reduce((sum, m) => sum + (m.points as number), 0);
  if (total !== MAHJONG_TABLE_TOTAL) {
    return {
      ok: false,
      allReported: true,
      total,
      error: `申告合計が ${total.toLocaleString()} 点です（${MAHJONG_TABLE_TOTAL.toLocaleString()} 点になる必要があります）`,
    };
  }

  const ranks = reported.map((m) => m.rank as number).sort((a, b) => a - b);
  const expected = members.map((_, i) => i + 1);
  if (ranks.join(",") !== expected.join(",")) {
    return {
      ok: false,
      allReported: true,
      total,
      error: "順位が重複しています（1〜4位を1人ずつ申告してください）",
    };
  }

  // 点数と順位の整合性: 点数が多いのに順位が下、はNG（同点は許容）
  for (const a of reported) {
    for (const b of reported) {
      if (
        (a.points as number) > (b.points as number) &&
        (a.rank as number) > (b.rank as number)
      ) {
        return {
          ok: false,
          allReported: true,
          total,
          error: `点数と順位が一致しません（${a.displayName} と ${b.displayName} を確認してください）`,
        };
      }
    }
  }

  return { ok: true, allReported: true, total };
}

// ─── 集計 ─────────────────────────────────────────────────────────────────────

/** 順位からリーグを判定（1-4位=M1, 5-8位=M2, 9位〜=M3） */
export function tierForRank(rank: number): MahjongLeagueTier {
  if (rank <= 4) return "M1";
  if (rank <= 8) return "M2";
  return "M3";
}

/**
 * シーズンの完了済み卓から通算アベレージ順位表を計算する。
 * 並び順（確定仕様）:
 *   1. アベレージ降順
 *   2. 1位率降順（タイブレーク第1キー）
 *   3. 連対率降順（1位または2位の率。タイブレーク第2キー）
 *   4. 試合数降順 → 名前順（最終フォールバック）
 */
export async function computeStandings(
  seasonId: string
): Promise<MahjongStanding[]> {
  const db = getDb();
  // 複合インデックス不要: seasonId のみで where し、status は JS 側でフィルタ
  const snap = await db
    .collection("mahjongTables")
    .where("seasonId", "==", seasonId)
    .get();

  const acc = new Map<
    string,
    {
      displayName: string;
      pictureUrl?: string;
      gamesPlayed: number;
      totalPoints: number;
      firstCount: number;
      top2Count: number;
    }
  >();

  for (const doc of snap.docs) {
    const table = doc.data() as MahjongTable;
    if (table.status !== "completed") continue;
    for (const m of table.members) {
      if (m.points === null || m.rank === null) continue;
      const cur = acc.get(m.lineUserId) ?? {
        displayName: m.displayName,
        pictureUrl: m.pictureUrl,
        gamesPlayed: 0,
        totalPoints: 0,
        firstCount: 0,
        top2Count: 0,
      };
      cur.gamesPlayed += 1;
      cur.totalPoints += m.points;
      if (m.rank === 1) cur.firstCount += 1;
      if (m.rank <= 2) cur.top2Count += 1;
      // 表示名は最新の卓のものを採用
      cur.displayName = m.displayName;
      if (m.pictureUrl) cur.pictureUrl = m.pictureUrl;
      acc.set(m.lineUserId, cur);
    }
  }

  const standings = Array.from(acc.entries()).map(([lineUserId, s]) => ({
    lineUserId,
    displayName: s.displayName,
    pictureUrl: s.pictureUrl,
    gamesPlayed: s.gamesPlayed,
    totalPoints: s.totalPoints,
    average: Math.round(s.totalPoints / s.gamesPlayed),
    firstCount: s.firstCount,
    top2Count: s.top2Count,
    firstRate: s.firstCount / s.gamesPlayed,
    top2Rate: s.top2Count / s.gamesPlayed,
    csEligible: s.gamesPlayed >= MAHJONG_CS_MIN_GAMES,
  }));

  standings.sort(
    (a, b) =>
      b.average - a.average ||
      b.firstRate - a.firstRate ||
      b.top2Rate - a.top2Rate ||
      b.gamesPlayed - a.gamesPlayed ||
      a.displayName.localeCompare(b.displayName, "ja")
  );

  return standings.map((s, i) => ({
    ...s,
    rank: i + 1,
    tier: tierForRank(i + 1),
  }));
}

/** アクティブなシーズンを1件取得（なければ null） */
export async function getActiveSeason(): Promise<
  ({ seasonId: string } & FirebaseFirestore.DocumentData) | null
> {
  const db = getDb();
  const snap = await db
    .collection("seasons")
    .where("active", "==", true)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { ...doc.data(), seasonId: doc.id };
}
