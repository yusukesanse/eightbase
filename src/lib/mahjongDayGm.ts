import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { isGameMaster } from "@/lib/mahjong";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import type { MahjongDayState, MahjongEntry } from "@/types";

/**
 * 麻雀の当日GM（2026-09-04 導入）
 * --------------------------------------------------------------------------
 * 管理画面で登録したシーズンGM（`Season.gameMasterIds`）が **2名以上同じ日に参加**すると、
 * 全員に GM パネルが出て「想定していない人が進行してしまう」事故が起きた。
 * そこで「その日に誰が進行するか」を開催日ごとに1名へ絞る。
 *
 * - **資格者** = 登録GM ∩ その日の参加表明者（`mahjongEntries`。cancelRequested / refunded は除く）。
 *   登録GMでも参加表明していなければ操作できない。参加していないGMに進行させたいときは
 *   管理画面の日程タブから参加者に追加する（既存機能）。
 * - 資格者が **1名だけ** → その人が**暗黙に**当日GM（追加の操作なし＝従来どおり動く）。
 * - 資格者が **2名以上** → 誰かが「GMをやる」（`POST /api/mahjong/day/gm`）で決めるまで
 *   **誰も進行操作できない**。決めた後はその人だけ。帰ってしまった場合は他の資格者が交代できる。
 * - 資格者 0名 → 誰も進行できない。
 *
 * ⚠️ 保存先は **`mahjongDayGm/{seasonId}_{eventDate}`（専用コレクション）**。
 *    `mahjongDayState` に混ぜないこと。`startDay()` は「dayState が既に存在する」と初期化を
 *    スキップするので、開始前に GM だけ書き込むと round / awaitingAssignment が入らない日ができる。
 * ⚠️ 進行系API（start / assign / assignment / cancel / finish / table）の認可は
 *    **`getMahjongDayGmAccess().isGm` の1本**に統一する。`isGameMaster()` 単体で認可しない。
 */

export const MAHJONG_DAY_GM_COLLECTION = "mahjongDayGm";

export const mahjongDayGmDocId = (seasonId: string, eventDate: string): string => `${seasonId}_${eventDate}`;

export interface MahjongDayGmDoc {
  seasonId: string;
  eventDate: string;
  gmUserId: string;
  gmDisplayName: string;
  claimedAt: string;
  updatedAt: string;
}

export interface MahjongDayGmCandidate {
  lineUserId: string;
  displayName: string;
}

export interface MahjongDayGmAccess {
  /** Season.gameMasterIds に含まれるか。 */
  registered: boolean;
  /** 登録GMかつその日に参加表明しているか（＝「GMをやる」を押せる人）。 */
  eligible: boolean;
  /** 進行系APIを操作できるか。 */
  isGm: boolean;
  /** 資格者が自分1名だけで、暗黙に当日GMになっているか。 */
  implicit: boolean;
  /** 資格者が2名以上いて、まだ誰も名乗り出ていないか（UIに「GMをやる」を出す）。 */
  needsClaim: boolean;
  /** 決定済みの当日GM（未決定なら null）。 */
  gmUserId: string | null;
  gmDisplayName: string | null;
  /** 資格者一覧（enteredAt 昇順）。資格者向けUIの表示にのみ使う。 */
  candidates: MahjongDayGmCandidate[];
}

type SeasonLike = { seasonId: string; gameMasterIds?: unknown } | null | undefined;
type GmLike = { gmUserId?: string | null; gmDisplayName?: string | null } | null | undefined;
type EntryLike = Pick<MahjongEntry, "lineUserId" | "displayName" | "enteredAt"> & { status?: string; paymentStatus?: string };

/** その日の参加表明として数える状態（キャンセル依頼中・返金済みは参加者ではない）。 */
function isParticipating(e: EntryLike): boolean {
  const st = deriveStatus(e);
  return st === "reserved" || st === "paid" || st === "cancelRejected";
}

/** 資格者 = 登録GM ∩ その日の参加表明者。enteredAt 昇順。 */
export function eligibleMahjongDayGms(season: SeasonLike, entries: EntryLike[]): MahjongDayGmCandidate[] {
  if (!season) return [];
  return entries
    .filter((e) => isGameMaster(season, e.lineUserId) && isParticipating(e))
    .sort((a, b) => (a.enteredAt ?? "").localeCompare(b.enteredAt ?? ""))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName || "ユーザー" }));
}

/**
 * 純関数の判定本体。gm doc の値は**いま資格者でなければ信用しない**
 * （管理画面で GM 登録を外された／参加をキャンセルした人が当日GMのまま残っても操作できない。
 *  その場合は未決定として扱い、残りの資格者で 1名なら暗黙GM・2名以上なら再度「GMをやる」）。
 */
export function resolveMahjongDayGmAccess(
  season: SeasonLike,
  gm: GmLike,
  entries: EntryLike[],
  userId: string
): MahjongDayGmAccess {
  const registered = isGameMaster(season, userId);
  const candidates = eligibleMahjongDayGms(season, entries);
  const eligible = registered && candidates.some((c) => c.lineUserId === userId);

  const gmUserId = gm?.gmUserId && candidates.some((c) => c.lineUserId === gm.gmUserId) ? gm.gmUserId : null;
  const gmDisplayName = gmUserId ? (gm?.gmDisplayName ?? null) : null;

  if (gmUserId) {
    return { registered, eligible, isGm: gmUserId === userId, implicit: false, needsClaim: false, gmUserId, gmDisplayName, candidates };
  }
  if (candidates.length === 1) {
    const only = candidates[0].lineUserId;
    return { registered, eligible, isGm: only === userId, implicit: only === userId, needsClaim: false, gmUserId: null, gmDisplayName: null, candidates };
  }
  return { registered, eligible, isGm: false, implicit: false, needsClaim: candidates.length >= 2, gmUserId: null, gmDisplayName: null, candidates };
}

