/**
 * CS（チャンピオンシップ）の種目ごとのルール表。種目の違いはここだけに書く。
 * 画面からも読むので Firestore などサーバー専用の import をしないこと。
 */
export type CsGame = "mahjong" | "poker" | "darts" | "billiards";

export interface GameCsRules {
  game: CsGame;
  collection: "mahjongCsEvents" | "pokerCsEvents" | "dartsCsEvents" | "billiardsCsEvents";
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
  /** 値の後ろに付ける単位（「12,000チップ」「180点」） */
  unit: string;
  /** 利用者の申告欄の見出し（麻雀は持ち点＋着順の専用シートなので使わない） */
  reportLabel: string;
  /** 決勝の確定で podium を書くか（麻雀は championId だけ。データの形を変えないため false） */
  writesPodium: boolean;
  /** 敗者の矢印（3位決定戦用）を引けるか。ビリヤードだけ true。省略＝引けない */
  loserArrow?: boolean;
  /** 申告の形。"winner"＝卓の2人が勝った人を申告し、一致したら確定（ビリヤード）。省略＝値を申告する今の動き */
  report?: "winner";
}

export const MAHJONG_CS_RULES: GameCsRules = {
  game: "mahjong", collection: "mahjongCsEvents", minSeats: 4, maxSeats: 4, maxAdvance: 3,
  tierLabels: ["M1", "M2", "M3"], scoreLabel: "持ち点", tiebreakLabel: "", unit: "点", reportLabel: "最終持ち点", writesPodium: false,
};

export const POKER_CS_RULES: GameCsRules = {
  game: "poker", collection: "pokerCsEvents", minSeats: 2, maxSeats: 6, maxAdvance: 3,
  tierLabels: ["P1", "P2", "P3"], scoreLabel: "チップ", tiebreakLabel: "追加ハンド",
  unit: "チップ", reportLabel: "終了時のチップ", writesPodium: true,
};

export const DARTS_CS_RULES: GameCsRules = {
  game: "darts", collection: "dartsCsEvents", minSeats: 2, maxSeats: 4, maxAdvance: 3,
  tierLabels: ["D1", "D2", "D3"], scoreLabel: "点数", tiebreakLabel: "追加スロー",
  unit: "点", reportLabel: "カウントアップの点数", writesPodium: true,
};

/** ビリヤードは点数を入れない（勝った人を2人とも申告）。unit は使わないので空。 */
export const BILLIARDS_CS_RULES: GameCsRules = {
  game: "billiards", collection: "billiardsCsEvents", minSeats: 2, maxSeats: 2, maxAdvance: 1,
  tierLabels: ["B1", "B2", "B3"], scoreLabel: "勝敗", tiebreakLabel: "",
  unit: "", reportLabel: "勝ったのは？", writesPodium: true, loserArrow: true, report: "winner",
};

export const CS_RULES: Record<CsGame, GameCsRules> = {
  mahjong: MAHJONG_CS_RULES, poker: POKER_CS_RULES, darts: DARTS_CS_RULES, billiards: BILLIARDS_CS_RULES,
};

/** 卓の通過人数の上限。決勝は表彰人数なので卓の全員まで、それ以外は最低1人は落ちる。 */
export function maxAdvanceFor(rules: GameCsRules, seatCount: number, isFinal: boolean): number {
  return Math.max(0, Math.min(rules.maxAdvance, isFinal ? seatCount : seatCount - 1));
}
