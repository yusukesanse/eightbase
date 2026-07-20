/**
 * ダーツリーグの型・定数。
 * 要件は docs/games/darts/ダーツ-ルール草案.md（2026-07-18 確定分）。
 * 実装は「麻雀リーグの兄弟機能」として麻雀パターンを流用する（entries/day/Square/CS）。
 */

// ─── 種目 ─────────────────────────────────────────────────────────────────────

export type DartsEventKind = "zeroOne" | "countUp" | "cricket";

/** 当日の実施順（固定）。①ゼロワン → ②カウントアップ → ③クリケット。 */
export const DARTS_EVENT_ORDER: readonly DartsEventKind[] = ["zeroOne", "countUp", "cricket"] as const;

export const DARTS_EVENT_LABEL: Record<DartsEventKind, string> = {
  zeroOne: "ゼロワン",
  countUp: "カウントアップ",
  cricket: "クリケット",
};

/** 種目の申告値が「大きいほど上位」か。ゼロワンは残り点数が少ないほど上位＝false。 */
export const DARTS_HIGHER_IS_BETTER: Record<DartsEventKind, boolean> = {
  zeroOne: false, // 最終残り点数の少ない順（0=上がりが最上位）
  countUp: true, // 合計点の高い順
  cricket: true, // チーム最終ポイントの高い順
};

// ─── 定数 ─────────────────────────────────────────────────────────────────────

/** 参加費（円）。支払い対象は staff 以外（member / guest）。 */
export const DARTS_ENTRY_FEE = 1000;

/** 1開催日あたりの参加枠（先着）。 */
export const DARTS_MAX_ENTRIES_PER_DATE = 8;

/** 開催成立に必要な最少人数（支払い済み）。 */
export const DARTS_MIN_PARTICIPANTS = 4;

/** カウントアップのラウンド数。 */
export const DARTS_COUNTUP_ROUNDS = 8;

/** クリケットのラウンド数（多人数クリケット・ポイント制）。 */
export const DARTS_CRICKET_ROUNDS = 15;

/**
 * 人数別 正規化配点表（0.5刻み・確定）。§3。
 * 「1位=8 / 最下位=1」を両端に固定し、その間を人数で等間隔に配分（少人数の日の得点インフレを防ぐ）。
 * index = rank-1（rankは1始まり）。playerCount は 1〜8 を想定。
 */
export const DARTS_POINT_TABLE: Record<number, readonly number[]> = {
  1: [8],
  2: [8, 1],
  3: [8, 4.5, 1],
  4: [8, 5.5, 3.5, 1],
  5: [8, 6.5, 4.5, 2.5, 1],
  6: [8, 6.5, 5, 4, 2.5, 1],
  7: [8, 7, 5.5, 4.5, 3.5, 2, 1],
  8: [8, 7, 6, 5, 4, 3, 2, 1],
};

// ─── ゼロワン種別（GM が当日アプリで選択） ────────────────────────────────────

export type DartsZeroOneOut = "single" | "double" | "master";

export interface DartsZeroOneVariant {
  /** 元数（スタート点数）。301 / 501 等。 */
  start: number;
  /** アウト条件。 */
  out: DartsZeroOneOut;
}

// ─── スコア（scores.details に3種目分を保持） ────────────────────────────────

/** 1種目分の申告・結果。 */
export interface DartsEventResult {
  kind: DartsEventKind;
  /** 申告スコア数値（ゼロワン=最終残り点 / CU=合計点 / クリケット=チーム最終ポイント）。棄権・欠席は null。 */
  value: number | null;
  /** 種目内順位（1始まり・同順位あり）。棄権は null。クリケットはチーム順位。 */
  rank: number | null;
  /** 正規化順位ポイント（同点は平均分配・クリケットは順位帯平均）。棄権は 0。 */
  points: number;
  /** クリケットのみ: 所属チームID。 */
  teamId?: string;
}

/**
 * scores.details（darts）。1開催日=1レコードに3種目分を保持（§6）。
 * scores.totalScore = events の points 合計（＝その日の総合得点）。
 */
export interface DartsScoreDetails {
  /** ゼロワン / カウントアップ / クリケット（DARTS_EVENT_ORDER 順）。 */
  events: DartsEventResult[];
  /** その日の総合順位（totalScore 降順・タイブレークは1位数）。表示用。 */
  dayRank: number;
  /** 1位を取った種目数（タイブレーク用。クリケットはチーム1位で算入）。 */
  firstCount: number;
}

