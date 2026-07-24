/**
 * ポーカーリーグ 当日進行（ディーラー主導・複数試合）の状態機械。
 * 要件: docs/games/poker/ポーカー-ルール草案.md §4〜§6。
 *
 * 麻雀/ダーツ/ビリヤードと違い **シーズンGMを置かない**。各試合ごとに参加者の誰かが
 * 「ディーラーをやる」で自己選出し、進行（ゲーム開始/終了/確定）を行う。1日に複数試合。
 * 状態は pokerDayState/{seasonId}_{eventDate} の単一 doc に集約（＝唯一の真実）。
 *
 * ここでは受付・決済 API が参照する読み取り系のみ定義する。状態遷移（P3）は後続で追加。
 */

import { getDb } from "@/lib/firebaseAdmin";
import type { PokerDayState } from "@/types/poker";

export const pokerDayId = (seasonId: string, eventDate: string) => `${seasonId}_${eventDate}`;

/** 当日の状態を取得（未開始なら null）。 */
export async function getPokerDayState(
  seasonId: string,
  eventDate: string
): Promise<PokerDayState | null> {
  const snap = await getDb().collection("pokerDayState").doc(pokerDayId(seasonId, eventDate)).get();
  return snap.exists ? (snap.data() as PokerDayState) : null;
}

/** この開催日の受付（参加表明・支払い）が締め切られているか＝最初の試合が「ゲーム開始」されたか。 */
export function isPokerEntryClosed(day: PokerDayState | null): boolean {
  return !!day?.entryClosedAt;
}
