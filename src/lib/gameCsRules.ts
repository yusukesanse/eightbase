/**
 * CS（チャンピオンシップ）の種目ごとのルール表。種目の違いはここだけに書く。
 * 画面からも読むので Firestore などサーバー専用の import をしないこと。
 * ダーツ・ビリヤードを足すときは CsGame と CS_RULES に1行ずつ足す。
 */
export type CsGame = "mahjong" | "poker";

export interface GameCsRules {
  game: CsGame;
  collection: "mahjongCsEvents" | "pokerCsEvents";
  /** 1卓の最少人数 */
  minSeats: number;
  /** 1卓の最大人数（キャンバスに出す空席の数） */
  maxSeats: number;
  /** 通過人数の上限（卓の人数による上限は maxAdvanceFor で別にかける） */
  maxAdvance: number;
  /** リーグの段の名前（上の段から）。優先枠は上の2段 */
  tierLabels: [string, string, string];
  /** 申告する値の呼び名 */
  scoreLabel: string;
  /** 同点の追加勝負の呼び名 */
  tiebreakLabel: string;
  /** 決勝の確定で podium を書くか（麻雀は championId だけ。データの形を変えないため false） */
  writesPodium: boolean;
}

export const MAHJONG_CS_RULES: GameCsRules = {
  game: "mahjong", collection: "mahjongCsEvents", minSeats: 4, maxSeats: 4, maxAdvance: 3,
  tierLabels: ["M1", "M2", "M3"], scoreLabel: "持ち点", tiebreakLabel: "", writesPodium: false,
};

export const POKER_CS_RULES: GameCsRules = {
  game: "poker", collection: "pokerCsEvents", minSeats: 2, maxSeats: 6, maxAdvance: 3,
  tierLabels: ["P1", "P2", "P3"], scoreLabel: "チップ", tiebreakLabel: "追加ハンド", writesPodium: true,
};

export const CS_RULES: Record<CsGame, GameCsRules> = { mahjong: MAHJONG_CS_RULES, poker: POKER_CS_RULES };

/** 卓の通過人数の上限。決勝は表彰人数なので卓の全員まで、それ以外は最低1人は落ちる。 */
export function maxAdvanceFor(rules: GameCsRules, seatCount: number, isFinal: boolean): number {
  return Math.max(0, Math.min(rules.maxAdvance, isFinal ? seatCount : seatCount - 1));
}
