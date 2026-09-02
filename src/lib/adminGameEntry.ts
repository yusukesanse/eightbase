/**
 * 麻雀は卓振り分けプールを entries から毎回作り直すため、締切後でも管理者が参加者を追加できる。
 * 一方、他3種目は開始時に名簿が確定し、順位ポイントもその名簿を基準にするため開始後の新規追加は不可。
 * ただし、名簿に未払いで載っている人の paid 更新だけは、既存の支払い完了処理と同じ扱いで許可する。
 */

import type { ScoreboardGameId } from "@/types";
import { getDb } from "@/lib/firebaseAdmin";
import { getActiveSeason } from "@/lib/mahjong";
import { GAME_PAYMENT_CONFIG } from "@/lib/gameEntryPayment";
import { buildMahjongEntryId } from "@/lib/mahjongEntryValidation";
import { buildDartsEntryId } from "@/lib/dartsEntryValidation";
import { buildBilliardsEntryId } from "@/lib/billiardsEntryValidation";
import { buildPokerEntryId } from "@/lib/pokerEntryValidation";
import { deriveStatus as deriveMahjong } from "@/lib/mahjongEntryStatus";
import { deriveStatus as deriveDarts } from "@/lib/dartsEntryStatus";
import { deriveStatus as deriveBilliards } from "@/lib/billiardsEntryStatus";
import { deriveStatus as derivePoker } from "@/lib/pokerEntryStatus";
import { writeAuditLog } from "@/lib/auditLog";

export type AdminAddEntryResult =
  | {
      ok: true;
      entryId: string;
      entry: Record<string, unknown>;
      previousStatus: string | null;
      rosterUpdated: boolean;
    }
  | {
      ok: false;
      status: 400 | 409;
      code:
        | "SEASON_INACTIVE"
        | "SEASON_MISMATCH"
        | "USER_NOT_FOUND"
        | "DAY_STARTED"
        | "DAY_FINISHED";
      error: string;
    };

type EntryLike = { status?: string; paymentStatus?: string } & Record<string, unknown>;
type DayMember = { lineUserId?: string; paid?: boolean } & Record<string, unknown>;
type TransactionResult =
  | Extract<AdminAddEntryResult, { ok: false }>
  | {
      ok: true;
      entry: Record<string, unknown>;
      previousStatus: string | null;
      rosterUpdated: boolean;
    };

const BUILD_ENTRY_ID: Record<ScoreboardGameId, (seasonId: string, eventDate: string, lineUserId: string) => string> = {
  mahjong: buildMahjongEntryId,
  darts: buildDartsEntryId,
  billiards: buildBilliardsEntryId,
  poker: buildPokerEntryId,
};

const DERIVE_STATUS: Record<ScoreboardGameId, (entry: EntryLike) => string> = {
  mahjong: deriveMahjong,
  darts: deriveDarts,
  billiards: deriveBilliards,
  poker: derivePoker,
};

