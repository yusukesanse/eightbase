// ─── ユーザー ───────────────────────────────────────────────────────────────
export type UserRole = "tenant" | "coworking" | "admin";

// ─── 利用申請（セルフ登録）────────────────────────────────────────────────────
// 利用者がLIFFログイン後、未登録なら氏名/メール/会社名を申請 → 管理者が承認でOTP発行。
export type AccessRequestStatus = "pending" | "approved" | "rejected";

export interface AccessRequest {
  id: string;
  lineUserId: string;   // 申請者のLINE ID（LIFFログイン済み）
  lineDisplayName?: string; // LINEプロフィール名（参考表示用）
  displayName: string;  // 申請者が入力した氏名
  email: string;        // 正規化済み
  companyName: string;  // 会社名（承認時に本登録プロフィールへ引き継ぐ）
  requestedRole: "member" | "guest"; // 申請者が自己申告した種別（承認時のrole初期値）。staffはURL招待の別導線
  status: AccessRequestStatus;
  createdAt: string;
  reviewedAt?: string;
  reviewedBy?: string;  // 承認/却下した管理者
  invitationId?: string; // 承認時に発行した招待ID
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
  switchBotStatus?: "issued" | "pending" | "failed" | "manual"; // 発行状態（failed=要手動再発行 / manual=SwitchBot未連携で手動解錠対応）
  createdAt: string;
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
  /** 麻雀の開催開始時刻（HH:mm・JST）。参加費支払いの当日締切に使う。未設定は締切なし。 */
  mahjongStartTime?: string;
  createdAt: string;
  updatedAt: string;
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

// ─── 麻雀リーグ / CS / スケジュール（別モジュールへ分離） ───
export * from "./mahjong";