// ─── 当日の GM 進行（dartsDayState・Phase 3） ─────────────────────────────────
//
// 麻雀は「半荘ローテーション」だが、ダーツは 3 種目を順に進める**直線状態機械**
// （①ゼロワン → ②カウントアップ → ③クリケット）。チーム編成はクリケットのみ。
// 状態は dartsDayState/{seasonId}_{eventDate} の単一 doc に集約し、GM/利用者で同一参照。

/** 当日の参加者（開始時に確定＝支払い済み＋staff・enteredAt FIFO）。 */
export interface DartsDayMember {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/** クリケットの GM 編成（2人1組・奇数は1人チーム可）。 */
export interface DartsTeam {
  teamId: string;
  memberIds: string[];
}

export type DartsEventStatus = "pending" | "reporting" | "confirmed";

/** 1種目の進行状態＋申告。 */
export interface DartsEventState {
  kind: DartsEventKind;
  status: DartsEventStatus;
  /**
   * 申告値。個人種目（ゼロワン/カウントアップ）は lineUserId をキー、
   * クリケットは teamId をキーにする。value=null は棄権（0pt・人数外）。
   * 順位・ポイントは保存せず raw reports から都度算出する（GM 修正時の陳腐化を防ぐ）。
   */
  reports: Record<string, { value: number | null; reportedAt: string }>;
}

/**
 * dartsDayState/{seasonId}_{eventDate}。当日の GM 進行の唯一の状態。
 * entryClosedAt が打刻されたら参加表明・参加費の支払いは不可（受付締切）。
 */
export interface DartsDayState {
  seasonId: string;
  eventDate: string; // YYYY-MM-DD
  participants: DartsDayMember[]; // 開始時に確定（paid+staff）
  entryClosedAt?: string | null; // GM「ゲーム開始」= 受付締切
  startedBy?: string | null;
  zeroOneVariant?: DartsZeroOneVariant | null; // GM 選択（ゼロワン申告の前提）
  cricketTeams?: DartsTeam[] | null; // GM 編成（クリケット申告の前提）
  events: DartsEventState[]; // 常に DARTS_EVENT_ORDER 順の3件
  finishedAt?: string | null;
  finishedBy?: string | null;
  updatedAt: string;
}

// ─── 参加・スケジュール・参加費（麻雀 entries を流用） ────────────────────────

export type DartsPaymentStatus = "pending" | "paid" | "cancelRequested";

/**
 * リーグ戦 開催日への参加表明（麻雀 MahjongEntry を流用・参加費は DARTS_ENTRY_FEE）。
 * staff は参加時点で paid（免除）。会員/ゲストは reserved → Square 決済で paid。
 */
export interface DartsEntry {
  entryId: string;
  seasonId: string;
  eventDate: string; // YYYY-MM-DD
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  enteredAt: string;
  status?: "reserved" | "paid" | "cancelRequested" | "refunded" | "cancelRejected";
  paymentStatus?: DartsPaymentStatus;
  paymentTransactionId?: string; // Square orderId
  paymentAmount?: number; // = DARTS_ENTRY_FEE
  paidAt?: string;
  cancelRequestedAt?: string;
  refundProcessedAt?: string;
  refundProcessedBy?: string;
  pendingExpiresAt?: string; // 決済リンクの TTL 失効
  /** キャンセル/返金の理由。"forfeit"=中止（流会）による返金対象化。 */
  cancelReason?: "forfeit";
}

/**
 * ダーツの開催日（隔週木曜・管理画面で登録）。
 * ★ このコレクションが「有効な開催日」の唯一の正。麻雀の暗黙「土曜判定」は流用しない。
 * docId は決定的に `${seasonId}_${date}`。
 */
export interface DartsScheduleEntry {
  scheduleId: string;
  seasonId: string;
  date: string; // YYYY-MM-DD（開催日）
  startTime: string; // "HH:MM"（既定 18:00）
  endTime: string; // "HH:MM"（既定 20:00）
  createdAt: string;
}

/** 開催日の中止（流会）記録。開催日ごと1件（docId=eventDate）。 */
export interface DartsCancelledDate {
  seasonId: string;
  eventDate: string; // YYYY-MM-DD（= docId）
  reason: "insufficient" | "manual";
  paidCount: number;
  decidedAt: string;
  decidedBy: string;
}

/** 開催時刻の既定。 */
export const DARTS_DEFAULT_START_TIME = "18:00";
export const DARTS_DEFAULT_END_TIME = "20:00";
