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
  requirePayment?: boolean;  // true=予約時にSquare決済が必要（旧仕様・現状オンライン不可）
  hourlyRate?: number;       // 時間単価（円/時間）
  // ── 決済（予約ごとに動的Square決済リンクを生成／任意の施設で再利用可） ──
  paymentAmount?: number;    // 決済額（円・税込）。設定で「決済する」化＋Square API照合の金額チェックに使用
  // ── 解錠（SwitchBot時限パスコード・能力フィールド） ──
  switchBotDeviceId?: string; // キーパッド/ロックのデバイスID。あれば予約ごとに時限パスコードを発行
  createdAt?: string;  // ISO8601
  updatedAt?: string;  // ISO8601
}

// ─── 予約 ────────────────────────────────────────────────────────────────────
// pending_payment: 決済前の仮押さえ（TTLで自動解放）。confirmed: 確定。cancelled: 取消。
export type ReservationStatus = "confirmed" | "cancelled" | "pending_payment";

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
  // ── Square決済URL方式（トレーラー等） ──
  pendingExpiresAt?: string;     // pending_payment の仮押さえ失効 ISO8601（TTL・決済成功でクリア）
  paymentTransactionId?: string; // Square取引ID（再利用防止のため一意に保つ）
  // ── 解錠（SwitchBot時限パスコード） ──
  switchBotPasscode?: string;          // 発行した時限パスワード（6桁・本人にのみ表示）
  switchBotKeyId?: number;             // SwitchBotが返すキーID（deleteKey用）
  switchBotPasscodeExpiresAt?: string; // パスコード失効（=予約終了）ISO8601
  switchBotStatus?: "issued" | "pending" | "failed"; // 発行状態（failed=要手動再発行）
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
/** 麻雀リーグの順位集計方式（アベレージ / 合計点。既定はアベレージ） */
export type MahjongRankingMetric = "average" | "total";

export interface Season {
  seasonId: string;
  name: string;
  gameCategory: ScoreboardGameId; // 種目別シーズン（麻雀/ポーカー/ビリヤード/ダーツ）
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  active: boolean;
  csConfig: Record<ScoreboardGameId, { topN: number }>;
  /** 麻雀の順位方式（未設定は "average"）。合計点/アベレージを運用で切替可能にするための設定。 */
  rankingMetric?: MahjongRankingMetric;
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

/** 業種選択肢 */
export const INDUSTRY_OPTIONS = [
  "IT・通信",
  "建築・不動産",
  "デザイン・クリエイティブ",
  "映像・メディア",
  "広告・マーケティング",
  "コンサルティング",
  "士業（税理士・弁護士等）",
  "教育・研修",
  "飲食・フード",
  "小売・EC",
  "製造・メーカー",
  "医療・ヘルスケア",
  "金融・保険",
  "人材・採用",
  "NPO・公共",
  "その他",
] as const;

export type Industry = (typeof INDUSTRY_OPTIONS)[number];

export interface MemberProfile {
  catchphrase: string;
  skills: string[];
  services: string[];
  contactInfo: string;
  companyName?: string;
  jobTitle?: string;
  industry?: string;
  companyUrl?: string;
  bio?: string;
  socialLinks?: {
    instagram?: string;
    x?: string;
    facebook?: string;
    other?: string;
  };
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

/** リーグ戦 開催日への参加表明 */
export interface MahjongEntry {
  entryId: string;
  seasonId: string;
  eventDate: string;       // YYYY-MM-DD
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  enteredAt: string;
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
