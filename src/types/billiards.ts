/**
 * ビリヤードリーグの型・定数。要件: docs/games/billiards/ビリヤード-ルール草案.md（2026-07-20 確定）。
 * 実装は「麻雀/ダーツの兄弟機能」。エイトボール1対1・試合ログ方式・通算合計点で順位。
 */

// ─── 定数 ─────────────────────────────────────────────────────────────────────

/** 参加費（円）。支払い対象は staff 以外（member / guest）。 */
export const BILLIARDS_ENTRY_FEE = 1500;

/** 1開催日あたりの参加枠（先着）。運用で調整可。 */
export const BILLIARDS_MAX_ENTRIES_PER_DATE = 8;

/** 開催成立に必要な最少人数（支払い済み）。2名から開催可。 */
export const BILLIARDS_MIN_PARTICIPANTS = 2;

/** 勝者の獲得点（1ラック上限）。8球を落として上がった人が固定で得る。 */
export const BILLIARDS_WINNER_POINTS = 14;

/** 敗者が落とせる最大玉数（8球目=勝ちなので 0〜7）。 */
export const BILLIARDS_MAX_LOSER_BALLS = 7;

// ─── tier（B1/B2/B3・順位帯） ────────────────────────────────────────────────

export type BilliardsTier = "B1" | "B2" | "B3";
/** 通算順位 → tier。1〜4=B1 / 5〜8=B2 / 9位以下=B3。 */
export function billiardsTierForRank(rank: number): BilliardsTier {
  return rank <= 4 ? "B1" : rank <= 8 ? "B2" : "B3";
}

// ─── 試合ログ（GMが試合ごとに記録） ──────────────────────────────────────────

/**
 * 1試合（1ラック）の記録。勝者=BILLIARDS_WINNER_POINTS、敗者=loserBalls pt。
 * 組み合わせは現地で自由。GMが対戦カードを1件ずつ記録する（試合ログ方式）。
 */
export interface BilliardsMatchLog {
  matchId: string;
  winnerId: string;
  loserId: string;
  loserBalls: number; // 敗者が落とした玉数（0〜7）
  createdAt: string;
  createdBy?: string; // 記録した GM
}

// ─── スコア（scores.details・billiards） ────────────────────────────────────

/** 1試合分の結果（scores.details.matches の1要素）。 */
export interface BilliardsMatchResult {
  result: "win" | "lose";
  points: number; // win=14 / lose=落とした玉数
  opponentId?: string;
  opponentName?: string;
}

/**
 * scores.details（billiards）。1開催日=1レコードに当日の全試合を保持。
 * scores.totalScore = matches の points 合計（＝その日の獲得点）。
 */
export interface BilliardsScoreDetails {
  matches: BilliardsMatchResult[];
  wins: number;
  losses: number;
  /** その日の総合順位（当日点の降順・タイブレークは勝利数）。表示用。 */
  dayRank: number;
}

// ─── 当日の GM 進行（billiardsDayState） ─────────────────────────────────────

export interface BilliardsDayMember {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/**
 * billiardsDayState/{seasonId}_{eventDate}。当日の GM 進行の唯一の状態。
 * GM「ゲーム開始」で受付締切＋参加者確定。以降 GM が試合を1件ずつ記録し、「本日終了」で当日点を確定。
 */
export interface BilliardsDayState {
  seasonId: string;
  eventDate: string; // YYYY-MM-DD
  participants: BilliardsDayMember[]; // 開始時に確定（paid+staff）
  entryClosedAt?: string | null; // GM「ゲーム開始」= 受付締切
  startedBy?: string | null;
  matches: BilliardsMatchLog[]; // GM が記録した試合ログ
  finishedAt?: string | null;
  finishedBy?: string | null;
  updatedAt: string;
}

// ─── 参加・スケジュール・参加費（ダーツ流用） ───────────────────────────────

export type BilliardsPaymentStatus = "pending" | "paid" | "cancelRequested";

export interface BilliardsEntry {
  entryId: string;
  seasonId: string;
  eventDate: string; // YYYY-MM-DD
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  enteredAt: string;
  status?: "reserved" | "paid" | "cancelRequested" | "refunded" | "cancelRejected";
  paymentStatus?: BilliardsPaymentStatus;
  paymentTransactionId?: string; // Square orderId
  paymentAmount?: number; // = BILLIARDS_ENTRY_FEE
  paidAt?: string;
  cancelRequestedAt?: string;
  refundProcessedAt?: string;
  refundProcessedBy?: string;
  pendingExpiresAt?: string;
  cancelReason?: "forfeit";
}

/** 開催日（第2・第4土曜・管理登録）。billiardsSchedule が「有効な開催日」の唯一の正。 */
export interface BilliardsScheduleEntry {
  scheduleId: string; // `${seasonId}_${date}`
  seasonId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // 既定 13:00
  endTime: string; // 既定 18:00
  createdAt: string;
}

export interface BilliardsCancelledDate {
  seasonId: string;
  eventDate: string; // = docId
  reason: "insufficient" | "manual";
  paidCount: number;
  decidedAt: string;
  decidedBy: string;
}

export const BILLIARDS_DEFAULT_START_TIME = "13:00";
export const BILLIARDS_DEFAULT_END_TIME = "18:00";

// ─── CS（8ボール1対1・シングルエリミ・GMなし自動進行） ──────────────────────

export type BilliardsCsStatus = "setup" | "running" | "finished";
export type BilliardsCsMatchStatus = "reporting" | "completed";
export type BilliardsCsRoundType = "round" | "semi" | "final";

export interface BilliardsCsEntrant {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  rank: number; // シーズン順位（seed/組分け順・未参加は番兵）
  seed: boolean; // 上位者
}

export interface BilliardsCsMatchPlayer {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  won: boolean | null; // 勝者申告で確定（null=未確定）
}

export interface BilliardsCsMatch {
  matchId: string;
  label: string;
  players: BilliardsCsMatchPlayer[]; // 2名（byeは1名で自動確定）
  status: BilliardsCsMatchStatus;
}

export interface BilliardsCsRound {
  type: BilliardsCsRoundType;
  label: string;
  matches: BilliardsCsMatch[];
  byes?: BilliardsCsMatchPlayer[];
}

export interface BilliardsCsEvent {
  csEventId: string;
  seasonId: string;
  name: string;
  eventDate: string; // 締切日（到来で自動ブラケット生成）
  status: BilliardsCsStatus;
  entrants: BilliardsCsEntrant[];
  rounds: BilliardsCsRound[];
  championId?: string | null;
  runnerUpId?: string | null; // 準優勝（決勝の敗者）
  thirdId?: string | null; // 3位（準決勝敗者・任意）
  createdAt: string;
  updatedAt: string;
}
