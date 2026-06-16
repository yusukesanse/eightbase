// ─── ユーザー ───────────────────────────────────────────────────────────────
export type UserRole = "tenant" | "coworking" | "admin";

export interface NufUser {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  tenantId: string;
  tenantName: string;
  role: UserRole;
  createdAt: string; // ISO8601
}

// ─── 施設 ────────────────────────────────────────────────────────────────────
export type FacilityType = "meeting_room" | "booth" | "activity";

export interface Facility {
  id: string;          // e.g. "meetingroom-a"
  name: string;        // e.g. "会議室 A"
  type: FacilityType;
  capacity: number;
  calendarId: string;  // Google Calendar ID
  active?: boolean;    // 有効/無効（デフォルト true）
  order?: number;      // 表示順
  openTime?: string;       // 利用開始時刻 "HH:MM"（デフォルト "09:00"）
  closeTime?: string;      // 利用終了時刻 "HH:MM"（デフォルト "18:00"）
  availableDays?: number[]; // 利用可能曜日 0=日〜6=土（デフォルト [1,2,3,4,5]）
  // ── 予約時間制御 ──
  minDuration?: number;    // 最低利用時間（分）。未設定=30分刻みで自由選択
  fixedDuration?: boolean; // true=固定枠（開始時刻のみ選択、終了自動計算）
  prepTime?: number;       // 準備時間（分）。予約枠には含むがユーザー利用時間には含まない
  // ── 利用規約 ──
  requireTerms?: boolean;  // true=予約前に利用規約への同意が必要
  termsContent?: string;   // 利用規約の本文（改行対応）
  // ── 課金設定 ──
  requirePayment?: boolean;  // true=予約時にSquare決済が必要
  hourlyRate?: number;       // 時間単価（円/時間）
  createdAt?: string;  // ISO8601
  updatedAt?: string;  // ISO8601
}

// ─── 予約 ────────────────────────────────────────────────────────────────────
export type ReservationStatus = "confirmed" | "cancelled";

export interface Reservation {
  reservationId: string;
  facilityId: string;
  facilityName: string;
  lineUserId: string;
  date: string;        // YYYY-MM-DD
  startTime: string;   // HH:MM
  endTime: string;     // HH:MM
  googleEventId: string;
  status: ReservationStatus;
  termsAgreed?: boolean;    // 利用規約に同意済み
  termsAgreedAt?: string;   // 同意日時 ISO8601
  // ── 決済情報 ──
  paymentId?: string;       // Square Payment ID
  paymentAmount?: number;   // 決済金額（円）
  paymentStatus?: "completed" | "failed" | "refunded";
  createdAt: string;
}

