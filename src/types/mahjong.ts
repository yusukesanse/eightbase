/**
 * 麻雀リーグ / CS / スケジュールのドメイン型・定数。
 * （旧 src/types/index.ts から分離。`@/types` からの再エクスポートで参照互換）
 */
// ─── 麻雀リーグ ───────────────────────────────────────────────────────────────

/** 同卓4人の合計点（検証用） */
export const MAHJONG_TABLE_TOTAL = 100000;

export type MahjongLeagueTier = "M1" | "M2" | "M3";

/**
 * 卓のステータス
 * - reporting: メンバーの申告待ち（未申告者あり、または検証未通過）
 * - completed: 全員申告済み＋合計100,000点の検証通過。集計対象
 */
export type MahjongTableStatus = "reporting" | "completed";

/** 卓メンバーの申告 */
export interface MahjongTableMember {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  /** 最終持ち点（未申告は null） */
  points: number | null;
  /** 卓内順位 1〜4（未申告は null） */
  rank: number | null;
  reportedAt: string | null;
}

/** 麻雀の卓（1卓 = 1半荘 = 1試合） */
export interface MahjongTable {
  tableId: string;
  seasonId: string;
  eventDate: string;       // YYYY-MM-DD
  createdBy: string;       // 代表者の lineUserId（卓組み自動生成時は "system"）
  memberIds: string[];     // 4人の lineUserId
  members: MahjongTableMember[];
  status: MahjongTableStatus;
  /** 卓組みで生成されたラウンド番号（1始まり）。手動作成卓は undefined */
  round?: number;
  /** 卓ラベル（A / B）。卓組み生成時に付与 */
  tableLabel?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 卓メンバーの **公開用**（クライアント返却用）表現。
 * LINE 内部ID（lineUserId）は出さず、自席判定は `isCurrentUser` で行う。
 */
export interface PublicMahjongTableMember {
  displayName: string;
  pictureUrl?: string;
  points: number | null;
  rank: number | null;
  reportedAt: string | null;
  /** この席がリクエスト元ユーザー自身か（内部IDを露出せず自席強調/申告可否に使う） */
  isCurrentUser: boolean;
}

/**
 * 卓の **公開用**（クライアント返却用）表現。
 * `memberIds` / `members[].lineUserId` / `createdBy` などの内部IDは含めない。
 */
export interface PublicMahjongTable {
  tableId: string;
  seasonId: string;
  eventDate: string;
  status: MahjongTableStatus;
  round?: number;
  tableLabel?: string;
  createdAt: string;
  updatedAt: string;
  members: PublicMahjongTableMember[];
  /** リクエスト元がこの卓のメンバーか（自分の卓判定用） */
  mine: boolean;
}

/**
 * 参加費（3,000円）の支払い状態（WP3）。
 * - pending: 決済リンク発行済み・未確定（pendingExpiresAt でTTL）
 * - paid: 決済確定（卓組対象になる）
 * - cancelRequested: 利用者がキャンセル依頼（自動返金せず管理者へ手動返金通知）
 * staff（エイト社員）等 支払い免除者にはこのフィールドを付与しない。
 */
export type MahjongPaymentStatus = "pending" | "paid" | "cancelRequested";

/** リーグ戦 開催日への参加表明 */
export interface MahjongEntry {
  entryId: string;
  seasonId: string;
  eventDate: string;       // YYYY-MM-DD
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  enteredAt: string;
  /** 参加ステータス。reserved=仮予約（未決済）/ paid=参加確定。staffは参加時点でpaid。 */
  status?: "reserved" | "paid";
  // ─ WP3: 参加費支払い（会員/ゲストのみ。staffは免除＝未設定）─
  paymentStatus?: MahjongPaymentStatus;
  paymentTransactionId?: string; // Square orderId（決済照合用・本人以外へは非公開）
  paymentAmount?: number;        // 決済額（円）＝ MAHJONG_ENTRY_FEE
  paidAt?: string;               // 決済確定時刻 ISO8601
  cancelRequestedAt?: string;    // キャンセル依頼時刻 ISO8601（監査用）
  pendingExpiresAt?: string;     // 決済リンクのTTL失効 ISO8601
}

/** CS（チャンピオンシップ）出場に必要なリーグ戦試合数 */
export const MAHJONG_CS_MIN_GAMES = 5;

/** リーグ戦1開催日あたりの参加枠（先着）。これを超える参加表明は不可。 */
export const MAHJONG_MAX_ENTRIES_PER_DATE = 8;

/** リーグ戦の参加費（円・税込）。支払い対象は staff 以外（member / guest）。 */
export const MAHJONG_ENTRY_FEE = 3000;

/** 通算成績（standings APIの計算結果） */
export interface MahjongStanding {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  gamesPlayed: number;
  totalPoints: number;
  /** シーズン通算アベレージ（最終持ち点の平均） */
  average: number;
  /** 1位の回数 */
  firstCount: number;
  /** 連対（1位または2位）の回数 */
  top2Count: number;
  /** 1位率（タイブレーク第1キー） */
  firstRate: number;
  /** 連対率（タイブレーク第2キー） */
  top2Rate: number;
  /** CS出場資格（リーグ戦5試合以上） */
  csEligible: boolean;
  rank: number;            // 1始まり
  tier: MahjongLeagueTier; // 1-4位=M1, 5-8位=M2, 9位〜=M3
}

/** プレイヤー戦歴: 1試合（1半荘）分 */
export interface MahjongPlayerGame {
  tableId: string;
  eventDate: string;       // YYYY-MM-DD
  round?: number;          // 第n回戦
  points: number;          // 最終持ち点
  rank: number;            // 卓内順位 1〜4
}

/** プレイヤー戦歴ビュー（/api/mahjong/players/[lineUserId]/history の返却） */
export interface MahjongPlayerHistory {
  seasonId: string;
  player: { lineUserId: string; displayName: string; pictureUrl?: string };
  /** そのシーズンの通算成績・順位（standings と一致）。試合が無ければ null */
  standing: {
    gamesPlayed: number;
    average: number;
    firstCount: number;
    top2Count: number;
    firstRate: number;
    top2Rate: number;
    csEligible: boolean;
    rank: number;
    tier: MahjongLeagueTier;
  } | null;
  /** 戦歴リスト（新しい順・表示用） */
  games: MahjongPlayerGame[];
  /** AVG推移（時系列・各試合終了時点の累積アベレージ。スパークライン用） */
  avgTrend: { date: string; cumulativeAverage: number }[];
}

/** portal 向けシーズン要約（/api/mahjong/seasons の返却要素） */
export interface MahjongSeasonSummary {
  seasonId: string;
  name: string;
  startDate: string;
  endDate: string;
  active: boolean;
}

/** リーグ編成のスナップショット項目（確定時点の1人分） */
export interface MahjongLeagueAssignmentEntry {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  rank: number;
  tier: MahjongLeagueTier;
  average: number;
  gamesPlayed: number;
  firstRate: number;
  top2Rate: number;
  csEligible: boolean;
}

/**
 * リーグ編成スナップショット
 * 管理者が開催日終了後に「確定」した時点の順位・所属リーグを固定保存する。
 * 次回リーグ戦の卓組みと CS シードの基準になる。
 */
export interface MahjongLeagueAssignment {
  assignmentId: string;
  seasonId: string;
  /** 確定対象の開催日（YYYY-MM-DD）。どの開催日終了後の編成か */
  eventDate: string;
  /** 確定時刻 */
  confirmedAt: string;
  confirmedBy: string;       // 管理者メール
  entries: MahjongLeagueAssignmentEntry[];
  /** 集計に含めた完了卓の数（参考） */
  tableCount: number;
}

// ─── 麻雀リーグ 当日状態（抜け番・待機キュー） ───────────────────────────────

export interface MahjongRotMember {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
}

/** 直近の交代結果（「次の卓はこちらです」モーダル表示に使う）。 */
export interface MahjongDaySwap {
  round: number; // 確定した半荘（この結果で次半荘を生成）
  out: MahjongRotMember[];
  in: MahjongRotMember[];
  shrunk: boolean;
  reason?: string | null;
}

/** 開催日ごとの進行状態。待機キュー(FIFO)と現ラウンドを保持し、自動生成の冪等性を担保。 */
export interface MahjongDayState {
  seasonId: string;
  eventDate: string;
  round: number; // 現在募集中の半荘
  waiting: MahjongRotMember[]; // 待機キュー（先頭が次にIN）
  tableLabels: string[];
  lastSwap?: MahjongDaySwap | null;
  updatedAt: string;
}

// ─── 麻雀チャンピオンシップ（CS / トーナメント） ───────────────────────────────

export type MahjongCsRoundType = "prelim" | "semi" | "final";
export type MahjongCsStatus = "setup" | "running" | "finished";
export type MahjongCsMatchStatus = "reporting" | "completed";

/** CS参戦者（出場資格者でエントリーした人） */
export interface MahjongCsEntrant {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  tier: MahjongLeagueTier;
  /** リーグ確定時の順位（シード判定・並びに使用） */
  rank: number;
  /** M1のシード権（予選免除→準決から） */
  seed: boolean;
}

/** CSの1試合の中の1人 */
export interface MahjongCsMatchPlayer {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  points: number | null;
  rank: number | null;
}

/** CSの1試合（1卓=1半荘） */
export interface MahjongCsMatch {
  matchId: string;
  label: string;            // 例: 予選A, 準決1, 決勝
  players: MahjongCsMatchPlayer[];
  status: MahjongCsMatchStatus;
}

/** CSの1ラウンド（予選/準決/決勝） */
export interface MahjongCsRound {
  type: MahjongCsRoundType;
  label: string;            // 例: 予選, 準決勝, 決勝
  /** 各試合から勝ち上がる人数（予選=1, 準決=2, 決勝=1） */
  advanceCount: number;
  matches: MahjongCsMatch[];
}

/** CSイベント（年1回のチャンピオンシップ） */
export interface MahjongCsEvent {
  csEventId: string;
  seasonId: string;
  name: string;
  eventDate: string;        // YYYY-MM-DD
  status: MahjongCsStatus;
  /** 参戦者（資格者でエントリー済み） */
  entrants: MahjongCsEntrant[];
  rounds: MahjongCsRound[];
  championId?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── 麻雀スケジュール ─────────────────────────────────────────────────────────

export type MahjongScheduleType = "league" | "championship";

/** 麻雀の開催日（リーグ戦 / チャンピオンシップ） */
export interface MahjongScheduleEntry {
  scheduleId: string;
  seasonId: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  type: MahjongScheduleType;
  createdAt: string;
}

/** 資料準拠の年間日程テンプレート（2026/07〜2027/06） */
export const MAHJONG_SCHEDULE_TEMPLATE: {
  date: string;
  startTime: string;
  endTime: string;
  type: MahjongScheduleType;
}[] = [
  { date: "2026-07-11", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2026-08-08", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2026-09-05", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2026-10-10", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2026-11-14", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2026-12-19", startTime: "10:00", endTime: "18:00", type: "championship" },
  { date: "2027-01-16", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2027-02-13", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2027-03-13", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2027-04-17", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2027-05-15", startTime: "12:00", endTime: "18:00", type: "league" },
  { date: "2027-06-12", startTime: "12:00", endTime: "18:00", type: "league" },
];
