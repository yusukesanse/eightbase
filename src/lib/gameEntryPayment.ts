/**
 * 参加費エントリーの「入金は成立しているのに未払いのまま」を管理者が復旧するための共通処理。
 *
 * ■ なぜ必要か（2026-08-03 本番障害）
 *   決済の戻り先が会員専用ルートだったため、ゲストは確定処理（`/api/{game}/entries/complete`）
 *   に到達できず、Square では課金されているのにエントリーが `paymentStatus: "pending"` のまま
 *   残った。仮押さえTTL（15分）を過ぎると complete は 410 を返して返金へ回すので、
 *   利用者側の操作では二度と「支払い済み」にできない。
 *   経路のバグ自体は `src/lib/gamePaymentReturn.ts` で修正済みだが、
 *   **既に取りこぼした人を席に戻す手段**が無かったので、ここで用意する。
 *
 * ■ 安全策
 *   - **必ず Square の入金を照合してから** paid にする（`verifySquareOrderPayment`）。
 *     管理者の操作だけで未払いを支払い済みにできてしまわないようにするため。
 *   - `squareOrders/{orderId}` の一意 doc で二重処理を防ぐ。返金として記録済みの注文は拒否する
 *     （返金と着席の二重取りを防ぐ）。
 *   - 当日名簿（`{game}DayState.participants`）にも paid を反映する。complete と同じ扱い。
 */

import { getDb } from "./firebaseAdmin";
import { canTransition as mahjongCanTransition, deriveStatus as mahjongDeriveStatus } from "./mahjongEntryStatus";
import { canTransition as dartsCanTransition, deriveStatus as dartsDeriveStatus } from "./dartsEntryStatus";
import { canTransition as billiardsCanTransition, deriveStatus as billiardsDeriveStatus } from "./billiardsEntryStatus";
import { canTransition as pokerCanTransition, deriveStatus as pokerDeriveStatus } from "./pokerEntryStatus";
import { createHash } from "crypto";
import { verifySquareOrderPayment, refundSquarePayment, getSquarePayment, squareErrorDetail } from "./square";
import { evaluateSquareRefund } from "./billing";
import { canCancelMahjong } from "./date";
import { notifyAdmin, type AdminNotificationType } from "./adminNotify";
import { writeAuditLog } from "./auditLog";
import type { ScoreboardGameId } from "@/types";
import { MAHJONG_ENTRY_FEE } from "@/types";
import { DARTS_ENTRY_FEE } from "@/types/darts";
import { BILLIARDS_ENTRY_FEE } from "@/types/billiards";
import { POKER_ENTRY_FEE } from "@/types/poker";

/**
 * 種目ごとのコレクション名・参加費・Square purpose。complete ルートと一致させること。
 * 請求管理（`/api/admin/billing`）もこの1箇所を参照する（コレクション名と参加費を二重に持たない）。
 */
export const GAME_PAYMENT_CONFIG = {
  mahjong: { entries: "mahjongEntries", dayState: "mahjongDayState", fee: MAHJONG_ENTRY_FEE },
  darts: { entries: "dartsEntries", dayState: "dartsDayState", fee: DARTS_ENTRY_FEE },
  billiards: { entries: "billiardsEntries", dayState: "billiardsDayState", fee: BILLIARDS_ENTRY_FEE },
  poker: { entries: "pokerEntries", dayState: "pokerDayState", fee: POKER_ENTRY_FEE },
} as const satisfies Record<ScoreboardGameId, { entries: string; dayState: string; fee: number }>;

/** 再参加時に除去する前サイクルの決済・返金情報。新しい決済情報は除去指定の後に展開する。 */
export const STALE_REFUND_FIELDS = [
  "paymentStatus", "paymentTransactionId", "paymentUrl", "pendingExpiresAt", "paidAt",
  "refundedAt", "squareRefundId", "squareRefundStatus", "refundMethod", "cancelReason",
  "cancelRequestedAt", "refundProcessedAt", "refundProcessedBy",
  "paymentAmount", "squarePaymentId", "squareReceiptUrl", "squareVerifiedAt",
] as const;

export const PAYMENT_GAMES = Object.keys(GAME_PAYMENT_CONFIG) as ScoreboardGameId[];

export function isPaymentGame(v: unknown): v is ScoreboardGameId {
  return typeof v === "string" && (PAYMENT_GAMES as string[]).includes(v);
}