export async function addGameEntryByAdmin(input: {
  game: ScoreboardGameId;
  seasonId?: string;
  eventDate: string;
  lineUserId: string;
  markPaid: boolean;
  admin: string;
}): Promise<AdminAddEntryResult> {
  const season = await getActiveSeason(input.game);
  if (!season) {
    return {
      ok: false,
      status: 400,
      code: "SEASON_INACTIVE",
      error: "アクティブなシーズンがありません",
    };
  }
  if (input.seasonId && input.seasonId !== season.seasonId) {
    return {
      ok: false,
      status: 409,
      code: "SEASON_MISMATCH",
      error: "開催中のシーズン以外には追加できません",
    };
  }

  const db = getDb();
  const [userDoc, authSnap] = await Promise.all([
    db.collection("users").doc(input.lineUserId).get(),
    db.collection("authorizedUsers").where("lineUserId", "==", input.lineUserId).limit(1).get(),
  ]);
  if (!userDoc.exists && authSnap.empty) {
    return {
      ok: false,
      status: 400,
      code: "USER_NOT_FOUND",
      error: "ユーザーが存在しません",
    };
  }

  const user = userDoc.data() || {};
  const authorizedUser = authSnap.docs[0]?.data() || {};
  const displayName =
    (user.displayName as string) || (authorizedUser.displayName as string) || "ユーザー";
  const pictureUrl = (user.pictureUrl as string) || "";
  const seasonId = season.seasonId;
  const cfg = GAME_PAYMENT_CONFIG[input.game];
  const entryId = BUILD_ENTRY_ID[input.game](seasonId, input.eventDate, input.lineUserId);
  const entryRef = db.collection(cfg.entries).doc(entryId);
  const dayRef = db.collection(cfg.dayState).doc(`${seasonId}_${input.eventDate}`);
  const lockRef = db
    .collection(`${input.game}MonthlyLocks`)
    .doc(`${seasonId}_${input.lineUserId}_${input.eventDate.slice(0, 7)}`);

  let outcome: TransactionResult | undefined;
  await db.runTransaction(async (tx) => {
    // Firestore transaction は書き込み開始後に read できないため、必要な read を最初に完了させる。
    const [entrySnap, daySnap] = await Promise.all([tx.get(entryRef), tx.get(dayRef)]);
    const prev = entrySnap.exists ? (entrySnap.data() as EntryLike) : null;
    const previousStatus = prev ? DERIVE_STATUS[input.game](prev) : null;
    const nowIso = new Date().toISOString();
    let rosterUpdated = false;

    if (input.game !== "mahjong" && daySnap.exists) {
      const day = (daySnap.data() || {}) as Record<string, unknown>;
      if (day.finishedAt) {
        outcome = {
          ok: false,
          status: 409,
          code: "DAY_FINISHED",
          error: "この開催日は終了済みのため追加できません",
        };
        return;
      }

      if (day.entryClosedAt) {
        const participants = Array.isArray(day.participants)
          ? (day.participants as DayMember[])
          : [];
        const member = participants.find((item) => item.lineUserId === input.lineUserId);
        if (!member) {
          outcome = {
            ok: false,
            status: 409,
            code: "DAY_STARTED",
            error: "ゲーム開始後は新しい参加者を追加できません（当日名簿が確定しています）",
          };
          return;
        }
        if (input.markPaid && member.paid === false) {
          tx.update(dayRef, {
            participants: participants.map((item) =>
              item.lineUserId === input.lineUserId ? { ...item, paid: true } : item
            ),
            updatedAt: nowIso,
          });
          rosterUpdated = true;
        }
      }
    }

    const entry: Record<string, unknown> = {
      seasonId,
      eventDate: input.eventDate,
      lineUserId: input.lineUserId,
      displayName,
      pictureUrl,
      enteredAt: prev?.enteredAt || nowIso,
      status: input.markPaid ? "paid" : "reserved",
      ...(input.markPaid
        ? {
            paymentStatus: "paid",
            paymentAmount: prev?.paymentAmount ?? cfg.fee,
            paidAt: prev?.paidAt || nowIso,
          }
        : {}),
    };

    tx.set(entryRef, entry, { merge: true });
    tx.set(lockRef, {
      seasonId,
      lineUserId: input.lineUserId,
      ym: input.eventDate.slice(0, 7),
      eventDate: input.eventDate,
      updatedAt: nowIso,
    });

    outcome = { ok: true, entry, previousStatus, rosterUpdated };
  });

  if (!outcome) throw new Error("管理者追加トランザクションの結果を取得できませんでした");
  if (!outcome.ok) return outcome;

  await writeAuditLog({
    eventType: "entry.adminAdded",
    gameCategory: input.game,
    actor: `admin:${input.admin}`,
    target: { date: input.eventDate, entryId, lineUserId: input.lineUserId },
    beforeStatus: outcome.previousStatus,
    afterStatus: input.markPaid ? "paid" : "reserved",
    meta: { markPaid: input.markPaid, displayName, rosterUpdated: outcome.rosterUpdated },
  });

  return {
    ok: true,
    entryId,
    entry: { ...outcome.entry, entryId },
    previousStatus: outcome.previousStatus,
    rosterUpdated: outcome.rosterUpdated,
  };
}
