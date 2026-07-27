import { getDb } from "@/lib/firebaseAdmin";
import { GAME_SCHEDULE_CFG, buildGameScheduleId, type ScheduleGame } from "@/lib/gameSchedule";

/**
 * 参加受付の締切（＝開催日の開始時刻）
 * --------------------------------------------------------------------------
 * ダーツ / ビリヤード / ポーカーは **GMを参加者の中から選ぶ**ので、「GMが押した瞬間が締切」だと
 * 「締切しないとGMを決められない／GMがいないと締切できない」という循環になる。
 * そこで受付締切は**日程に設定した開始時刻（JST）**で自動的に決まる。
 *
 *   開始時刻までに参加表明した人（**未払いを含む**）＝その日の参加者
 *   → 締切後は新規の参加表明は不可。未払いの人はその場で支払う（支払いは締切後も可）
 *   → 参加者の中から「GMをやる」でGMを決める → GMが進行開始
 *
 * 麻雀だけは従来どおり **シーズン固定GMが「ゲーム開始」で締め切る**（この判定は使わない）。
 *
 * ⚠️ 本番は TZ=UTC で動く。`new Date("YYYY-MM-DDTHH:MM")` はサーバーのTZ依存になるため、
 *    必ず `+09:00` を明示して JST の瞬間を組み立てること（曜日判定の `dayOfWeek()` と同じ理由）。
 */

/** 時刻ベースの締切を使う種目（麻雀はGM操作で締めるので対象外）。 */
export type DeadlineGame = Exclude<ScheduleGame, "mahjong">;

/**
 * 開催日の開始時刻（HH:MM・JST）。日程docの `startTime` を正とし、無ければ種目の既定値。
 * 日程doc自体が無い場合も既定値を返す（開催日かどうかの検証は呼び出し側の責務）。
 */
export async function getScheduleStartTime(
  game: DeadlineGame,
  seasonId: string,
  eventDate: string
): Promise<string> {
  const cfg = GAME_SCHEDULE_CFG[game];
  const snap = await getDb().collection(cfg.col).doc(buildGameScheduleId(seasonId, eventDate)).get();
  const startTime = (snap.data() as { startTime?: string } | undefined)?.startTime;
  return startTime || cfg.start;
}

/**
 * その開催日の受付締切（＝開始時刻 JST）を過ぎたか。
 * @param eventDate YYYY-MM-DD
 * @param startTime HH:MM（JST）
 */
export function isPastEntryDeadline(eventDate: string, startTime: string, now: Date = new Date()): boolean {
  const t = Date.parse(`${eventDate}T${startTime}:00+09:00`);
  if (Number.isNaN(t)) return false; // 時刻が壊れているときは締めない（受付を止めて詰ませない）
  return now.getTime() >= t;
}

/** 日程を読んで、その開催日の受付が時刻的に締め切られているかを返す。 */
export async function isEntryClosedByTime(
  game: DeadlineGame,
  seasonId: string,
  eventDate: string,
  now: Date = new Date()
): Promise<boolean> {
  return isPastEntryDeadline(eventDate, await getScheduleStartTime(game, seasonId, eventDate), now);
}

export const ENTRY_DEADLINE_PASSED_MESSAGE =
  "この開催日の受付は開始時刻をもって締め切りました。";
