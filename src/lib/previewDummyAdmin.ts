/**
 * プレビューモード専用の「管理画面」ダミーデータ。
 *
 * 利用者向けは src/lib/previewDummy.ts。こちらは /admin の各GET API用。
 * 重要: isPreviewMode(req)===true のときだけ各 admin GET が返す。
 *       本番管理者には出ない（preview Cookie 必須）。Firestore へは書き込まない。
 *       内容はすべて架空データ（実データではないのでプライバシー問題なし）。
 */

import type { NufEvent, NewsItem, Facility } from "@/types";

/* ───────── /api/admin/users ───────── */
export const dummyAdminUsers = {
  users: [
    {
      id: "demo-au-1", email: "", displayName: "あなた（プレビュー）", tenantName: "エイトベース",
      lineUserId: "demo-you", active: true, profileComplete: true, profile: null,
      pictureUrl: null, lineDisplayName: "preview", memberProfile: { skills: ["プロダクト"], catchphrase: "サンプル" },
      createdAt: "2026-05-01T00:00:00.000Z", lastLoginAt: "2026-06-21T00:00:00.000Z",
      profileUpdatedAt: "2026-06-01T00:00:00.000Z", invitationId: "demo-inv-1", inviteStatus: "linked" as const,
    },
    {
      id: "demo-au-2", email: "", displayName: "佐藤 みなみ", tenantName: "スタジオ・ミナ",
      lineUserId: "demo-u2", active: true, profileComplete: true, profile: null,
      pictureUrl: null, lineDisplayName: "minami", memberProfile: { skills: ["UIデザイン"], catchphrase: "" },
      createdAt: "2026-05-10T00:00:00.000Z", lastLoginAt: "2026-06-20T00:00:00.000Z",
      profileUpdatedAt: null, invitationId: "demo-inv-2", inviteStatus: "linked" as const,
    },
    {
      id: "demo-au-3", email: "guest@example.com", displayName: "鈴木 健太", tenantName: "",
      lineUserId: null, active: true, profileComplete: false, profile: null,
      pictureUrl: null, lineDisplayName: null, memberProfile: null,
      createdAt: "2026-06-18T00:00:00.000Z", lastLoginAt: null,
      profileUpdatedAt: null, invitationId: "demo-inv-3", inviteStatus: "pending" as const,
    },
  ],
};

/* ───────── /api/admin/invitations ───────── */
export const dummyAdminInvitations = {
  invitations: [
    { id: "demo-inv-3", displayName: "鈴木 健太", email: "guest@example.com", status: "unused" as const, emailDeliveryStatus: "delivered", createdAt: "2026-06-18T00:00:00.000Z", expiresAt: "2026-07-18T00:00:00.000Z", usedAt: null },
    { id: "demo-inv-2", displayName: "佐藤 みなみ", email: "minami@example.com", status: "used" as const, emailDeliveryStatus: "delivered", createdAt: "2026-05-09T00:00:00.000Z", expiresAt: "2026-06-09T00:00:00.000Z", usedAt: "2026-05-10T00:00:00.000Z" },
    { id: "demo-inv-x", displayName: "期限切れ 太郎", email: "old@example.com", status: "expired" as const, emailDeliveryStatus: "delivered", createdAt: "2026-04-01T00:00:00.000Z", expiresAt: "2026-05-01T00:00:00.000Z", usedAt: null },
  ],
  _preview: true,
};

/* ───────── /api/admin/reservations ───────── */
export const dummyAdminReservations = {
  reservations: [
    { reservationId: "demo-ar-1", facilityId: "demo-room-a", facilityName: "会議室 A", lineUserId: "demo-you", displayName: "あなた（プレビュー）", tenantName: "エイトベース", email: "", pictureUrl: "", date: "2026-07-05", startTime: "13:00", endTime: "15:00", status: "confirmed", googleEventId: "demo-gcal-1", termsAgreed: false, termsAgreedAt: null, createdAt: "2026-06-20T01:00:00.000Z" },
    { reservationId: "demo-ar-2", facilityId: "demo-booth-1", facilityName: "集中ブース 1", lineUserId: "demo-u2", displayName: "佐藤 みなみ", tenantName: "スタジオ・ミナ", email: "", pictureUrl: "", date: "2026-07-03", startTime: "10:00", endTime: "12:00", status: "confirmed", googleEventId: "demo-gcal-2", termsAgreed: false, termsAgreedAt: null, createdAt: "2026-06-19T02:00:00.000Z" },
  ],
  _preview: true,
};

/* ───────── /api/admin/facilities（calendarId含む。架空値） ───────── */
export const dummyAdminFacilities: { facilities: Facility[]; _preview: true } = {
  facilities: [
    { id: "demo-room-a", name: "会議室 A", type: "meeting_room", capacity: 6, calendarId: "demo-cal-a@example.com", active: true, order: 1, openTime: "09:00", closeTime: "21:00", availableDays: [1, 2, 3, 4, 5, 6] },
    { id: "demo-room-b", name: "会議室 B", type: "meeting_room", capacity: 4, calendarId: "demo-cal-b@example.com", active: true, order: 2, openTime: "09:00", closeTime: "21:00", availableDays: [1, 2, 3, 4, 5] },
    { id: "demo-booth-1", name: "集中ブース 1", type: "booth", capacity: 1, calendarId: "demo-cal-c@example.com", active: true, order: 3, openTime: "09:00", closeTime: "21:00", availableDays: [1, 2, 3, 4, 5, 6, 0] },
  ],
  _preview: true,
};

