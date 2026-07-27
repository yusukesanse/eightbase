import { getDb } from "@/lib/firebaseAdmin";

/**
 * 当日GM（ダーツ / ビリヤード）
 * --------------------------------------------------------------------------
 * ダーツ・ビリヤードの GM は**シーズン固定ではなく開催日ごとに決める**。
 * 参加者の誰かが当日「GMをやる」で自己選出し、その人だけが開始・進行・確定・流会を操作できる。
 * （ポーカーの「ディーラーをやる」と同じ考え方。麻雀だけが従来どおり `Season.gameMasterIds` で固定）
 *
 * - 保存先は各種目の当日stateドキュメント（`{game}DayState/{seasonId}_{eventDate}`）の
 *   `gmUserId` / `gmDisplayName`。表示名は非正規化して持つ（GETのたびに users を引かないため）。
 * - **交代可**。担当者が帰ってしまうと当日フローが詰むため、参加者なら誰でも引き継げる。
 *   UI 側で「交代しますか？」の確認を出すこと。
 * - GM未設定の間は誰も進行できない（開始も流会もできない）＝当日まず誰かがGMになる導線が必要。
 *
 * ⚠️ 各種目の `start*Day()` は当日stateを `tx.set()` で**全上書き**する。
 *    新しい state を組み立てるときは必ず `gmUserId` / `gmDisplayName` を引き継ぐこと
 *    （落とすと開始した瞬間にGM不在になり、以降の進行が全部403になる）。
 */

export type DayGmGame = "darts" | "billiards";

const COLLECTION: Record<DayGmGame, string> = {
  darts: "dartsDayState",
  billiards: "billiardsDayState",
};

export const dayGmDocId = (seasonId: string, eventDate: string): string => `${seasonId}_${eventDate}`;

export interface DayGmInfo {
  gmUserId: string | null;
  gmDisplayName: string | null;
}

/** その開催日のGM（未設定なら null）。 */
export async function getDayGm(
  game: DayGmGame,
  seasonId: string,
  eventDate: string
): Promise<DayGmInfo> {
  const snap = await getDb().collection(COLLECTION[game]).doc(dayGmDocId(seasonId, eventDate)).get();
  const data = snap.data() as { gmUserId?: string | null; gmDisplayName?: string | null } | undefined;
  return { gmUserId: data?.gmUserId ?? null, gmDisplayName: data?.gmDisplayName ?? null };
}

/**
 * 指定ユーザーがその開催日のGMか。**進行系APIの認可はこれ1本に統一する**。
 * GM未設定（誰も名乗り出ていない）なら常に false。
 */
export async function isDayGm(
  game: DayGmGame,
  seasonId: string,
  eventDate: string,
  userId: string
): Promise<boolean> {
  const { gmUserId } = await getDayGm(game, seasonId, eventDate);
  return !!gmUserId && gmUserId === userId;
}

/** GM未設定なら 403 用のメッセージ付きで弾くためのヘルパー。 */
export const DAY_GM_REQUIRED_MESSAGE =
  "当日のゲームマスターのみ操作できます。まだ決まっていない場合は「GMをやる」から担当してください。";