/** 入金確認待ち（決済リンクを発行したが確定していない）エントリー1件分。 */
export interface UnconfirmedPayment {
  entryId: string;
  eventDate: string;
  displayName: string;
  lineUserId: string;
  amount: number;
  orderId: string;
  pendingExpiresAt: string | null;
  /** 仮押さえTTLを過ぎている＝利用者側では復旧できない状態。 */
  expired: boolean;
  createdAt: string | null;
}

interface EntryDoc {
  eventDate?: string;
  displayName?: string;
  lineUserId?: string;
  seasonId?: string;
  paymentStatus?: string;
  paymentAmount?: number;
  paymentTransactionId?: string;
  pendingExpiresAt?: string;
  createdAt?: string;
}

/**
 * 「決済リンクは発行済みなのに未払いのまま」のエントリー一覧。
 * ここに出るのは *候補* であって入金済みの確証ではない（Square 照合は確定操作の側で行う）。
 */
export async function listUnconfirmedPayments(game: ScoreboardGameId): Promise<UnconfirmedPayment[]> {
  const cfg = GAME_PAYMENT_CONFIG[game];
  const snap = await getDb().collection(cfg.entries).where("paymentStatus", "==", "pending").get();
  const nowIso = new Date().toISOString();

  return snap.docs
    .map((d) => ({ ...(d.data() as EntryDoc), entryId: d.id }))
    // 決済リンクを一度も発行していない（＝そもそも払っていない）ものは対象外。
    .filter((e) => !!e.paymentTransactionId)
    .map((e) => ({
      entryId: e.entryId,
      eventDate: e.eventDate ?? "",
      displayName: e.displayName ?? "",
      lineUserId: e.lineUserId ?? "",
      amount: e.paymentAmount ?? cfg.fee,
      orderId: e.paymentTransactionId as string,
      pendingExpiresAt: e.pendingExpiresAt ?? null,
      expired: !!e.pendingExpiresAt && e.pendingExpiresAt <= nowIso,
      createdAt: e.createdAt ?? null,
    }))
    .sort((a, b) => (b.eventDate ?? "").localeCompare(a.eventDate ?? ""));
}

export type MarkPaidResult =
  | { ok: true; alreadyPaid: boolean; entryId: string }
  | { ok: false; code: "NOT_FOUND" | "NO_ORDER" | "INVALID_STATE" | "ORDER_CONSUMED" | "VERIFY_FAILED"; message: string };

/**
 * Square の入金を照合したうえでエントリーを「支払い済み」にし、当日名簿にも反映する。
 * 照合に失敗したら**何も書き換えない**（管理者操作だけで paid にできないようにするため）。
 */
