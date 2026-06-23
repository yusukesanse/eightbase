/**
 * 麻雀リーグ 共有ロジック
 * - 卓の申告検証（合計100,000点・順位整合性）
 * - シーズン通算アベレージと順位・リーグ振り分けの計算
 */

import { getDb } from "@/lib/firebaseAdmin";
import {
  MAHJONG_CS_MIN_GAMES,
  MAHJONG_TABLE_TOTAL,
  type MahjongLeagueAssignmentEntry,
  type MahjongLeagueTier,
  type MahjongPlayerHistory,
  type MahjongSeasonSummary,
  type MahjongStanding,
  type MahjongTable,
  type MahjongTableMember,
  type ScoreboardGameId,
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
 * 並び順（公式ルール準拠）:
 *   1. アベレージ降順
 *   2. 連対率降順（1位または2位の割合。アベレージ同点時のタイブレーク）
 *   3. 試合数降順 → 名前順（連対率も同じ場合の決定的フォールバック）
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

/** シーズンの完了済み卓の数を返す（編成スナップショットの参考値） */
export async function countCompletedTables(seasonId: string): Promise<number> {
  const db = getDb();
  const snap = await db
    .collection("mahjongTables")
    .where("seasonId", "==", seasonId)
    .get();
  return snap.docs.filter(
    (d) => (d.data() as MahjongTable).status === "completed"
  ).length;
}

/**
 * 現時点の standings からリーグ編成スナップショットの entries を生成する。
 * 確定APIから呼び、確定時刻・対象開催日などを付けて保存する。
 */
export async function buildLeagueAssignmentEntries(
  seasonId: string
): Promise<MahjongLeagueAssignmentEntry[]> {
  const standings = await computeStandings(seasonId);
  return standings.map((s) => ({
    lineUserId: s.lineUserId,
    displayName: s.displayName,
    pictureUrl: s.pictureUrl,
    rank: s.rank,
    tier: s.tier,
    average: s.average,
    gamesPlayed: s.gamesPlayed,
    firstRate: s.firstRate,
    top2Rate: s.top2Rate,
    csEligible: s.csEligible,
  }));
}

/**
 * portal 向け: 指定種目のシーズン一覧（active/過去とも）を新しい順で返す。
 * gameCategory 未設定の旧シーズンは麻雀として扱う（getActiveSeason と同方針）。
 */
export async function listSeasons(
  category: ScoreboardGameId = "mahjong"
): Promise<MahjongSeasonSummary[]> {
  const db = getDb();
  const snap = await db.collection("seasons").get();
  const seasons = snap.docs
    .map((d) => {
      const data = d.data() as {
        gameCategory?: string;
        name?: string;
        startDate?: string;
        endDate?: string;
        active?: boolean;
      };
      return { seasonId: d.id, ...data };
    })
    .filter(
      (s) => s.gameCategory === category || (category === "mahjong" && !s.gameCategory)
    )
    .map((s) => ({
      seasonId: s.seasonId,
      name: s.name ?? "",
      startDate: s.startDate ?? "",
      endDate: s.endDate ?? "",
      active: !!s.active,
    }));
  // 新しい順（startDate 降順、未設定は末尾）
  seasons.sort((a, b) => (b.startDate || "").localeCompare(a.startDate || ""));
  return seasons;
}

/**
 * シーズン内の1プレイヤーの戦歴を計算する。
 * - 戦歴: 完了済み卓から当該プレイヤーの {持ち点, 着順, 日付, 回戦} を抽出（新しい順）
 * - avgTrend: 時系列（古い順）に各試合終了時点の累積アベレージ（スパークライン用）
 * - standing: そのシーズンの順位表における当該プレイヤーの集計・順位（standings と一致）
 */
export async function computePlayerHistory(
  seasonId: string,
  lineUserId: string
): Promise<MahjongPlayerHistory> {
  const db = getDb();
  const snap = await db
    .collection("mahjongTables")
    .where("seasonId", "==", seasonId)
    .get();

  const games: MahjongPlayerHistory["games"] = [];
  let displayName = "";
  let pictureUrl: string | undefined;

  for (const doc of snap.docs) {
    const table = doc.data() as MahjongTable;
    if (table.status !== "completed") continue;
    const m = table.members.find((mm) => mm.lineUserId === lineUserId);
    if (!m || m.points === null || m.rank === null) continue;
    games.push({
      tableId: table.tableId ?? doc.id,
      eventDate: table.eventDate,
      round: table.round,
      points: m.points,
      rank: m.rank,
    });
    displayName = m.displayName;
    if (m.pictureUrl) pictureUrl = m.pictureUrl;
  }

  // 時系列（古い順）に並べて累積アベレージを計算
  const chrono = games
    .slice()
    .sort(
      (a, b) =>
        a.eventDate.localeCompare(b.eventDate) || (a.round ?? 0) - (b.round ?? 0)
    );
  let sum = 0;
  const avgTrend = chrono.map((g, i) => {
    sum += g.points;
    return { date: g.eventDate, cumulativeAverage: Math.round(sum / (i + 1)) };
  });

  // 順位・集計は standings と一致させる（再計算して当該ユーザーを引く）
  const standings = await computeStandings(seasonId);
  const s = standings.find((x) => x.lineUserId === lineUserId) ?? null;

  return {
    seasonId,
    player: {
      lineUserId,
      displayName: s?.displayName ?? displayName,
      pictureUrl: s?.pictureUrl ?? pictureUrl,
    },
    standing: s
      ? {
          gamesPlayed: s.gamesPlayed,
          average: s.average,
          firstCount: s.firstCount,
          top2Count: s.top2Count,
          firstRate: s.firstRate,
          top2Rate: s.top2Rate,
          csEligible: s.csEligible,
          rank: s.rank,
          tier: s.tier,
        }
      : null,
    // 表示は新しい順
    games: chrono.slice().reverse(),
    avgTrend,
  };
}

/**
 * 指定種目のアクティブなシーズンを1件取得（なければ null）。
 * シーズンは種目別（gameCategory）。既定は麻雀。
 * gameCategory 未設定の旧シーズンは、麻雀指定時のフォールバックとして採用する。
 */
export async function getActiveSeason(
  category: ScoreboardGameId = "mahjong"
): Promise<({ seasonId: string } & FirebaseFirestore.DocumentData) | null> {
  const db = getDb();
  const snap = await db.collection("seasons").where("active", "==", true).get();
  if (snap.empty) return null;
  const docs = snap.docs.map(
    (d) =>
      ({ ...d.data(), seasonId: d.id }) as { seasonId: string; gameCategory?: string } & FirebaseFirestore.DocumentData
  );
  // 種目一致を優先
  const exact = docs.find((d) => d.gameCategory === category);
  if (exact) return exact;
  // 旧データ（gameCategory なし）は麻雀として扱う
  if (category === "mahjong") {
    const legacy = docs.find((d) => !d.gameCategory);
    if (legacy) return legacy;
  }
  return null;
}
