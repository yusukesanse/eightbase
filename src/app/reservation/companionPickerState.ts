/**
 * 同伴者ピッカー（一緒に入る人）の「候補ドロップダウンを開くか」の状態遷移。
 *
 * コンポーネントから切り出しているのは、**1名選んだあとも続けて2人目を打てること**を
 * テストで固定するため（`__tests__/unit/lib/companionPickerState.test.ts`）。
 * 本リポジトリでは jsdom 環境が動かないので、開閉判定を純関数にして node 環境で検証する。
 *
 * ⚠️ 中核の不変条件: `select`（候補を選ぶ）で **focused を false にしてはいけない**。
 * 候補の選択は `onPointerDown` + `preventDefault()` で行うため input は DOM フォーカスを
 * 保ったままで、focus イベントが二度と飛んでこない。ここで false にすると `focused` が戻らず、
 * **2人目以降を打っても候補が開かない**（demo で実際に発生）。
 * 候補が閉じるのは query が空になるからで、focused を落とす必要はない。
 */

export interface CompanionPickerState {
  /** 検索窓の入力値 */
  query: string;
  /** input にフォーカスがある（＝候補を出してよい）か */
  focused: boolean;
}

export const INITIAL_COMPANION_PICKER_STATE: CompanionPickerState = {
  query: "",
  focused: false,
};

export type CompanionPickerEvent =
  /** input が focus された */
  | { type: "focus" }
  /** 文字を入力した。入力＝候補を見たい意思なので focused も立てる */
  | { type: "type"; query: string }
  /** 候補を選んだ（input のフォーカスは保たれたまま） */
  | { type: "select" }
  /** Escape を押した */
  | { type: "escape" }
  /** 外側をタップした */
  | { type: "dismiss" };

export function companionPickerReducer(
  state: CompanionPickerState,
  event: CompanionPickerEvent
): CompanionPickerState {
  switch (event.type) {
    case "focus":
      return state.focused ? state : { ...state, focused: true };
    case "type":
      // focused も立てる: 選択直後・disabled 解除直後・LINEミニアプリ WebView の IME など
      // focus イベントが来ない経路でも候補が開くようにする。
      return { query: event.query, focused: true };
    case "select":
      // query を空にすれば isCompanionDropdownOpen は false になる（＝候補は閉じる）。
      // focused は保つ（上のコメント参照。ここを false にするのが元のバグ）。
      return { query: "", focused: true };
    case "escape":
    case "dismiss":
      return state.focused ? { ...state, focused: false } : state;
  }
}

/** 候補ドロップダウンを表示するか。 */
export function isCompanionDropdownOpen(state: CompanionPickerState): boolean {
  return state.focused && state.query.trim() !== "";
}
