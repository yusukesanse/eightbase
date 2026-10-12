/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import CsBracketCanvas, { arrowPath } from "@/components/admin/mahjongCs/CsBracketCanvas";
import type { CanvasDraft } from "@/lib/mahjongCsCanvas";

function draft(): CanvasDraft {
  return { seedUserIds: [], tables: [
    { id: "a", x: 20, y: 300, advanceCount: 1, to: "b", playerIds: ["p1"] },
    { id: "b", x: 240, y: 20, advanceCount: 2, to: null, playerIds: [] },
  ] };
}
function pointer(target: Element | Window, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
}
function setup(value = draft(), editable = true) {
  const onChange = jest.fn();
  const props = { draft: value, entrantsById: new Map(), editable, onChange };
  const result = render(<CsBracketCanvas {...props} />);
  const frame = screen.getByRole("region", { name: "組み合わせキャンバス" });
  jest.spyOn(frame, "getBoundingClientRect").mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, toJSON() {},
  });
  return { ...result, onChange, frame, props };
}
function hit(element: Element | null) {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
}
afterEach(() => jest.restoreAllMocks());

test("arrow geometry joins top-center to bottom-center, including negative coordinates", () => {
  const numbers = arrowPath({ x: 20, y: 300 }, { x: 240, y: 20 }).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(numbers.slice(0, 2)).toEqual([120, 300]);
  expect(numbers.slice(-2)).toEqual([340, 180]);
  const negative = arrowPath({ x: -200, y: -80 }, { x: -50, y: -300 }).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(negative.slice(0, 2)).toEqual([-100, -80]);
  expect(negative.slice(-2)).toEqual([50, -140]);
});

test("adds a table centered in the visible area with a short id and one advance", () => {
  const { onChange } = setup();
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  const next = onChange.mock.calls[0][0] as CanvasDraft;
  expect(next.tables).toHaveLength(3);
  expect(next.tables[2]).toEqual({ id: expect.stringMatching(/^t_.{8}$/), x: 300, y: 220, advanceCount: 1, to: null, playerIds: [] });
});

test("dragging a connector onto a child of another card connects the tables", () => {
  const value = draft(); value.tables[0].to = null;
  const { container, onChange } = setup(value);
  hit(container.querySelector('[data-table="b"] h3'));
  pointer(screen.getAllByRole("button", { name: "卓から矢印を引く" })[0], "pointerdown", 120, 300);
  pointer(window, "pointermove", 340, 100);
  pointer(window, "pointerup", 340, 100);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].tables[0].to).toBe("b");
});

test("redrawing a connector replaces its previous destination", () => {
  const value = draft();
  value.tables.push({ id: "c", x: 500, y: 300, advanceCount: 1, to: "b", playerIds: [] });
  const { container, onChange } = setup(value);
  hit(container.querySelector('[data-table="c"]'));
  pointer(screen.getByRole("button", { name: "準決勝A卓から矢印を引く" }), "pointerdown", 120, 300);
  pointer(window, "pointermove", 600, 350);
  pointer(window, "pointerup", 600, 350);
  expect(onChange.mock.calls[0][0].tables.map((t: { to: string | null }) => t.to)).toEqual(["c", null, "b"]);
});

test.each(["Delete", "Backspace", "×"])("selected arrow can be disconnected using %s", (key) => {
  const { onChange, frame } = setup();
  fireEvent.click(screen.getByRole("button", { name: "準決勝卓→決勝卓の矢印" }));
  if (key === "×") fireEvent.click(screen.getByRole("button", { name: "矢印を消す" }));
  else fireEvent.keyDown(frame, { key });
  expect(onChange.mock.calls[0][0].tables[0].to).toBeNull();
});

test("header drag previews through rAF and commits its full delta once on release", () => {
  let tick: FrameRequestCallback = () => {};
  jest.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { tick = cb; return 1; });
  jest.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const { onChange, container } = setup();
  pointer(screen.getByLabelText("準決勝卓を移動"), "pointerdown", 100, 300);
  pointer(window, "pointermove", 140, 330);
  act(() => tick(0));
  expect((container.querySelector('[data-table="a"]') as HTMLElement).style.transform).toBe("translate(60px, 330px)");
  expect(onChange).not.toHaveBeenCalled();
  pointer(window, "pointerup", 150, 340);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].tables[0]).toMatchObject({ x: 70, y: 340 });
});