// ─── 空き確認 API ─────────────────────────────────────────────────────────────
export interface AvailabilityRequest {
  facilityId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export type UnavailableReason = "ALREADY_BOOKED" | "OUT_OF_HOURS" | "PAST_DATE";

export interface AvailabilityResponse {
  available: boolean;
  reason?: UnavailableReason;
  bookedSlots?: { start: string; end: string }[];
}

// ─── イベント ─────────────────────────────────────────────────────────────────
export interface NufEvent {
  eventId: string;
  title: string;
  category: string;
  description: string;
  startAt: string;  // ISO8601
  endAt: string;
  location: string;
  imageUrl?: string;
  published: boolean;
  scheduledAt?: string; // ISO8601: この日時になったら自動公開
}

// ─── ニュース ─────────────────────────────────────────────────────────────────
export type NewsCategory = "info" | "facility" | "community";
export type NewsPriority = "high" | "medium" | "normal";

export interface NewsItem {
  newsId: string;
  title: string;
  body: string;
  category: NewsCategory;
  publishedAt: string;
  imageUrl?: string;
  priority: NewsPriority;
  published: boolean;
  scheduledAt?: string; // ISO8601: この日時になったら自動公開
}

// ─── ゲーム（大会・トーナメント） ───────────────────────────────────────────────

export type GameStatus = "upcoming" | "ongoing" | "awaiting_results" | "completed" | "cancelled";

/** スコアボード対象の4種目 */
export const GAME_CATEGORIES = [
  { id: "mahjong",   label: "麻雀" },
  { id: "darts",     label: "ダーツ" },
  { id: "billiards", label: "ビリヤード" },
  { id: "poker",     label: "ポーカー" },
] as const;

export type ScoreboardGameId = "mahjong" | "poker" | "billiards" | "darts";

export interface Game {
  gameId: string;
  title: string;
  category: string;       // GAME_CATEGORIES の id
  categoryLabel?: string; // 旧データ互換用
  description: string;
  startAt: string;        // ISO8601
  endAt?: string;         // ISO8601
  location: string;
  imageUrl?: string;
  maxParticipants: number;
  deadline: string;       // ISO8601: 申込締切
  googleEventId?: string;
  calendarId?: string;
  status: GameStatus;
  participantCount: number;
  published: boolean;
  scheduledAt?: string;   // ISO8601: 自動公開日時
  seasonId?: string;      // 紐付けシーズンID
  scoreRegistered?: boolean; // スコア登録済みフラグ
  createdAt: string;
  updatedAt: string;
}

export interface GameParticipant {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  joinedAt: string;       // ISO8601
}

// ─── スコアボード ─────────────────────────────────────────────────────────────

/** シーズン（ランキング集計期間） */
export interface Season {
  seasonId: string;
  name: string;
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  active: boolean;
  csConfig: Record<ScoreboardGameId, { topN: number }>;
  createdAt: string;
  updatedAt: string;
}

/** 種目別スコア詳細 */
export interface MahjongDetails {
  rounds: { rank: number; score: number }[];
}

export interface PokerDetails {
  tournamentRank: number;
  chipCount: number;
  bountyCount?: number;
}

export interface BilliardsDetails {
  matches: { result: "win" | "lose" | "draw"; points: number }[];
}

export interface DartsDetails {
  gameType?: string;
  rank: number;
  points: number;
}

export type ScoreDetails =
  | MahjongDetails
  | PokerDetails
  | BilliardsDetails
  | DartsDetails;

/** 個人スコア（1ゲーム×1ユーザー） */
export interface Score {
  scoreId: string;
  gameId: string;
  gameCategory: ScoreboardGameId;
  lineUserId: string;
  seasonId: string;
  yearMonth: string;      // YYYY-MM（月間クエリ用）
  totalScore: number;
  details: ScoreDetails;
  playedAt: string;       // ISO8601
  recordedBy: string;
  createdAt: string;
}

/** ランキングエントリ */
export interface RankingEntry {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalScore: number;
  playedCount: number;
}

/** CSイベント */
export type CsEventStatus = "draft" | "upcoming" | "ongoing" | "completed";

export interface CsCandidate {
  lineUserId: string;
  gameCategory: ScoreboardGameId;
  annualRank: number;
  annualScore: number;
  displayName: string;
  pictureUrl?: string;
  status: "active" | "declined" | "promoted"; // 繰り上げ対応
}

export interface CsEvent {
  csEventId: string;
  seasonId: string;
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  location: string;
  status: CsEventStatus;
  candidates: CsCandidate[];
  results?: CsCandidate[];
  published: boolean;
  notifiedCandidates: boolean;
  createdAt: string;
  updatedAt: string;
}

// ─── スキル・プロフィール拡張 ─────────────────────────────────────────────────

export interface SkillCategory {
  id: string;
  label: string;
  skills: string[];
}

export const SKILL_CATEGORIES: SkillCategory[] = [
  {
    id: "video",
    label: "映像・写真・音楽",
    skills: ["映像制作", "動画編集", "写真撮影", "ドローン撮影", "アニメーション", "音楽制作", "ナレーション"],
  },
  {
    id: "design",
    label: "デザイン・クリエイティブ",
    skills: ["グラフィックデザイン", "UI/UXデザイン", "イラスト", "ブランディング", "3Dモデリング", "DTP"],
  },
  {
    id: "dev",
    label: "Web・IT開発",
    skills: ["Webサイト制作", "アプリ開発", "システム開発", "EC構築", "WordPress"],
  },
  {
    id: "business",
    label: "マーケ・ビジネス支援",
    skills: ["SNS運用", "Web広告", "SEO対策", "ライティング", "翻訳", "コンサルティング", "PR・広報"],
  },
];

export const ALL_PRESET_SKILLS = SKILL_CATEGORIES.flatMap((c) => c.skills);

export interface MemberProfile {
  catchphrase: string;
  skills: string[];
  services: string[];
  contactInfo: string;
}

// ─── 掲示板投稿 ─────────────────────────────────────────────────────────────

export type PostType = "offer" | "request";

export interface TimelinePost {
  postId: string;
  authorId: string;
  authorName: string;
  authorPictureUrl: string;
  type: PostType;
  content: string;
  tags: string[];
  likes: string[];
  commentCount: number;
  createdAt: string;
}

// ─── 麻雀リーグ ───────────────────────────────────────────────────────────────

/** 配給原点 */
export const MAHJONG_START_POINTS = 25000;
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
  createdBy: string;       // 代表者の lineUserId
  memberIds: string[];     // 4人の lineUserId
  members: MahjongTableMember[];
  status: MahjongTableStatus;
  createdAt: string;
  updatedAt: string;
}

/** CS（チャンピオンシップ）出場に必要なリーグ戦試合数 */
export const MAHJONG_CS_MIN_GAMES = 5;

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
