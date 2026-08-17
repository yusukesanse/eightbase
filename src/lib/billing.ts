/**
 * 請求（入金）管理の共通ロジック。
 *
 * ■ 何を「請求」として扱うか
 *   アプリ経由でお金が動くのは 2 系統だけ:
 *     1. 施設予約（トレーラー等・`Facility.paymentAmount > 0`）… `reservations`
 *     2. ゲーム参加費（麻雀/ダーツ/ビリヤード/ポーカー）… `{game}Entries`
 *   どちらも Square の動的決済リンクで課金し、**結果は Firestore に記録される**。
 *
 * ■ なぜ Square API を一覧の元データにしないか（設計判断）
 *   - Square 側は「誰が・何の予約/開催日に払ったか」を持たない（金額と注文IDだけ）。
 *     紐付けの情報は Firestore にしかないため、Square を元にすると結局 Firestore を引き直す。
 *   - Square のアカウント/店舗は用途別に分かれうる（`SQUARE_*` / `SQUARE_{GAME}_*` / 施設ごとの
 *     `facilitySecrets`）。一覧のたびに最大5系統の資格情報で Square を叩くのは重く、
 *     資格情報未設定の環境では画面ごと落ちる。
 *   - 予約の SoT は Firestore（CLAUDE.md「予約↔Google Calendar 同期」と同じ方針）。
 *   → **一覧・集計は Firestore の記録を正とし、Square とは注文ID(orderId)/決済ID(paymentId)で突き合わせる。**
 *     「課金されているのに未払いのまま」の復旧は既存の入金確認待ち（`src/lib/gameEntryPayment.ts`）が
 *     Square 照合つきで担当する。ここは閲覧・集計に徹して二重の入り口を作らない。
 *
 * ■ ⚠️ 本番は TZ=UTC
 *   `paidAt` は UTC の ISO 文字列。月の集計は JST で行うため、必ず `jstDateFromIso()` を通すこと
 *   （`new Date(iso).getMonth()` は本番だけ 1 か月ずれる）。
 */

import type { ScoreboardGameId } from "@/types";
// 4種目の参加ステータス状態機械は同一定義（dartsEntryStatus 等は麻雀版のコピー）。
// 請求側で 4 本に分岐しても結果は同じなので、代表として麻雀版を使う。
import { deriveStatus } from "./mahjongEntryStatus";

/** 請求の発生源。ゲームは種目そのもの。 */
export type BillingSource = "reservation" | ScoreboardGameId;

export const BILLING_GAMES: ScoreboardGameId[] = ["mahjong", "darts", "billiards", "poker"];
export const BILLING_SOURCES: BillingSource[] = ["reservation", ...BILLING_GAMES];

export const BILLING_SOURCE_LABEL: Record<BillingSource, string> = {
  reservation: "施設予約",
  mahjong: "麻雀 参加費",
  darts: "ダーツ 参加費",
  billiards: "ビリヤード 参加費",
  poker: "ポーカー 参加費",
};

export function isBillingSource(v: unknown): v is BillingSource {
  return typeof v === "string" && (BILLING_SOURCES as string[]).includes(v);
}

/**
 * 請求ステータス（予約とゲーム参加費を1つの軸にそろえたもの）。
 * - unpaid          … 未入金（決済リンク未発行・発行済み未確定の両方）
 * - paid            … 入金済（返金対応なし）
 * - refundRequested … 入金済だがキャンセル/取消済み＝返金対応が要るもの（お金はまだ手元）
 * - refunded        … 返金済（手元に残らない）
 * - cancelled       … 入金前に取消（金額は発生しない）
 * - exempt          … 参加費免除（staff の参加表明など。金額0で記録だけ残す）
 */
export type BillingStatus =
  | "unpaid"
  | "paid"
  | "refundRequested"
  | "refunded"
  | "cancelled"
  | "exempt";

export const BILLING_STATUS_LABEL: Record<BillingStatus, string> = {
  unpaid: "未入金",
  paid: "入金済",
  refundRequested: "返金対応待ち",
  refunded: "返金済",
  cancelled: "取消",
  exempt: "免除",
};

/** 集計の基準日。use=利用日/開催日 / paid=入金日（未入金は利用日で扱う）。 */
export type BillingBasis = "use" | "paid";

