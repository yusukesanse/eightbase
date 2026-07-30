/**
 * 同伴者ピッカーの候補ドロップダウンの開閉。
 *
 * 回帰の本体は「**1名選んだあと、続けて別の名前を打つと候補が出る**」こと。
 * 選択は onPointerDown + preventDefault で行うため input は DOM フォーカスを保ったままで、
 * 選択時に focused を false に落とすと focus イベントが二度と飛ばず、2人目以降が永久に選べなくなる
 * （demo で実際に発生）。
 *
 * ※ 本リポジトリでは jsdom 環境が動かないため、コンポーネントを描画せず
 *   開閉の状態遷移（純関数）を node 環境で検証している。
 */

import {
  companionPickerReducer,
  isCompanionDropdownOpen,
  INITIAL_COMPANION_PICKER_STATE,
  type CompanionPickerEvent,
  type CompanionPickerState,
} from "@/app/reservation/companionPickerState";

/** イベント列を順に適用する（利用者の操作列をそのまま書けるようにする）。 */
function apply(
  events: CompanionPickerEvent[],
  from: CompanionPickerState = INITIAL_COMPANION_PICKER_STATE
): CompanionPickerState {
  return events.reduce(companionPickerReducer, from);
}

describe("同伴者ピッカー — 候補ドロップダウンの開閉", () => {
  test("初期状態は閉じている", () => {
    expect(isCompanionDropdownOpen(INITIAL_COMPANION_PICKER_STATE)).toBe(false);
  });

  test("フォーカスだけでは開かない（入力があって初めて開く）", () => {
    expect(isCompanionDropdownOpen(apply([{ type: "focus" }]))).toBe(false);
    expect(
      isCompanionDropdownOpen(apply([{ type: "focus" }, { type: "type", query: "やまだ" }]))
    ).toBe(true);
  });

  test("空白だけの入力では開かない", () => {
    expect(
      isCompanionDropdownOpen(apply([{ type: "focus" }, { type: "type", query: "   " }]))
    ).toBe(false);
  });

  test("選択すると入力が消えて候補が閉じる", () => {
    const s = apply([{ type: "focus" }, { type: "type", query: "やまだ" }, { type: "select" }]);
    expect(s.query).toBe("");
    expect(isCompanionDropdownOpen(s)).toBe(false);
  });

  // ★ 回帰テストの本体
  test("1名選んだあと、続けて別の名前を打つと候補が開く", () => {
    const s = apply([
      { type: "focus" },
      { type: "type", query: "やまだ" },
      { type: "select" },
      // ここで focus イベントは飛ばない（input は DOM フォーカスを保ったまま）
      { type: "type", query: "ささき" },
    ]);
    expect(isCompanionDropdownOpen(s)).toBe(true);
    expect(s.query).toBe("ささき");
  });

  test("選択後も focused は保たれる（focus イベントが二度と来ないため）", () => {
    const s = apply([{ type: "focus" }, { type: "type", query: "やまだ" }, { type: "select" }]);
    expect(s.focused).toBe(true);
  });

  test("3人目まで、focus イベントなしで連続して選べる", () => {
    let s = apply([{ type: "focus" }]);
    for (const q of ["やまだ たろう", "やまだ はなこ", "ささき"]) {
      s = companionPickerReducer(s, { type: "type", query: q });
      expect(isCompanionDropdownOpen(s)).toBe(true); // 毎回ちゃんと開く
      s = companionPickerReducer(s, { type: "select" });
      expect(isCompanionDropdownOpen(s)).toBe(false); // 選んだら閉じる
    }
  });

  test("Escape で閉じ、再入力で開き直せる", () => {
    const closed = apply([
      { type: "focus" },
      { type: "type", query: "やまだ" },
      { type: "escape" },
    ]);
    expect(isCompanionDropdownOpen(closed)).toBe(false);
    // Escape は入力値を消さない（打ち直しを強制しない）
    expect(closed.query).toBe("やまだ");

    expect(isCompanionDropdownOpen(companionPickerReducer(closed, { type: "type", query: "やまだ た" }))).toBe(true);
  });

  test("外側タップで閉じ、再入力で開き直せる", () => {
    const closed = apply([
      { type: "focus" },
      { type: "type", query: "ささき" },
      { type: "dismiss" },
    ]);
    expect(isCompanionDropdownOpen(closed)).toBe(false);
    expect(isCompanionDropdownOpen(companionPickerReducer(closed, { type: "type", query: "ささき" }))).toBe(true);
  });

  test("入力を全部消すと閉じる", () => {
    const s = apply([
      { type: "focus" },
      { type: "type", query: "やまだ" },
      { type: "type", query: "" },
    ]);
    expect(isCompanionDropdownOpen(s)).toBe(false);
  });

  test("変化がないイベントは同一オブジェクトを返す（無駄な再レンダリングを避ける）", () => {
    const focusedState = apply([{ type: "focus" }]);
    expect(companionPickerReducer(focusedState, { type: "focus" })).toBe(focusedState);
    expect(
      companionPickerReducer(INITIAL_COMPANION_PICKER_STATE, { type: "dismiss" })
    ).toBe(INITIAL_COMPANION_PICKER_STATE);
  });
});