/* ───────── /api/admin/events ───────── */
export const dummyAdminEvents: { events: (Omit<NufEvent, "eventId"> & { eventId: string; goodCount: number })[] } = {
  events: [
    { eventId: "demo-aev-1", title: "もくもく会 #12", category: "勉強会", description: "各自の作業をもくもく進める会。", startAt: "2026-07-03T10:00:00.000Z", endAt: "2026-07-03T13:00:00.000Z", location: "ラウンジ", published: true, goodCount: 8 },
    { eventId: "demo-aev-2", title: "ライトニングトーク Night", category: "交流", description: "5分間のLT大会。", startAt: "2026-07-17T10:00:00.000Z", endAt: "2026-07-17T12:00:00.000Z", location: "イベントスペース", published: true, goodCount: 15 },
    { eventId: "demo-aev-3", title: "（下書き）夏祭り企画", category: "イベント", description: "公開前の下書き。", startAt: "2026-08-01T08:00:00.000Z", endAt: "2026-08-01T12:00:00.000Z", location: "未定", published: false, goodCount: 0 },
  ],
};

/* ───────── /api/admin/news ───────── */
export const dummyAdminNews: { news: NewsItem[] } = {
  news: [
    { newsId: "demo-an-1", title: "コワーキングスペース 7月の営業時間について", body: "7月の営業時間は平日9:00〜21:00、土日10:00〜18:00です。", category: "info", publishedAt: "2026-06-20T00:00:00.000Z", priority: "high", published: true },
    { newsId: "demo-an-2", title: "新しい会議室（Room C）がオープン", body: "6名まで利用可能な会議室を増設しました。", category: "facility", publishedAt: "2026-06-14T00:00:00.000Z", priority: "normal", published: true },
    { newsId: "demo-an-3", title: "（下書き）メンテナンスのお知らせ", body: "公開前の下書き。", category: "info", publishedAt: "2026-06-25T00:00:00.000Z", priority: "medium", published: false },
  ],
};

/* ───────── /api/admin/admin-users ───────── */
export const dummyAdminAdminUsers = {
  admins: [
    { id: "demo-adm-1", email: "admin@example.com", name: "スーパー管理者", role: "super_admin", createdAt: "", createdBy: "環境変数", isSuperAdmin: true },
    { id: "demo-adm-2", email: "staff@example.com", name: "運営スタッフ", role: "admin", createdAt: "2026-05-15T00:00:00.000Z", createdBy: "admin@example.com", isSuperAdmin: false },
  ],
};

/* ───────── /api/admin/login-logs ───────── */
export const dummyAdminLoginLogs = {
  logs: [
    { id: "demo-log-1", action: "login_success", email: "admin@example.com", name: "管理者", reason: "", ip: "203.0.113.10", userAgent: "Mozilla/5.0", timestamp: "2026-06-21T08:30:00.000Z" },
    { id: "demo-log-2", action: "login_denied", email: "stranger@example.com", name: "", reason: "管理者権限なし", ip: "203.0.113.55", userAgent: "Mozilla/5.0", timestamp: "2026-06-20T22:10:00.000Z" },
    { id: "demo-log-3", action: "logout", email: "admin@example.com", name: "管理者", reason: "", ip: "203.0.113.10", userAgent: "Mozilla/5.0", timestamp: "2026-06-20T19:00:00.000Z" },
  ],
  _preview: true,
};

/* ───────── /api/admin/review-mode ───────── */
export const dummyReviewMode = { reviewMode: false };

/* ───────── /api/admin/stats ───────── */
const HOURLY = Array.from({ length: 14 }, (_, i) => {
  const h = i + 8;
  const counts = [1, 0, 2, 4, 6, 5, 3, 4, 6, 7, 5, 3, 2, 1];
  return { hour: `${h}:00`, count: counts[i] };
});
const DAILY_DATA = [
  { date: "2026-06-16", total: 3, facilities: { "demo-room-a": 2, "demo-booth-1": 1 } },
  { date: "2026-06-17", total: 5, facilities: { "demo-room-a": 3, "demo-room-b": 2 } },
  { date: "2026-06-18", total: 2, facilities: { "demo-booth-1": 2 } },
  { date: "2026-06-19", total: 6, facilities: { "demo-room-a": 3, "demo-room-b": 2, "demo-booth-1": 1 } },
  { date: "2026-06-20", total: 4, facilities: { "demo-room-a": 2, "demo-booth-1": 2 } },
];
const USER_GROWTH = [
  { date: "2026-06-16", total: 20, newUsers: 1 },
  { date: "2026-06-17", total: 21, newUsers: 1 },
  { date: "2026-06-18", total: 23, newUsers: 2 },
  { date: "2026-06-19", total: 23, newUsers: 0 },
  { date: "2026-06-20", total: 24, newUsers: 1 },
];

export const dummyAdminStats = {
  totalUsers: 24,
  activeUsers: 18,
  totalReservations: 56,
  upcomingReservations: 7,
  todayReservations: 2,
  reservationsThisMonth: 19,
  dailyData: DAILY_DATA,
  facilityIds: ["demo-room-a", "demo-room-b", "demo-booth-1"],
  facilityNames: { "demo-room-a": "会議室 A", "demo-room-b": "会議室 B", "demo-booth-1": "集中ブース 1" },
  userGrowth: USER_GROWTH,
  hourlyDistribution: HOURLY,
  eventRanking: [
    { id: "demo-aev-2", title: "ライトニングトーク Night", goodCount: 15, type: "event" as const },
    { id: "demo-aev-1", title: "もくもく会 #12", goodCount: 8, type: "event" as const },
  ],
  facilityUsage: [
    { name: "会議室 A", count: 28 },
    { name: "集中ブース 1", count: 18 },
    { name: "会議室 B", count: 10 },
  ],
  totalEvents: 3,
  publishedEvents: 2,
};