async function fetchDayEntries(seasonId: string, eventDate: string): Promise<EntryLike[]> {
  // seasonId+eventDate の等値2条件で当日分のみ（複合インデックス不要・全件スキャンしない）。
  const snap = await getDb()
    .collection("mahjongEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  return snap.docs.map((d) => d.data() as EntryLike);
}

/**
 * その開催日における userId の GM 権限。進行系APIはこれで認可する。
 * 登録GMでない人は Firestore を読まずに返す（当日GETは全参加者が12秒ごとにポーリングするため）。
 */
export async function getMahjongDayGmAccess(
  season: SeasonLike,
  eventDate: string,
  userId: string
): Promise<MahjongDayGmAccess> {
  if (!season || !isGameMaster(season, userId)) {
    return { registered: false, eligible: false, isGm: false, implicit: false, needsClaim: false, gmUserId: null, gmDisplayName: null, candidates: [] };
  }
  const db = getDb();
  const [gmSnap, entries] = await Promise.all([
    db.collection(MAHJONG_DAY_GM_COLLECTION).doc(mahjongDayGmDocId(season.seasonId, eventDate)).get(),
    fetchDayEntries(season.seasonId, eventDate),
  ]);
  const gm = gmSnap.exists ? (gmSnap.data() as GmLike) : null;
  return resolveMahjongDayGmAccess(season, gm, entries, userId);
}

export const MAHJONG_DAY_GM_REQUIRED_MESSAGE =
  "本日のゲームマスターのみ操作できます。参加しているGMが2名以上いる場合は「GMをやる」で担当を決めてください。";

/**
 * 進行系API 用の認可ゲート。**6本のルートはこれを使う**（判定・403・障害時の 500 を1箇所に揃える）。
 * - 当日GMでなければ 403（MAHJONG_DAY_GM_REQUIRED_MESSAGE）
 * - 判定中に Firestore が落ちたら 500（未処理の例外にしない・内部エラー文は出さない）
 */
export async function requireMahjongDayGm(
  season: SeasonLike,
  eventDate: string,
  userId: string
): Promise<{ ok: true; access: MahjongDayGmAccess } | { ok: false; response: NextResponse }> {
  let access: MahjongDayGmAccess;
  try {
    access = await getMahjongDayGmAccess(season, eventDate, userId);
  } catch (error) {
    console.error("[mahjongDayGm] access check failed:", error);
    return { ok: false, response: NextResponse.json({ error: "ゲームマスターの確認に失敗しました" }, { status: 500 }) };
  }
  if (!access.isGm) {
    return { ok: false, response: NextResponse.json({ error: MAHJONG_DAY_GM_REQUIRED_MESSAGE }, { status: 403 }) };
  }
  return { ok: true, access };
}

/**
 * 「GMをやる」／「交代する」。呼び出したユーザー自身を当日GMにする。
 * - 資格者（登録GM ∩ 参加表明者）のみ。それ以外は 403。
 * - 本日終了後（dayState.finishedAt）は 409。
 * - 冪等（すでに自分なら already）。他の資格者からの交代は takeoverFrom に前任者を返す。
 */
export async function claimMahjongDayGm(
  season: SeasonLike,
  eventDate: string,
  userId: string
): Promise<
  | { ok: true; already: boolean; takeoverFrom: string | null }
  | { ok: false; status: 403 | 409; error: string }
> {
  if (!season) return { ok: false, status: 403, error: "アクティブなシーズンがありません" };
  const entries = await fetchDayEntries(season.seasonId, eventDate);
  const me = eligibleMahjongDayGms(season, entries).find((c) => c.lineUserId === userId);
  if (!me) {
    return { ok: false, status: 403, error: "この開催日に参加表明しているゲームマスターのみ担当できます" };
  }

  const db = getDb();
  const gmRef = db.collection(MAHJONG_DAY_GM_COLLECTION).doc(mahjongDayGmDocId(season.seasonId, eventDate));
  const dayRef = db.collection("mahjongDayState").doc(mahjongDayGmDocId(season.seasonId, eventDate));

  return db.runTransaction(async (tx) => {
    const [gmSnap, daySnap] = await Promise.all([tx.get(gmRef), tx.get(dayRef)]);
    const day = daySnap.exists ? (daySnap.data() as MahjongDayState) : null;
    if (day?.finishedAt) {
      return { ok: false as const, status: 409 as const, error: "本日の対局は終了しています" };
    }
    const cur = gmSnap.exists ? (gmSnap.data() as MahjongDayGmDoc) : null;
    if (cur?.gmUserId === userId) return { ok: true as const, already: true, takeoverFrom: null };

    const now = new Date().toISOString();
    const doc: MahjongDayGmDoc = {
      seasonId: season.seasonId,
      eventDate,
      gmUserId: userId,
      gmDisplayName: me.displayName,
      claimedAt: now,
      updatedAt: now,
    };
    tx.set(gmRef, doc);
    return { ok: true as const, already: false, takeoverFrom: cur?.gmUserId ?? null };
  });
}
