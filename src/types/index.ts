// ─── ユーザー ───────────────────────────────────────────────────────────────
export type UserRole = "tenant" | "coworking" | "admin";

export interface NufUser {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  tenantId: string;
  tenantName: string;
  role: UserRole;
  points: number;
  createdAt: string; // ISO8601
}

// ─── 施設 ────────────────────────────────────────────────────────────────────
export type FacilityType = "meeting_room" | "booth";

export interface Facility {
  id: string;          // e.g. "meetingroom-a"
  name: string;        // e.g. "会議室 A"
  type: FacilityType;
  capacity: number;
  calendarId: string;  // Google Calendar ID
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
export type NewsCategory = "important" | "info" | "facility" | "community";

export interface NewsItem {
  newsId: string;
  title: string;
  body: string;
  category: NewsCategory;
  publishedAt: string;
  imageUrl?: string;
  published: boolean;
  scheduledAt?: string; // ISO8601: この日時になったら自動公開
}

// ─── クエスト ─────────────────────────────────────────────────────────────────
export interface Quest {
  questId: string;
  title: string;
  description: string;
  requiredCount: number;
  rewardPoints: number;
  category: string;
  imageUrl?: string;
  published?: boolean;
  scheduledAt?: string; // ISO8601: この日時になったら自動公開
}

export interface UserQuestProgress {
  questId: string;
  currentCount: number;
  completed: boolean;
  completedAt?: string;
}