/** 請求1件（予約1件 or 参加表明1件）。 */
export interface BillingRecord {
  /** 一覧のキー。`{source}:{docId}` */
  id: string;
  source: BillingSource;
  /** 元ドキュメントID（reservationId / entryId）。 */
  refId: string;
  /** 内容（施設名 or 種目名）。 */
  itemName: string;
  /** ゲーム参加費のみ。予約は null。 */
  seasonId: string | null;
  seasonName: string | null;
  /** 利用日 / 開催日 YYYY-MM-DD */
  useDate: string;
  /** 入金日時 ISO8601（未入金は null）。 */
  paidAt: string | null;
  amount: number;
  status: BillingStatus;
  lineUserId: string;
  displayName: string;
  /** Square 注文ID（Square 管理画面での突き合わせ用）。 */
  orderId: string | null;
  /** Square 決済ID（予約のみ保存している）。 */
  paymentId: string | null;
  /** 未入金のうち仮押さえTTLを過ぎたもの＝利用者側では確定できない。 */
  expired: boolean;
  /** 備考（返金対応が要る理由など）。 */
  note: string | null;
}

/* ── 日付ユーティリティ（JST 固定） ───────────────────────────────── */

/** UTC の ISO 文字列を JST の日付 YYYY-MM-DD にする。 */
export function jstDateFromIso(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  // +9h して UTC として読む＝JST の暦日。
  return new Date(t + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** JST の日付 YYYY-MM-DD の 0:00 / 23:59:59.999 を UTC ISO にする（Firestore の範囲クエリ用）。 */
export function jstDayStartIso(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toISOString();
}
export function jstDayEndIso(date: string): string {
  return new Date(`${date}T23:59:59.999+09:00`).toISOString();
}

/** "YYYY-MM" → その月の初日/末日。 */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); // m は 1-12 なので day=0 で前月末＝当月末
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
}

