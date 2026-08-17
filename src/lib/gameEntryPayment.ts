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
import { verifySquareOrderPayment } from "./square";
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