export async function markGameEntryPaid(
  game: ScoreboardGameId,
  entryId: string,
  admin: string,
): Promise<MarkPaidResult> {
  const cfg = GAME_PAYMENT_CONFIG[game];
  const db = getDb();
  const entryRef = db.collection(cfg.entries).doc(entryId);
  const snap = await entryRef.get();
  if (!snap.exists) return { ok: false, code: "NOT_FOUND", message: "エントリーが見つかりません" };

  const entry = snap.data() as EntryDoc;
  if (entry.paymentStatus === "paid") return { ok: true, alreadyPaid: true, entryId };
  if (entry.paymentStatus !== "pending") {
    return {
      ok: false,
      code: "INVALID_STATE",
      message: `この状態(${entry.paymentStatus ?? "不明"})は支払い済みにできません。返金対応の対象です。`,
    };
  }
  const orderId = entry.paymentTransactionId;
  if (!orderId) {
    return { ok: false, code: "NO_ORDER", message: "決済情報がありません（決済リンクが未発行）" };
  }

  // ── Square の入金照合。ここを外すと未払いを支払い済みにできてしまう。 ──
  let verified: { orderId: string; paymentId: string };
  try {
    verified = await verifySquareOrderPayment({
      orderId,
      expectedAmount: entry.paymentAmount ?? cfg.fee,
      purpose: game,
    });
  } catch (e) {
    return {
      ok: false,
      code: "VERIFY_FAILED",
      message: `Square で入金を確認できませんでした: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const nowIso = new Date().toISOString();
  const orderRef = db.collection("squareOrders").doc(verified.orderId);
  const dayRef = db.collection(cfg.dayState).doc(`${entry.seasonId}_${entry.eventDate}`);

  let alreadyPaid = false;
  let consumed = false;

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(entryRef);
    const orderDoc = await tx.get(orderRef);
    const daySnap = await tx.get(dayRef);

    const cur = fresh.data() as EntryDoc | undefined;
    if (cur?.paymentStatus === "paid") { alreadyPaid = true; return; }

    // 既に返金として記録済みの注文は着席させない（返金と参加の二重取りになる）。
    if (orderDoc.exists) {
      const d = orderDoc.data() ?? {};
      if (d.refundPending || d.expiredRefund) { consumed = true; return; }
    }

    tx.set(orderRef, {
      entryId,
      paymentId: verified.paymentId,
      lineUserId: cur?.lineUserId ?? entry.lineUserId ?? null,
      markedPaidByAdmin: admin,
      createdAt: nowIso,
    }, { merge: true });

    tx.update(entryRef, {
      status: "paid",
      paymentStatus: "paid",
      paidAt: nowIso,
      paymentTransactionId: verified.orderId,
      markedPaidBy: admin,
      markedPaidAt: nowIso,
      updatedAt: nowIso,
    });

    // 当日名簿にも反映（complete と同じ。開始前は participants が空なので何も起きない）。
    const uid = cur?.lineUserId ?? entry.lineUserId;
    if (daySnap.exists && uid) {
      const members = (daySnap.data() as { participants?: { lineUserId: string; paid?: boolean }[] }).participants ?? [];
      if (members.some((m) => m.lineUserId === uid && m.paid === false)) {
        tx.update(dayRef, {
          participants: members.map((m) => (m.lineUserId === uid ? { ...m, paid: true } : m)),
          updatedAt: nowIso,
        });
      }
    }
  });

  if (consumed) {
    return {
      ok: false,
      code: "ORDER_CONSUMED",
      message: "この注文は返金対応として記録済みです。返金タブで処理してください（二重対応を防ぐため支払い済みにはできません）。",
    };
  }
  if (alreadyPaid) return { ok: true, alreadyPaid: true, entryId };

  await writeAuditLog({
    eventType: "payment.markedPaid",
    gameCategory: game,
    actor: admin,
    target: { entryId, lineUserId: entry.lineUserId, date: entry.eventDate },
    beforeStatus: "reserved",
    afterStatus: "paid",
    meta: { orderId: verified.orderId, paymentId: verified.paymentId },
  });

  return { ok: true, alreadyPaid: false, entryId };
}

// 各種目の遷移型は同じunion。型推論を使い、既存の状態機械は変更しない。
const ENTRY_STATUS_MODULE = {
  mahjong: { canTransition: mahjongCanTransition, deriveStatus: mahjongDeriveStatus },
  darts: { canTransition: dartsCanTransition, deriveStatus: dartsDeriveStatus },
  billiards: { canTransition: billiardsCanTransition, deriveStatus: billiardsDeriveStatus },
  poker: { canTransition: pokerCanTransition, deriveStatus: pokerDeriveStatus },
};

async function persistGameEntryRefund(
  game: ScoreboardGameId,
  entryRef: FirebaseFirestore.DocumentReference,
  entry: { seasonId?: string; eventDate?: string },
  lineUserId: string,
  refundInfo: { squareRefundId: string | null; squareRefundStatus: string | null; refundMethod: "auto" | "manualSync" },
): Promise<{ alreadyRefunded: boolean }> {
  const { deriveStatus } = ENTRY_STATUS_MODULE[game];
  const nowIso = new Date().toISOString();
  const result = await getDb().runTransaction(async (tx) => {
    const fresh = await tx.get(entryRef);
    const cur = (fresh.data() as EntryDoc & { status?: string }) ?? {};
    if (deriveStatus(cur) === "refunded") return { alreadyRefunded: true };
    tx.update(entryRef, {
      status: "refunded",
      paymentStatus: "cancelRequested",
      refundedAt: nowIso,
      squareRefundId: refundInfo.squareRefundId,
      squareRefundStatus: refundInfo.squareRefundStatus,
      refundMethod: refundInfo.refundMethod,
      cancelReason: "self",
      updatedAt: nowIso,
    });
    return { alreadyRefunded: false };
  });
  // 既存の決定的IDを使用し、同じ開催日の月ロックだけ解放する。
  try {
    const seasonId = entry.seasonId;
    if (seasonId && entry.eventDate) {
      const ym = entry.eventDate.slice(0, 7);
      const lockRef = getDb().collection(`${game}MonthlyLocks`).doc(`${seasonId}_${lineUserId}_${ym}`);
      const lockSnap = await lockRef.get();
      if (lockSnap.exists && (lockSnap.data() as { eventDate?: string } | undefined)?.eventDate === entry.eventDate) {
        await lockRef.delete();
      }
    }
  } catch (e) {
    console.error("[gameEntryPayment] monthly lock release failed (best-effort):", e);
  }
  return result;
}

export type CancelRefundResult =
  | { kind: "OK" }
  | { kind: "NOT_FOUND" }
  | { kind: "NOT_OWNER" }
  | { kind: "NOT_PAID" }
  | { kind: "DEADLINE_PASSED" }
  | { kind: "INVALID_TRANSITION" }
  | { kind: "REFUND_FAILED"; message: string; stage: "refund" | "persist" };

/** 本人の期日前キャンセルだけが利用する、Square全額返金とentryへの反映。 */
export async function cancelPaidGameEntryWithRefund(
  game: ScoreboardGameId,
  entryId: string,
  lineUserId: string,
): Promise<CancelRefundResult> {
  const cfg = GAME_PAYMENT_CONFIG[game];
  const { canTransition, deriveStatus } = ENTRY_STATUS_MODULE[game];
  const db = getDb();
  const entryRef = db.collection(cfg.entries).doc(entryId);
  const snap = await entryRef.get();
  if (!snap.exists) return { kind: "NOT_FOUND" };

  const entry = snap.data() as EntryDoc & { status?: string; cancelReason?: string };
  if (entry.lineUserId !== lineUserId) return { kind: "NOT_OWNER" };
  // 返金済みはpaymentStatusより先に判定し、冪等に成功を返す。
  if (deriveStatus(entry) === "refunded") return { kind: "OK" };
  if (entry.paymentStatus !== "paid") return { kind: "NOT_PAID" };
  if (!entry.eventDate || !canCancelMahjong(entry.eventDate)) return { kind: "DEADLINE_PASSED" };

  const fromStatus = deriveStatus(entry);
  if (!canTransition(fromStatus, "cancelRequested")) return { kind: "INVALID_TRANSITION" };
  // 既存ルートのチェック順を維持。cancelRejectedからの再依頼も許可する。
  const amount = entry.paymentAmount ?? cfg.fee;
  const orderId = entry.paymentTransactionId;

  const fail = async (reason: string, meta: Record<string, unknown>, stage: "refund" | "persist" = "refund") => {
    // 失敗時の通知・監査だけを行い、entryには書き込まない。
    try {
      await notifyAdmin(
        `${game}_refund` as AdminNotificationType,
        `自動返金に失敗しました。Squareで返金する前に、まず Square の返金履歴を確認してください（${entry.displayName ?? ""} / エントリー ${entryId} / 注文 ${orderId ?? "-"} / 理由: ${reason}）。`,
        { entryId, orderId: orderId ?? null, lineUserId, eventDate: entry.eventDate, amount, reason, stage, ...meta }
      );
    } catch (e) {
      console.error("[gameEntryPayment] notifyAdmin failed in fail():", e);
    }
    try {
      await writeAuditLog({
        eventType: "entry.autoRefundFailed",
        gameCategory: game,
        actor: lineUserId,
        target: { entryId, date: entry.eventDate, lineUserId },
        beforeStatus: fromStatus,
        afterStatus: fromStatus,
        meta: { orderId: orderId ?? null, amount, reason, stage, ...meta },
      });
    } catch (e) {
      console.error("[gameEntryPayment] writeAuditLog failed in fail():", e);
    }
    const message = stage === "persist"
      ? "返金は受け付けましたが、反映に失敗しました。もう一度お試しください。"
      : "返金処理に失敗しました。時間をおいて再度お試しいただくか、管理者にお問い合わせください。";
    return { kind: "REFUND_FAILED", message, stage } as const;
  };

  if (!orderId) return fail("注文情報がありません", {});

  let verified: { orderId: string; paymentId: string };
  try {
    verified = await verifySquareOrderPayment({ orderId, expectedAmount: amount, purpose: game });
  } catch (e) {
    return fail(`Squareの入金照合に失敗: ${e instanceof Error ? e.message : String(e)}`, {});
  }

  // 同じentry・注文では常に同じ43文字のキー（Square上限45文字）。
  const idempotencyKey =
    "gr_" + createHash("sha256").update(`${game}:${entryId}:${verified.orderId}`).digest("hex").slice(0, 40);
  let refundAccepted = false;
  let refundException: unknown = null;
  let squareRefundId: string | null = null;
  let squareRefundStatus: string | null = null;
  try {
    const r = await refundSquarePayment({
      paymentId: verified.paymentId,
      amount,
      idempotencyKey,
      purpose: game,
      reason: `${game} entry ${entryId} self-cancel refund`,
    });
    squareRefundId = r.refundId;
    squareRefundStatus = r.status;
    refundAccepted = r.status === "PENDING" || r.status === "COMPLETED";
  } catch (e) {
    refundException = e;
    refundAccepted = false;
  }

  if (!refundAccepted) {
    // 前回はSquareだけ成功した／キー期限切れの場合も、全額返金済みなら復旧する。
    try {
      const payment = await getSquarePayment(verified.paymentId, game);
      const check = evaluateSquareRefund(payment, amount);
      if (check.state === "full") {
        refundAccepted = true;
        squareRefundStatus = squareRefundStatus ?? "ALREADY_REFUNDED";
      }
    } catch (e) {
      return fail(`返金済みかの確認に失敗: ${e instanceof Error ? e.message : String(e)}`, {
        orderId: verified.orderId, paymentId: verified.paymentId,
      });
    }
  }
  if (!refundAccepted) {
    const detail = refundException
      ? `Squareの返金が失敗しました（status: ${squareRefundStatus ?? "unknown"} / ${squareErrorDetail(refundException)}）`
      : `Squareの返金が失敗しました（status: ${squareRefundStatus ?? "unknown"}）`;
    return fail(detail, {
      orderId: verified.orderId, paymentId: verified.paymentId, squareRefundStatus,
    });
  }

  // Square受付後は途中の状態変更によらずrefundedを反映する（金銭移動との不整合防止）。
  try {
    await persistGameEntryRefund(game, entryRef, entry, lineUserId, {
      squareRefundId, squareRefundStatus, refundMethod: "auto",
    });
  } catch (e) {
    return fail(`Firestoreへの返金反映に失敗: ${e instanceof Error ? e.message : String(e)}`, {
      orderId: verified.orderId, paymentId: verified.paymentId, squareRefundId, squareRefundStatus,
    }, "persist");
  }

  try {
    await writeAuditLog({
      eventType: "entry.autoRefunded",
      gameCategory: game,
      actor: lineUserId,
      target: { entryId, date: entry.eventDate, lineUserId },
      beforeStatus: fromStatus,
      afterStatus: "refunded",
      meta: { orderId: verified.orderId, paymentId: verified.paymentId, amount, squareRefundId, squareRefundStatus },
    });
  } catch (e) {
    console.error("[gameEntryPayment] refund audit failed (best-effort):", e);
  }
  return { kind: "OK" };
}

export type RefundSyncResult =
  | { kind: "OK"; already: boolean }
  | { kind: "NOT_FOUND" }
  | { kind: "NOT_ELIGIBLE"; message: string }
  | { kind: "REFUND_NOT_FOUND" }
  | { kind: "VERIFY_FAILED"; message: string }
  | { kind: "PERSIST_FAILED"; message: string };

/** Squareは読み取りのみ。全額返金が確認できたときだけ返金済みを記録する。 */
export async function syncGameEntryRefund(
  game: ScoreboardGameId,
  entryId: string,
  admin: string,
): Promise<RefundSyncResult> {
  const cfg = GAME_PAYMENT_CONFIG[game];
  const { deriveStatus } = ENTRY_STATUS_MODULE[game];
  const entryRef = getDb().collection(cfg.entries).doc(entryId);
  const snap = await entryRef.get();
  if (!snap.exists) return { kind: "NOT_FOUND" };
  const entry = snap.data() as EntryDoc & { status?: string };
  if (deriveStatus(entry) === "refunded") return { kind: "OK", already: true };
  const st = deriveStatus(entry);
  if (st !== "paid" && st !== "cancelRejected") {
    return { kind: "NOT_ELIGIBLE", message: "支払い済みのエントリーではありません" };
  }
  const orderId = entry.paymentTransactionId;
  if (!orderId) return { kind: "NOT_ELIGIBLE", message: "決済情報がありません" };
  const amount = entry.paymentAmount ?? cfg.fee;
  let verified: { orderId: string; paymentId: string };
  try {
    verified = await verifySquareOrderPayment({ orderId, expectedAmount: amount, purpose: game });
  } catch (e) {
    return { kind: "VERIFY_FAILED", message: `Squareの入金照合に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  let payment;
  try {
    payment = await getSquarePayment(verified.paymentId, game);
  } catch (e) {
    return { kind: "VERIFY_FAILED", message: `Squareの決済情報取得に失敗: ${e instanceof Error ? e.message : String(e)}` };
  }
  const check = evaluateSquareRefund(payment, amount);
  if (check.state !== "full") return { kind: "REFUND_NOT_FOUND" };
  const refundId = (payment as { refundIds?: string[] }).refundIds?.[0] ?? null;
  try {
    const result = await persistGameEntryRefund(game, entryRef, entry, entry.lineUserId ?? "", {
      squareRefundId: refundId, squareRefundStatus: "SYNCED_FULL", refundMethod: "manualSync",
    });
    if (result.alreadyRefunded) return { kind: "OK", already: true };
  } catch (e) {
    return { kind: "PERSIST_FAILED", message: `反映に失敗しました: ${e instanceof Error ? e.message : String(e)}` };
  }
  try {
    await writeAuditLog({
      eventType: "entry.refundSynced",
      gameCategory: game,
      actor: admin,
      target: { entryId, date: entry.eventDate, lineUserId: entry.lineUserId },
      beforeStatus: st,
      afterStatus: "refunded",
      meta: { orderId: verified.orderId, paymentId: verified.paymentId, amount },
    });
  } catch (e) {
    console.error("[gameEntryPayment] writeAuditLog failed in syncGameEntryRefund():", e);
  }
  return { kind: "OK", already: false };
}

export interface FailedAutoRefund {
  entryId: string;
  eventDate: string;
  displayName: string;
  lineUserId: string;
  amount: number;
  orderId: string | null;
  failedAt: string | null;
}

/** 自動返金失敗ログの直近90日・最大200候補から、現在もpaidまたはcancelRejectedのentryを取得する。 */
export async function listFailedAutoRefunds(game: ScoreboardGameId): Promise<FailedAutoRefund[]> {
  const db = getDb();
  const cfg = GAME_PAYMENT_CONFIG[game];
  const { deriveStatus } = ENTRY_STATUS_MODULE[game];
  const cutoffIso = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  // イベント種別だけを等値検索し、種目・期間・並び順はJS側で処理する。
  const snap = await db.collection("mahjongAuditLogs").where("eventType", "==", "entry.autoRefundFailed").limit(500).get();
  if (snap.size >= 500) {
    console.warn("[gameEntryPayment] listFailedAutoRefunds: 500件の上限に達しました。取りこぼしの可能性があります。");
  }
  type FailureLog = { eventType?: string; gameCategory?: string; createdAt?: string; target?: { entryId?: string } };
  const entryIds = new Set<string>();
  for (const d of snap.docs) {
    const data = d.data() as FailureLog;
    if ((data.gameCategory ?? "mahjong") !== game) continue;
    if (!data.createdAt || data.createdAt < cutoffIso) continue;
    if (data.target?.entryId) entryIds.add(data.target.entryId);
    if (entryIds.size >= 200) break;
  }
  if (entryIds.size === 0) return [];
  const refs = Array.from(entryIds).map(id => db.collection(cfg.entries).doc(id));
  const docs = await db.getAll(...refs);
  const latestFailedAt = new Map<string, string>();
  for (const d of snap.docs) {
    const data = d.data() as FailureLog;
    if ((data.gameCategory ?? "mahjong") !== game) continue;
    const id = data.target?.entryId;
    if (id && entryIds.has(id) && (!latestFailedAt.has(id) || (data.createdAt ?? "") > latestFailedAt.get(id)!)) {
      latestFailedAt.set(id, data.createdAt ?? "");
    }
  }
  return docs.filter(d => d.exists)
    .map(d => ({ ...(d.data() as EntryDoc & { status?: string }), entryId: d.id }))
    .filter(e => {
      const st = deriveStatus(e);
      return st === "paid" || st === "cancelRejected";
    })
    .map(e => ({
      entryId: e.entryId, eventDate: e.eventDate ?? "", displayName: e.displayName ?? "",
      lineUserId: e.lineUserId ?? "", amount: e.paymentAmount ?? cfg.fee,
      orderId: e.paymentTransactionId ?? null, failedAt: latestFailedAt.get(e.entryId) ?? null,
    }))
    .sort((a, b) => (b.failedAt ?? "").localeCompare(a.failedAt ?? ""));
}
