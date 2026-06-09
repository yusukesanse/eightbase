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
