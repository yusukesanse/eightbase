/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import CsBracketCanvas from "@/components/admin/mahjongCs/CsBracketCanvas";
import { POKER_CS_RULES } from "@/lib/gameCsRules";
import type { CanvasDraft } from "@/lib/mahjongCsCanvas";

// 麻雀の mahjongCsBracketCanvas.test.tsx と同じ組み方で、ルール表だけポーカーを渡す。
function setup(draft: CanvasDraft) {
  const onChange = jest.fn();
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, toJSON() {},
  });
  const result = render(<CsBracketCanvas draft={draft} entrantsById={new Map()} editable onChange={onChange} rules={POKER_CS_RULES} />);
  return { ...result, onChange };
}
const table = (container: HTMLElement, id: string) => container.querySelector(`[data-table="${id}"]`) as HTMLElement;
afterEach(() => jest.restoreAllMocks());

test("ポーカーの2人卓（決勝以外）は勝ち抜けを1名より増やせない", () => {
  const { container } = setup({ seedUserIds: [], tables: [
    { id: "p", x: 20, y: 300, advanceCount: 1, to: "f", playerIds: ["a", "b"] },
    { id: "f", x: 240, y: 20, advanceCount: 1, to: null, playerIds: ["c"] },
  ] });
  expect(within(table(container, "p")).getByRole("button", { name: "勝ち抜けを増やす" })).toBeDisabled();
});

test("入ってくる人数も卓の人数に数える。決勝は卓の人数まで表彰できる", () => {
  const { container, onChange } = setup({ seedUserIds: [], tables: [
    { id: "p", x: 20, y: 300, advanceCount: 1, to: "f", playerIds: ["a", "b"] },
    { id: "f", x: 240, y: 20, advanceCount: 1, to: null, playerIds: ["c"] },
  ] });
  // 決勝 f は直接1名＋入ってくる1名＝2名なので表彰は2名まで
  const plus = within(table(container, "f")).getByRole("button", { name: "勝ち抜けを増やす" });
  expect(plus).toBeEnabled();
  fireEvent.click(plus);
  expect(onChange.mock.calls[0][0].tables[1].advanceCount).toBe(2);
});

test("ポーカーの3人卓（決勝以外）は勝ち抜け2名で止まる", () => {
  const { container } = setup({ seedUserIds: [], tables: [
    { id: "p", x: 20, y: 300, advanceCount: 2, to: "f", playerIds: ["a", "b", "c"] },
    { id: "f", x: 240, y: 20, advanceCount: 1, to: null, playerIds: ["d"] },
  ] });
  expect(within(table(container, "p")).getByRole("button", { name: "勝ち抜けを増やす" })).toBeDisabled();
  expect(screen.getByText("勝ち抜け 2名")).toBeTruthy();
});
