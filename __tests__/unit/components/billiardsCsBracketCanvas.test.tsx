/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
import CsBracketCanvas from "@/components/admin/mahjongCs/CsBracketCanvas";
import { BILLIARDS_CS_RULES, DARTS_CS_RULES, MAHJONG_CS_RULES, POKER_CS_RULES, type GameCsRules } from "@/lib/gameCsRules";
import type { CanvasDraft } from "@/lib/mahjongCsCanvas";

// 麻雀の mahjongCsBracketCanvas.test.tsx と同じ組み方で、ルール表だけビリヤードを渡す。
function setup(draft: CanvasDraft, rules: GameCsRules = BILLIARDS_CS_RULES) {
  const onChange = jest.fn();
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, toJSON() {},
  });
  const result = render(<CsBracketCanvas draft={draft} entrantsById={new Map()} editable onChange={onChange} rules={rules} />);
  return { ...result, onChange };
}
const card = (container: HTMLElement, id: string) => container.querySelector(`[data-table="${id}"]`) as HTMLElement;
const pointer = (target: Element | Window, type: string, clientX: number, clientY: number) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(target, event);
};
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
afterEach(() => {
  jest.restoreAllMocks();
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
  else Reflect.deleteProperty(document, "elementFromPoint");
});

/** 準決勝2卓 → 決勝。t は3位決定戦にする卓 */
const draft = (loser = false): CanvasDraft => ({ seedUserIds: [], tables: [
  { id: "s1", x: 20, y: 500, advanceCount: 1, to: "f", ...(loser ? { loserTo: "t" } : {}), playerIds: ["a", "b"] },
  { id: "s2", x: 240, y: 500, advanceCount: 1, to: "f", ...(loser ? { loserTo: "t" } : {}), playerIds: ["c", "d"] },
  { id: "f", x: 20, y: 20, advanceCount: 1, to: null, playerIds: [] },
  { id: "t", x: 460, y: 20, advanceCount: 1, to: null, playerIds: [] },
] });

test.each([["麻雀", MAHJONG_CS_RULES], ["ポーカー", POKER_CS_RULES], ["ダーツ", DARTS_CS_RULES]])(
  "%s のキャンバスには敗者の矢印を引くボタンが無い", (_name, rules) => {
    setup({ seedUserIds: [], tables: [{ id: "f", x: 20, y: 20, advanceCount: 1, to: null, playerIds: [] }] }, rules);
    expect(screen.getAllByRole("button", { name: /から矢印を引く/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /敗者の矢印/ })).toBeNull();
  });

test("ビリヤードは卓ごとに敗者の矢印を引くボタンがあり、ドラッグで敗者の行き先を付けられる", () => {
  const { container, onChange } = setup(draft());
  expect(screen.getAllByRole("button", { name: /から敗者の矢印を引く/ })).toHaveLength(4);
  const target = card(container, "t");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
  pointer(within(card(container, "s1")).getByRole("button", { name: /から敗者の矢印を引く/ }), "pointerdown", 150, 500);
  pointer(window, "pointermove", 500, 200);
  pointer(window, "pointerup", 500, 200);
  expect(onChange).toHaveBeenCalledTimes(1);
  const next = onChange.mock.calls[0][0] as CanvasDraft;
  expect(next.tables[0]).toMatchObject({ id: "s1", to: "f", loserTo: "t" });
});

test("敗者の矢印は点線で出て、3位決定戦の卓に「敗者」の席が並ぶ", () => {
  const { container } = setup(draft(true));
  const hit = screen.getByRole("button", { name: "準決勝A卓→3位決定戦の敗者の矢印" });
  const line = hit.previousElementSibling as SVGPathElement;
  expect(line.getAttribute("stroke-dasharray")).toBeTruthy();
  const third = card(container, "t");
  expect(within(third).getByText("準決勝A卓 敗者")).toBeInTheDocument();
  expect(within(third).getByText("準決勝B卓 敗者")).toBeInTheDocument();
  expect(within(third).getByLabelText("入ってくる人数")).toHaveTextContent("2");
  expect(within(card(container, "f")).getByText("準決勝A卓 勝者")).toBeInTheDocument();
});

test("敗者の矢印を選んで消すと、敗者の行き先だけが外れる（勝者の矢印は残る）", () => {
  const { container, onChange } = setup(draft(true));
  fireEvent.click(screen.getByRole("button", { name: "準決勝A卓→3位決定戦の敗者の矢印" }));
  fireEvent.click(within(card(container, "s1")).getByRole("button", { name: "矢印を消す" }));
  const next = onChange.mock.calls[0][0] as CanvasDraft;
  expect(next.tables[0].to).toBe("f");
  expect("loserTo" in next.tables[0]).toBe(false);
  expect(next.tables[1].loserTo).toBe("t");
});

test("勝者の矢印を選んで消しても、敗者の矢印は残る", () => {
  const { container, onChange } = setup(draft(true));
  fireEvent.click(screen.getByRole("button", { name: "準決勝A卓→決勝卓の矢印" }));
  fireEvent.click(within(card(container, "s1")).getByRole("button", { name: "矢印を消す" }));
  const next = onChange.mock.calls[0][0] as CanvasDraft;
  expect(next.tables[0]).toMatchObject({ to: null, loserTo: "t" });
});