/** "YYYY" → その年の初日/末日。 */
export function yearRange(y: string): { from: string; to: string } {
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** 集計基準に応じた「計上日」。入金日基準でも未入金は利用日で扱う（消えないように）。 */
export function billingDate(rec: BillingRecord, basis: BillingBasis): string {
  if (basis === "paid" && rec.paidAt) return jstDateFromIso(rec.paidAt);
  return rec.useDate;
}

export function isWithinRange(date: string, from: string, to: string): boolean {
  return !!date && date >= from && date <= to;
}

/* ── Firestore ドキュメント → BillingRecord ───────────────────────── */

/** ゲーム参加表明の生ドキュメント（請求に必要な項目だけ）。 */
export interface GameEntryDoc {
  seasonId?: string;
  eventDate?: string;
  lineUserId?: string;
  displayName?: string;
  status?: string;
  paymentStatus?: string;
  paymentAmount?: number;
  paymentTransactionId?: string;
  paidAt?: string;
  pendingExpiresAt?: string;
  cancelReason?: string;
}

/**
 * ゲーム参加表明 → 請求1件。
 * ⚠️ staff は参加費免除で「payment 系フィールドを一切持たないまま status=paid」になる。
 *    これを入金済(¥fee)として数えると売上が水増しされるので `exempt`（金額0）に落とす。
 */
export function gameEntryToBilling(
  game: ScoreboardGameId,
  entryId: string,
  doc: GameEntryDoc,
  fee: number,
  now: string = new Date().toISOString(),
): BillingRecord {
  const st = deriveStatus(doc);
  const hasPayment = !!doc.paidAt || !!doc.paymentTransactionId || doc.paymentAmount != null;
  const exempt = st === "paid" && !hasPayment;

  let status: BillingStatus;
  let note: string | null = null;
  if (exempt) {
    status = "exempt";
    note = "参加費免除（スタッフ等）";
  } else if (st === "paid" || st === "cancelRejected") {
    status = "paid";
    if (st === "cancelRejected") note = "キャンセル依頼を却下";
  } else if (st === "cancelRequested") {
    status = "refundRequested";
    note = doc.cancelReason === "forfeit" ? "流会（中止）による返金対象" : "キャンセル依頼";
  } else if (st === "refunded") {
    status = "refunded";
  } else {
    status = "unpaid";
  }

  const expired = status === "unpaid" && !!doc.pendingExpiresAt && doc.pendingExpiresAt <= now;
  if (expired) note = "仮押さえ失効（Square で課金済みなら「入金確認待ち」から復旧）";

  return {
    id: `${game}:${entryId}`,
    source: game,
    refId: entryId,
    itemName: BILLING_SOURCE_LABEL[game],
    seasonId: doc.seasonId ?? null,
    seasonName: null,
    useDate: doc.eventDate ?? "",
    paidAt: doc.paidAt ?? null,
    amount: status === "exempt" ? 0 : doc.paymentAmount ?? fee,
    status,
    lineUserId: doc.lineUserId ?? "",
    displayName: doc.displayName || doc.lineUserId || "",
    orderId: doc.paymentTransactionId ?? null,
    paymentId: null,
    expired,
    note,
  };
}

/** 予約の生ドキュメント（請求に必要な項目だけ）。 */
export interface ReservationDoc {
  facilityName?: string;
  lineUserId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  status?: string;
  paymentStatus?: string;
  paymentAmount?: number;
  paymentId?: string;
  paymentTransactionId?: string;
  pendingExpiresAt?: string;
  createdAt?: string;
  updatedAt?: string;
  paidAt?: string;
}

/**
 * 施設予約 → 請求1件。**決済額のない（無料施設の）予約は請求ではないので null**。
 *
 * ⚠️ 予約には `paidAt` が無い時期のデータがある。入金確定は「pending_payment → confirmed」の
 *    更新なので `updatedAt`、それも無ければ `createdAt`（仮押さえ＝決済の15分以内）で代用する。
 * ⚠️ キャンセルしても `paymentStatus` は completed のまま残る（`/api/admin/reservations/[id]` DELETE）。
 *    入金済のまま取り消された予約は返金対応が要るので `refundRequested` にして見落とさないようにする。
 */
export function reservationToBilling(
  reservationId: string,
  doc: ReservationDoc,
  displayName: string,
  now: string = new Date().toISOString(),
): BillingRecord | null {
  const amount = doc.paymentAmount ?? 0;
  if (amount <= 0) return null;

  const received = doc.paymentStatus === "completed";
  const paidAt = received ? doc.paidAt ?? doc.updatedAt ?? doc.createdAt ?? null : null;

  let status: BillingStatus;
  let note: string | null = null;
  if (doc.paymentStatus === "refunded") {
    status = "refunded";
  } else if (doc.status === "cancelled") {
    if (received) {
      status = "refundRequested";
      note = "入金済のまま予約が取消されています（Square で返金対応）";
    } else {
      status = "cancelled";
    }
  } else if (received) {
    status = "paid";
  } else {
    status = "unpaid";
  }

  const expired = status === "unpaid" && !!doc.pendingExpiresAt && doc.pendingExpiresAt <= now;
  if (expired) note = "仮押さえ失効（決済されずに枠が解放されました）";

  return {
    id: `reservation:${reservationId}`,
    source: "reservation",
    refId: reservationId,
    itemName: doc.facilityName || "施設予約",
    seasonId: null,
    seasonName: null,
    useDate: doc.date ?? "",
    paidAt,
    amount,
    status,
    lineUserId: doc.lineUserId ?? "",
    displayName: displayName || doc.lineUserId || "",
    orderId: doc.paymentTransactionId ?? null,
    paymentId: doc.paymentId ?? null,
    expired,
    note,
  };
}

/* ── 集計 ─────────────────────────────────────────────────────────── */

export interface BillingTotals {
  count: number;
  /** 入金済で手元にある金額（paid + 返金対応待ち）。 */
  receivedAmount: number;
  /** うち返金対応が要る金額（receivedAmount の内数）。 */
  refundPendingAmount: number;
  /** 返金済の金額。 */
  refundedAmount: number;
  /** 未入金（仮押さえ失効を除く）。 */
  unpaidAmount: number;
  /** 仮押さえ失効の金額（回収見込みなし）。 */
  expiredAmount: number;
}

export interface BillingSummary extends BillingTotals {
  bySource: { source: BillingSource; totals: BillingTotals }[];
}

function emptyTotals(): BillingTotals {
  return {
    count: 0,
    receivedAmount: 0,
    refundPendingAmount: 0,
    refundedAmount: 0,
    unpaidAmount: 0,
    expiredAmount: 0,
  };
}

function addTo(t: BillingTotals, r: BillingRecord): void {
  t.count += 1;
  if (r.status === "paid") t.receivedAmount += r.amount;
  else if (r.status === "refundRequested") {
    t.receivedAmount += r.amount;
    t.refundPendingAmount += r.amount;
  } else if (r.status === "refunded") t.refundedAmount += r.amount;
  else if (r.status === "unpaid") {
    if (r.expired) t.expiredAmount += r.amount;
    else t.unpaidAmount += r.amount;
  }
  // cancelled / exempt は金額を計上しない（件数のみ）。
}

export function summarizeBilling(records: BillingRecord[]): BillingSummary {
  const total = emptyTotals();
  const map = new Map<BillingSource, BillingTotals>();
  for (const r of records) {
    addTo(total, r);
    const cur = map.get(r.source) ?? emptyTotals();
    addTo(cur, r);
    map.set(r.source, cur);
  }
  return {
    ...total,
    bySource: BILLING_SOURCES.filter((s) => map.has(s)).map((s) => ({
      source: s,
      totals: map.get(s) as BillingTotals,
    })),
  };
}

/** 一覧の並び（計上日の新しい順 → 種別 → 名前）。 */
export function sortBillingRecords(records: BillingRecord[], basis: BillingBasis): BillingRecord[] {
  return [...records].sort((a, b) => {
    const da = billingDate(a, basis);
    const db = billingDate(b, basis);
    if (da !== db) return db.localeCompare(da);
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.displayName.localeCompare(b.displayName);
  });
}