test("cancellation, a short press and dropping a connector outside cards preserve the draft", () => {
  const { onChange } = setup();
  const header = screen.getByLabelText("準決勝卓を移動");
  pointer(header, "pointerdown", 100, 300);
  pointer(window, "pointermove", 103, 303);
  pointer(window, "pointerup", 103, 303);
  pointer(header, "pointerdown", 100, 300);
  pointer(window, "pointermove", 150, 350);
  pointer(window, "pointercancel", 150, 350);
  pointer(window, "pointerup", 150, 350);
  hit(null);
  pointer(screen.getByRole("button", { name: "準決勝卓から矢印を引く" }), "pointerdown", 120, 300);
  pointer(window, "pointermove", 400, 400);
  pointer(window, "pointerup", 400, 400);
  expect(onChange).not.toHaveBeenCalled();
});

test("zoom stays anchored at the cursor and table drag divides delta by zoom", () => {
  const { frame, onChange } = setup();
  fireEvent.wheel(frame, { clientX: 410, clientY: 320, deltaY: -10000 });
  pointer(screen.getByLabelText("準決勝卓を移動"), "pointerdown", 100, 300);
  pointer(window, "pointermove", 132, 316);
  pointer(window, "pointerup", 132, 316);
  expect(onChange.mock.calls[0][0].tables[0]).toMatchObject({ x: 40, y: 310 });
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  expect(onChange.mock.calls[1][0].tables[2]).toMatchObject({ x: 300, y: 220 });
});

test("read-only canvas hides editing controls but still pans and zooms", () => {
  const { frame, onChange, container } = setup(draft(), false);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByLabelText("準決勝卓を移動")).toBeNull();
  fireEvent.wheel(frame, { clientX: 10, clientY: 20, deltaY: 10000 });
  const layer = container.querySelector('[data-table="a"]')!.parentElement!;
  expect(layer.style.transform).toBe("translate(0px, 0px) scale(0.4)");
  pointer(frame, "pointerdown", 10, 20);
  pointer(window, "pointermove", 13, 23);
  pointer(window, "pointerup", 13, 23);
  expect(layer.style.transform).toBe("translate(0px, 0px) scale(0.4)");
  pointer(frame, "pointerdown", 10, 20);
  pointer(window, "pointermove", 50, 80);
  pointer(window, "pointerup", 50, 80);
  expect(layer.style.transform).toBe("translate(40px, 60px) scale(0.4)");
  expect(onChange).not.toHaveBeenCalled();
});

test("cards display incoming, direct and open seats and edit advance counts or remove tables", () => {
  const { container, onChange } = setup();
  const final = container.querySelector('[data-table="b"]') as HTMLElement;
  expect(within(final).getByText("表彰 2名")).toBeTruthy();
  expect(within(final).getByLabelText("入ってくる人数").textContent).toBe("1");
  expect(within(final).getByLabelText("直接").textContent).toBe("0");
  expect(within(final).getByLabelText("空席").textContent).toBe("3");
  fireEvent.click(within(final).getByRole("button", { name: "勝ち抜けを増やす" }));
  expect(onChange.mock.calls[0][0].tables[1].advanceCount).toBe(3);
  fireEvent.click(within(final).getByRole("button", { name: "勝ち抜けを減らす" }));
  expect(onChange.mock.calls[1][0].tables[1].advanceCount).toBe(1);
  fireEvent.click(within(final).getByRole("button", { name: "決勝卓を削除" }));
  expect(onChange.mock.calls[2][0].tables).toHaveLength(1);
  expect(onChange.mock.calls[2][0].tables[0].to).toBeNull();
});

test("fit all places the complete table bounds inside the visible frame", () => {
  const value = draft(); value.tables[0].x = -400; value.tables[0].y = 800;
  const { container } = setup(value);
  fireEvent.click(screen.getByRole("button", { name: "全体を表示" }));
  const layer = container.querySelector('[data-table="a"]')!.parentElement!;
  const [px, py, z] = layer.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  for (const table of value.tables) {
    expect(px + table.x * z).toBeGreaterThanOrEqual(0);
    expect(py + table.y * z).toBeGreaterThanOrEqual(0);
    expect(px + (table.x + 200) * z).toBeLessThanOrEqual(800);
    expect(py + (table.y + 160) * z).toBeLessThanOrEqual(600);
  }
});
