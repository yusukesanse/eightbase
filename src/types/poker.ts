/**
 * ポーカーリーグ（テキサスホールデム）の型・定数。要件: docs/games/poker/ポーカー-ルール草案.md。
 * 実装は「麻雀/ダーツ/ビリヤードの兄弟機能」。差分の要点:
 *  - シーズンGMを置かない。**各試合ごとに参加者から自己選出したディーラー**が進行する。
 *  - 1日に複数試合（各最大30分）。最初の試合の「ゲーム開始」で当日の受付を締め切る。
 *  - 順位は各試合の終了時チップ数。**シーズン通算＝チップ数の合計**でリーグ順位を付ける。
 *  - 1試合の結果は、全プレイヤーがチップ残高を自己入力 → ディーラーが確認して確定（ダーツと統一）。
 */

// ─── 定数 ─────────────────────────────────────────────────────────────────────

/** 参加費（円・1開催日あたり）。支払い対象は staff 以外（member / guest）。 */
export const POKER_ENTRY_FEE = 1000;

/** 1開催日あたりの参加枠（単一テーブル: ディーラー1 ＋ プレイヤー最大8 ＝ 9名）。 */
export const POKER_MAX_ENTRIES_PER_DATE = 9;

/** 開催成立に必要な最少人数（支払い済み）。ディーラー1＋プレイヤー2 で最低3名。 */
export const POKER_MIN_PARTICIPANTS = 3;

/** 1試合のプレイヤー上限（ディーラーを除く）。 */
export const POKER_MAX_PLAYERS_PER_GAME = 8;

/** 各プレイヤーの初期チップ（点）。 */
export const POKER_INITIAL_CHIPS = 10000;

/** 1試合の制限時間（分・タイマー表示用）。状態確定はディーラー操作。 */
export const POKER_GAME_DURATION_MIN = 30;

/** チップの面額（点）。色は運用時に決定（未確定）。 */
export const POKER_CHIP_DENOMINATIONS = [100, 500, 1000, 2500] as const;

export const POKER_DEFAULT_START_TIME = "13:00";
export const POKER_DEFAULT_END_TIME = "18:00";

// ─── tier（P1/P2/P3・順位帯。リーグボード表示用） ─────────────────────────────

export type PokerTier = "P1" | "P2" | "P3";
/** 通算順位 → tier。1〜4=P1 / 5〜8=P2 / 9位以下=P3。 */
export function pokerTierForRank(rank: number): PokerTier {
  return rank <= 4 ? "P1" : rank <= 8 ? "P2" : "P3";
}

// ─── 当日の進行（pokerDayState・ディーラー主導の複数試合） ────────────────────

export interface PokerDayMember {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/**
 * 1試合の状態。
 * ready       … ディーラー確定・開始待ち（「ゲーム開始」でタイマー開始）
 * playing     … プレイ中（30分タイマー起点＝startedAt）
 * reporting   … ディーラーが「ゲーム終了」→ 各プレイヤーがチップ残高を入力中
 * confirmed   … 全員入力後、ディーラーが確認して確定
 */
export type PokerGameStatus = "ready" | "playing" | "reporting" | "confirmed";

export interface PokerGameState {
  gameIndex: number; // 1始まり（当日通算）
  dealerId: string; // このゲームのディーラー（プレイ対象外・得点なし）
  status: PokerGameStatus;
  startedAt?: string | null; // 「ゲーム開始」= タイマー起点
  endedAt?: string | null; // ディーラー「ゲーム終了」
  confirmedAt?: string | null; // ディーラー「確定」
  /** プレイヤーの終了時チップ残高（点）。キー=lineUserId。ディーラーは含まない。 */
  reports: Record<string, { chips: number; reportedAt: string }>;
}

/**
 * pokerDayState/{seasonId}_{eventDate}。当日進行の唯一の状態。
 * - 最初の「ディーラーをやる」で作成。最初の「ゲーム開始」で participants を確定＋受付締切。
 * - games 末尾が現在の試合。末尾が confirmed（または games 空）なら「次のディーラー選択」状態。
 */
export interface PokerDayState {
  seasonId: string;
  eventDate: string; // YYYY-MM-DD
  participants: PokerDayMember[]; // 受付締切時に確定（paid+staff）
  entryClosedAt?: string | null; // 最初の「ゲーム開始」= 受付締切
  games: PokerGameState[];
  finishedAt?: string | null; // 管理者による中止/終了（任意）
  finishedBy?: string | null;
  updatedAt: string;
}

// ─── スコア（scores.details・poker） ─────────────────────────────────────────

/** 1試合分の結果（scores.details.games の1要素）。 */
export interface PokerGameResult {
  gameIndex: number;
  chips: number; // その試合の終了時チップ
  rank: number; // その試合内順位（チップ降順・同点同順位）
}

/**
 * scores.details（poker）。1開催日=1レコードに当日の全試合を保持。
 * scores.totalScore = totalChips（＝その日の通算チップ）。シーズン順位は開催日合計で決まる。
 * 管理スコア（§8）互換のため chipCount / tournamentRank も持つ。
 */
export interface PokerScoreDetails {
  games: PokerGameResult[];
  totalChips: number; // 当日の通算チップ（= scores.totalScore）
  gamesPlayed: number;
  dayRank: number; // 当日の総合順位（通算チップ降順・同点同順位）
  chipCount: number; // = totalChips（管理スコア互換）
  tournamentRank: number; // = dayRank（管理スコア互換）
}

// ─── 参加・スケジュール・参加費（ダーツ/ビリヤード流用） ─────────────────────

export type PokerPaymentStatus = "pending" | "paid" | "cancelRequested";

export interface PokerEntry {
  entryId: string;
  seasonId: string;
  eventDate: string; // YYYY-MM-DD
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  enteredAt: string;
  status?: "reserved" | "paid" | "cancelRequested" | "refunded" | "cancelRejected";
  paymentStatus?: PokerPaymentStatus;
  paymentTransactionId?: string; // Square orderId
  paymentAmount?: number; // = POKER_ENTRY_FEE
  paidAt?: string;
  cancelRequestedAt?: string;
  refundProcessedAt?: string;
  refundProcessedBy?: string;
  pendingExpiresAt?: string;
  cancelReason?: "forfeit";
}

/** 開催日（第1・第3土曜・管理登録）。pokerSchedule が「有効な開催日」の唯一の正。 */
export interface PokerScheduleEntry {
  scheduleId: string; // `${seasonId}_${date}`
  seasonId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // 既定 13:00
  endTime: string; // 既定 18:00
  createdAt: string;
}

export interface PokerCancelledDate {
  seasonId: string;
  eventDate: string; // = docId
  reason: "insufficient" | "manual";
  paidCount: number;
  decidedAt: string;
  decidedBy: string;
}
