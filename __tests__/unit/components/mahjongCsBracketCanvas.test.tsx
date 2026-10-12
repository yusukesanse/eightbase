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
function pointer(target: Element | Window, type: string, x: number, y: number, pointerId = 1, buttons = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  fireEvent(target, event);
}
function setup(value = draft(), editable = true) {
  const onChange = jest.fn();
  const props = { draft: value, entrantsById: new Map(), editable, onChange };
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 10, y: 20, left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, toJSON() {},
  });
  const result = render(<CsBracketCanvas {...props} />);
  const frame = screen.getByRole("region", { name: "組み合わせキャンバス" });
  return { ...result, onChange, frame, props };
}
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
function hit(element: Element | null) {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => element });
}
afterEach(() => {
  jest.restoreAllMocks();
  if (originalElementFromPoint) Object.defineProperty(document, "elementFromPoint", originalElementFromPoint);
  else Reflect.deleteProperty(document, "elementFromPoint");
});
function viewport(container: HTMLElement) {
  const layer = container.querySelector("[data-table]")!.parentElement!;
  const [x, y, z] = layer.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  return { layer, x, y, z };
}

test("arrow geometry joins top-center to bottom-center, including negative coordinates", () => {
  const numbers = arrowPath({ x: 20, y: 300 }, { x: 240, y: 20 }).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(numbers.slice(0, 2)).toEqual([120, 300]);
  expect(numbers.slice(-2)).toEqual([340, 440]);
  const negative = arrowPath({ x: -200, y: -80 }, { x: -50, y: -300 }).match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(negative.slice(0, 2)).toEqual([-100, -80]);
  expect(negative.slice(-2)).toEqual([50, 120]);
});

test("adds a table centered in the visible area with a short id and one advance", () => {
  const { onChange } = setup({ seedUserIds: [], tables: [] });
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  const next = onChange.mock.calls[0][0] as CanvasDraft;
  expect(next.tables).toHaveLength(1);
  expect(next.tables[0]).toEqual({ id: expect.stringMatching(/^t_.{8}$/), x: 300, y: 90, advanceCount: 1, to: null, playerIds: [] });
});

test("dragging a connector onto a child of another card connects the tables", () => {
  const value = draft(); value.tables[0].to = null;
  const { container, onChange } = setup(value);
  hit(container.querySelector('[data-table="b"] h3'));
  pointer(screen.getByRole("button", { name: "卓Aから矢印を引く" }), "pointerdown", 120, 300);
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
  const { z } = viewport(container);
  pointer(screen.getByLabelText("準決勝卓を移動"), "pointerdown", 100, 300);
  pointer(window, "pointermove", 100 + 40 * z, 300 + 30 * z);
  act(() => tick(0));
  const preview = (container.querySelector('[data-table="a"]') as HTMLElement).style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(preview[0]).toBeCloseTo(60);
  expect(preview[1]).toBeCloseTo(330);
  const hitPath = screen.getByRole("button", { name: "準決勝卓→決勝卓の矢印" });
  const paths = hitPath.parentElement!.querySelectorAll("path");
  expect(paths).toHaveLength(2);
  for (const path of paths) expect(path.getAttribute("d")).toBe(arrowPath({ x: preview[0], y: preview[1] }, draft().tables[1]));
  expect(onChange).not.toHaveBeenCalled();
  pointer(window, "pointerup", 100 + 50 * z, 300 + 40 * z);
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].tables[0].x).toBeCloseTo(70);
  expect(onChange.mock.calls[0][0].tables[0].y).toBeCloseTo(340);
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
  const { frame, onChange, container } = setup();
  const old = viewport(container);
  const cursor = { x: 173, y: 91 };
  fireEvent.wheel(frame, { clientX: cursor.x + 10, clientY: cursor.y + 20, deltaY: -10000 });
  const next = viewport(container);
  expect(next.z).toBe(1.6);
  expect((cursor.x - next.x) / next.z).toBeCloseTo((cursor.x - old.x) / old.z);
  expect((cursor.y - next.y) / next.z).toBeCloseTo((cursor.y - old.y) / old.z);
  pointer(screen.getByLabelText("準決勝卓を移動"), "pointerdown", 100, 300);
  pointer(window, "pointermove", 132, 316);
  pointer(window, "pointerup", 132, 316);
  expect(onChange.mock.calls[0][0].tables[0]).toMatchObject({ x: 40, y: 310 });
});

test("read-only canvas hides editing controls but still pans and zooms", () => {
  const { frame, onChange, container } = setup(draft(), false);
  expect(screen.queryByRole("button", { name: "卓を追加" })).toBeNull();
  expect(screen.queryByRole("button", { name: /から矢印を引く/ })).toBeNull();
  for (const name of ["全体を表示", "拡大", "縮小"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  expect(screen.queryByLabelText("準決勝卓を移動")).toBeNull();
  const old = viewport(container);
  fireEvent.wheel(frame, { clientX: 10, clientY: 20, deltaY: 10000 });
  const expected = `translate(${old.x * 0.2 / old.z}px, ${old.y * 0.2 / old.z}px) scale(0.2)`;
  const layer = container.querySelector('[data-table="a"]')!.parentElement!;
  expect(layer.style.transform).toBe(expected);
  pointer(frame, "pointerdown", 10, 20);
  pointer(window, "pointermove", 13, 23);
  pointer(window, "pointerup", 13, 23);
  expect(layer.style.transform).toBe(expected);
  pointer(container.querySelector("[data-table] h3")!, "pointerdown", 10, 20);
  pointer(window, "pointermove", 50, 80);
  pointer(window, "pointerup", 50, 80);
  expect(viewport(container).x).toBeCloseTo(old.x * 0.2 / old.z + 40);
  expect(viewport(container).y).toBeCloseTo(old.y * 0.2 / old.z + 60);
  expect(viewport(container).z).toBe(0.2);
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
  fireEvent.click(screen.getByRole("button", { name: "削除する" }));
  expect(onChange.mock.calls[2][0].tables).toHaveLength(1);
  expect(onChange.mock.calls[2][0].tables[0].to).toBeNull();
});

test("fit all places the complete table bounds inside the visible frame", () => {
  const value = draft(); value.tables[0].x = -400; value.tables[0].y = 1600;
  const { container } = setup(value);
  const layer = container.querySelector('[data-table="a"]')!.parentElement!;
  const [px, py, z] = layer.style.transform.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  for (const table of value.tables) {
    expect(px + table.x * z).toBeGreaterThanOrEqual(0);
    expect(py + table.y * z).toBeGreaterThanOrEqual(0);
    expect(px + (table.x + 200) * z).toBeLessThanOrEqual(800);
    expect(py + (table.y + 420) * z).toBeLessThanOrEqual(600);
  }
});


test("repeated additions have distinct names and stagger positions without refitting", () => {
  const { onChange, rerender, props, container } = setup({ seedUserIds: [], tables: [] });
  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
    const next = onChange.mock.calls[i][0] as CanvasDraft;
    expect(next.tables[i]).toMatchObject({ x: 300 + 24 * i, y: 90 + 24 * i });
    rerender(<CsBracketCanvas {...props} draft={next} />);
    if (i > 0) expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(i === 1 ? ["卓A", "卓B"] : ["卓A", "卓B", "卓C"]);
    expect(viewport(container).z).toBe(1);
  }
});

test.each([true, false])("zoom buttons and fit work with editable=%s", (editable) => {
  const { container } = setup(draft(), editable);
  const before = viewport(container);
  fireEvent.click(screen.getByRole("button", { name: "縮小" }));
  expect(viewport(container).z).toBeLessThan(before.z);
  fireEvent.click(screen.getByRole("button", { name: "拡大" }));
  expect(viewport(container).z).toBeCloseTo(before.z);
  fireEvent.click(screen.getByRole("button", { name: "縮小" }));
  fireEvent.click(screen.getByRole("button", { name: "全体を表示" }));
  expect(viewport(container)).toMatchObject({ x: before.x, y: before.y, z: before.z });
});

test("arrow hit path is wide and disabled throughout a connect gesture", () => {
  const { onChange } = setup();
  const path = screen.getByRole("button", { name: /の矢印$/ });
  expect(path.getAttribute("stroke-width")).toBe("16");
  expect(path.getAttribute("stroke")).toBe("transparent");
  expect((path.previousElementSibling as SVGElement).style.pointerEvents).toBe("none");
  pointer(screen.getByRole("button", { name: "準決勝卓から矢印を引く" }), "pointerdown", 100, 300);
  expect(getComputedStyle(path).pointerEvents).toBe("none");
  pointer(window, "pointermove", 180, 380, 1, 0);
  expect(getComputedStyle(path).pointerEvents).toBe("stroke");
  pointer(window, "pointerup", 180, 380);
  expect(onChange).not.toHaveBeenCalled();
});

test("lost mouse release cancels a card drag", () => {
  const { onChange, container } = setup();
  const card = container.querySelector("[data-table]") as HTMLElement;
  pointer(screen.getByLabelText("準決勝卓を移動"), "pointerdown", 100, 300);
  pointer(window, "pointermove", 150, 350);
  pointer(window, "pointermove", 180, 380, 1, 0);
  pointer(window, "pointerup", 180, 380);
  expect(onChange).not.toHaveBeenCalled();
  expect(card.style.transform).toBe("translate(20px, 300px)");
});

test.each(["removed", "disconnected"])("deleting a stale %s arrow clears selection without changing the draft", (kind) => {
  const { onChange, frame, props, rerender } = setup();
  fireEvent.click(screen.getByRole("button", { name: /の矢印$/ }));
  const next = draft();
  if (kind === "removed") next.tables.shift();
  else next.tables[0].to = null;
  rerender(<CsBracketCanvas {...props} draft={next} />);
  fireEvent.keyDown(frame, { key: "Delete" });
  expect(onChange).not.toHaveBeenCalled();
  rerender(<CsBracketCanvas {...props} />);
  expect(screen.queryByRole("button", { name: "矢印を消す" })).toBeNull();
});

test("fit caps zoom at one and ignores zero-sized frames", () => {
  const { container } = setup({ seedUserIds: [], tables: [draft().tables[0]] });
  expect(viewport(container).z).toBe(1);
  const before = viewport(container);
  jest.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 0, height: 0 } as DOMRect);
  fireEvent.click(screen.getByRole("button", { name: "全体を表示" }));
  expect(viewport(container)).toEqual(before);
});
test("arrow hit width does not scale with zoom", () => {
  setup();
  expect(screen.getByRole("button", { name: /の矢印$/ }).getAttribute("vector-effect")).toBe("non-scaling-stroke");
});
test("overflow shows all tickets in source order and an error", () => {
  const value = draft();
  value.tables[0].advanceCount = 3;
  value.tables.push({ ...value.tables[0], id: "c", x: -100, advanceCount: 2, playerIds: [] });
  const { container } = setup(value);
  const final = container.querySelector('[data-table="b"]')!;
  expect(within(final as HTMLElement).getByText("席が足りません")).toBeTruthy();
  const rows = [...final.querySelectorAll('[data-seat-row]')].map(row => row.textContent);
  expect(rows).toEqual(["準決勝A卓 1位", "準決勝A卓 2位", "準決勝B卓 1位", "準決勝B卓 2位", "準決勝B卓 3位"]);
});
test("read-only buttons never initiate pan", () => {
  const { container, frame } = setup(draft(), false);
  const button = document.createElement("button"); frame.appendChild(button);
  const before = viewport(container);
  pointer(button, "pointerdown", 100, 100);
  pointer(window, "pointermove", 200, 200);
  pointer(window, "pointerup", 200, 200);
  expect(viewport(container)).toEqual(before);
});


test("overflowing cards clip content while keeping the error and arrow removal available", () => {
  const value = draft();
  value.tables[0].playerIds = ["p1", "p2", "p3", "p4", "p5"];
  const { container, onChange } = setup(value);
  const card = container.querySelector('[data-table="a"]') as HTMLElement;
  expect(within(card).getByText("席が足りません")).toBeTruthy();
  expect(getComputedStyle(card).overflow).toBe("hidden");
  fireEvent.click(screen.getByRole("button", { name: /の矢印$/ }));
  fireEvent.click(within(card).getByRole("button", { name: "矢印を消す" }));
  expect(onChange.mock.calls[0][0].tables[0].to).toBeNull();
});

test("removed table clears its pending deletion confirmation", () => {
  const { props, rerender } = setup();
  fireEvent.click(screen.getByRole("button", { name: "準決勝卓を削除" }));
  expect(screen.getByRole("alert")).toBeTruthy();
  rerender(<CsBracketCanvas {...props} draft={{ ...props.draft, tables: [props.draft.tables[1]] }} />);
  expect(screen.queryByRole("alert")).toBeNull();
});
test.each(["source", "destination", "edge"])("removed %s clears arrow selection even if restored later", removed => {
  const { props, rerender } = setup();
  fireEvent.click(screen.getByRole("button", { name: "準決勝卓→決勝卓の矢印" }));
  expect(screen.getByRole("button", { name: "矢印を消す" })).toBeTruthy();
  const tables = removed === "edge" ? props.draft.tables.map(t => ({ ...t, to: null }))
    : props.draft.tables.filter(t => t.id !== (removed === "source" ? "a" : "b"));
  rerender(<CsBracketCanvas {...props} draft={{ ...props.draft, tables }} />);
  expect(screen.queryByRole("button", { name: "矢印を消す" })).toBeNull();
  rerender(<CsBracketCanvas {...props} />);
  expect(screen.queryByRole("button", { name: "矢印を消す" })).toBeNull();
});


test.each([true, false])("ピンチは約10%%拡大しカーソル下の点を固定する editable=%s", editable => {
  const { container, frame, onChange } = setup(draft(), editable);
  const before = viewport(container);
  fireEvent.wheel(frame, { ctrlKey: true, deltaY: -10, clientX: 210, clientY: 170 });
  const after = viewport(container);
  expect(after.z / before.z).toBeCloseTo(1.105170, 5);
  expect((200 - after.x) / after.z).toBeCloseTo((200 - before.x) / before.z);
  expect((150 - after.y) / after.z).toBeCloseTo((150 - before.y) / before.z);
  expect(onChange).not.toHaveBeenCalled();
});
test.each([true, false])("2本指スクロールは画面ピクセルでパンする editable=%s", editable => {
  const { container, frame, onChange } = setup(draft(), editable);
  const before = viewport(container);
  fireEvent.wheel(frame, { deltaX: 12, deltaY: -8.5 });
  expect(viewport(container)).toMatchObject({ x: before.x - 12, y: before.y + 8.5, z: before.z });
  expect(onChange).not.toHaveBeenCalled();
});
test.each([0, 1, 2])("マウスホイールはdeltaMode=%sを補正して従来倍率でズーム", deltaMode => {
  const { container, frame } = setup();
  const before = viewport(container);
  fireEvent.wheel(frame, { deltaMode, deltaY: deltaMode === 0 ? 100 : 1 });
  expect(viewport(container).z / before.z).toBeCloseTo(deltaMode === 0 ? 0.904837 : deltaMode === 1 ? 0.984127 : 0.548812, 5);
});
test("ドラッグ中はピンチとスクロールを無視する", () => {
  const { container, frame } = setup();
  const before = viewport(container);
  pointer(screen.getByLabelText("準決勝卓を移動"), "pointerdown", 100, 300);
  fireEvent.wheel(frame, { ctrlKey: true, deltaY: -10 });
  fireEvent.wheel(frame, { deltaX: 12, deltaY: 3 });
  expect(viewport(container)).toEqual(before);
  pointer(window, "pointercancel", 100, 300);
});
test.each(["Enter", "blur"])("卓名をダブルクリックして%sで確定する", finish => {
  const { onChange, rerender, props } = setup();
  fireEvent.doubleClick(screen.getByLabelText("準決勝卓を移動"));
  const input = screen.getByRole("textbox", { name: "卓名を編集" });
  expect((input as HTMLInputElement).value).toBe("");
  expect(input.getAttribute("placeholder")).toBe("準決勝卓");
  expect(input.getAttribute("maxlength")).toBe("20");
  fireEvent.change(input, { target: { value: " 東風卓 " } });
  if (finish === "blur") fireEvent.blur(input);
  else fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].tables[0].name).toBe("東風卓");
  rerender(<CsBracketCanvas {...props} draft={onChange.mock.calls[0][0]} />);
  expect(screen.getByText("東風卓 1位")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});
test("卓名編集のEscは取消し、入力上のpointerdownは移動を始めない", () => {
  const { container, onChange } = setup();
  fireEvent.doubleClick(screen.getByLabelText("準決勝卓を移動"));
  const input = screen.getByRole("textbox", { name: "卓名を編集" });
  const before = viewport(container);
  pointer(input, "pointerdown", 100, 300);
  pointer(window, "pointermove", 200, 400);
  pointer(window, "pointerup", 200, 400);
  fireEvent.change(input, { target: { value: "取消す卓" } });
  fireEvent.keyDown(input, { key: "Escape" });
  fireEvent.blur(input);
  expect(onChange).not.toHaveBeenCalled();
  expect(viewport(container)).toEqual(before);
  expect(screen.queryByRole("textbox")).toBeNull();
});
test("空で確定すると自動名に戻る", () => {
  const value = draft();
  value.tables[0] = { ...value.tables[0], ...{ name: "東風卓" } };
  const { onChange } = setup(value);
  fireEvent.doubleClick(screen.getByLabelText("東風卓を移動"));
  const input = screen.getByRole("textbox", { name: "卓名を編集" });
  expect((input as HTMLInputElement).value).toBe("東風卓");
  fireEvent.change(input, { target: { value: " " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange.mock.calls[0][0].tables[0]).not.toHaveProperty("name");
});
test("閲覧専用では卓名を編集できない", () => {
  const { onChange } = setup(draft(), false);
  fireEvent.doubleClick(screen.getByRole("heading", { name: "準決勝卓" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});


test.each(["Enter", "blur"])("未入力の自動名は%sでも保存しない", finish => {
  const value = draft();
  const { onChange } = setup(value);
  fireEvent.doubleClick(screen.getByLabelText("準決勝卓を移動"));
  const input = screen.getByRole("textbox");
  if (finish === "blur") fireEvent.blur(input);
  else fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).not.toHaveBeenCalled();
  expect(value.tables[0]).not.toHaveProperty("name");
  expect(screen.queryByRole("textbox")).toBeNull();
});
test.each(["東風卓", " 東風卓 "])("trim後に同じ卓名なら保存しない: %s", value => {
  const current = draft(); current.tables[0].name = "東風卓";
  const { onChange } = setup(current);
  fireEvent.doubleClick(screen.getByLabelText("東風卓を移動"));
  const input = screen.getByRole("textbox");
  expect(input.getAttribute("placeholder")).toBe("準決勝卓");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).not.toHaveBeenCalled();
});
test("編集入力はスクロールせずフォーカスし文字選択できる", () => {
  setup();
  const focus = jest.spyOn(HTMLElement.prototype, "focus");
  fireEvent.doubleClick(screen.getByLabelText("準決勝卓を移動"));
  const input = screen.getByRole("textbox");
  expect(document.activeElement).toBe(input);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(input.classList.contains("select-text")).toBe(true);
  expect(input.closest("h3")!.classList.contains("select-none")).toBe(false);
  expect(input.closest("h3")!.hasAttribute("aria-label")).toBe(false);
});
test("閲覧専用への切替で編集を破棄し編集可能に戻しても復活しない", () => {
  const { props, rerender, onChange } = setup();
  fireEvent.doubleClick(screen.getByLabelText("準決勝卓を移動"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "未保存" } });
  rerender(<CsBracketCanvas {...props} editable={false} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  rerender(<CsBracketCanvas {...props} />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
});
test.each([100, -100])("Ctrl+マウスホイール%sの倍率は従来の係数", deltaY => {
  const { container, frame } = setup();
  const before = viewport(container);
  fireEvent.wheel(frame, { ctrlKey: true, deltaY });
  expect(viewport(container).z / before.z).toBeCloseTo(deltaY > 0 ? 0.904837 : 1.105170, 5);
});
test.each([40.5, -40.5])("ピンチdelta%sは±25に制限", deltaY => {
  const { container, frame } = setup();
  const before = viewport(container);
  fireEvent.wheel(frame, { ctrlKey: true, deltaY });
  expect(viewport(container).z / before.z).toBeCloseTo(deltaY > 0 ? 0.778801 : 1.284025, 5);
});
test("フリック中は最後のパンから150ms以内の整数deltaをパンとして継続", () => {
  const now = jest.spyOn(performance, "now").mockReturnValue(1000);
  const { container, frame } = setup();
  fireEvent.wheel(frame, { deltaX: 1, deltaY: 4 });
  const before = viewport(container);
  now.mockReturnValue(1150);
  fireEvent.wheel(frame, { deltaY: 100 });
  expect(viewport(container)).toMatchObject({ x: before.x, y: before.y - 100, z: before.z });
  now.mockReturnValue(1290);
  fireEvent.wheel(frame, { deltaY: 100 });
  expect(viewport(container).y).toBe(before.y - 200);
  now.mockReturnValue(1441);
  fireEvent.wheel(frame, { deltaY: 100 });
  expect(viewport(container).z / before.z).toBeCloseTo(0.904837, 5);
});
test.each(["ctrlKey", "metaKey"])("パン直後でも%sはズームする", modifier => {
  jest.spyOn(performance, "now").mockReturnValue(0);
  const { container, frame } = setup();
  fireEvent.wheel(frame, { deltaY: 4 });
  const before = viewport(container);
  fireEvent.wheel(frame, { [modifier]: true, deltaY: -10 });
  expect(viewport(container).z / before.z).toBeCloseTo(1.105170, 5);
});
test("ページ単位パンは横にframe幅、縦にframe高さを使う", () => {
  jest.spyOn(performance, "now").mockReturnValue(1000);
  const { container, frame } = setup();
  fireEvent.wheel(frame, { deltaY: 4 });
  const before = viewport(container);
  fireEvent.wheel(frame, { deltaMode: 2, deltaX: 1, deltaY: 1 });
  expect(viewport(container)).toMatchObject({ x: before.x - 800, y: before.y - 600, z: before.z });
});
function safariGesture(frame: HTMLElement, type: string, scale: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { scale, clientX: 210, clientY: 170 });
  fireEvent(frame, event);
  return event;
}
test.each([true, false])("Safariピンチ中のwheelは無視しgestureend後に約10%%ズームする editable=%s", editable => {
  const { container, frame } = setup(draft(), editable);
  const before = viewport(container);
  const transform = before.layer.style.transform;
  const wheel = { ctrlKey: true, deltaY: -10, clientX: 210, clientY: 170 };
  safariGesture(frame, "gesturestart", 1);
  fireEvent.wheel(frame, wheel);
  expect(before.layer.style.transform).toBe(transform);
  safariGesture(frame, "gestureend", 1);
  fireEvent.wheel(frame, wheel);
  expect(viewport(container).z / before.z).toBeCloseTo(1.105170, 5);
});
test.each([true, false])("Safariピンチがwindow blurで中断してもwheelでズームする editable=%s", editable => {
  const { container, frame } = setup(draft(), editable);
  const before = viewport(container);
  safariGesture(frame, "gesturestart", 1);
  fireEvent(window, new Event("blur"));
  fireEvent.wheel(frame, { ctrlKey: true, deltaY: -10, clientX: 210, clientY: 170 });
  expect(viewport(container).z / before.z).toBeCloseTo(1.105170, 5);
});
test.each([true, false])("Safariピンチは開始倍率からカーソル基準でズーム editable=%s", editable => {
  const { container, frame, onChange, unmount } = setup(draft(), editable);
  const before = viewport(container);
  expect(safariGesture(frame, "gesturestart", 1).defaultPrevented).toBe(true);
  expect(safariGesture(frame, "gesturechange", 1.1).defaultPrevented).toBe(true);
  safariGesture(frame, "gesturechange", 1.2);
  const after = viewport(container);
  expect(after.z / before.z).toBeCloseTo(1.2);
  expect((200 - after.x) / after.z).toBeCloseTo((200 - before.x) / before.z);
  expect((150 - after.y) / after.z).toBeCloseTo((150 - before.y) / before.z);
  expect(safariGesture(frame, "gestureend", 1.2).defaultPrevented).toBe(true);
  safariGesture(frame, "gesturechange", 1.4);
  expect(viewport(container)).toEqual(after);
  safariGesture(frame, "gesturestart", 1);
  safariGesture(frame, "gesturechange", 1.1);
  expect(viewport(container).z / after.z).toBeCloseTo(1.1);
  safariGesture(frame, "gesturechange", 100);
  expect(viewport(container).z).toBe(1.6);
  safariGesture(frame, "gesturechange", 0.01);
  expect(viewport(container).z).toBe(0.2);
  expect(onChange).not.toHaveBeenCalled();
  unmount();
  expect(safariGesture(frame, "gesturestart", 1).defaultPrevented).toBe(false);
  expect(safariGesture(frame, "gesturechange", 1.2).defaultPrevented).toBe(false);
  expect(safariGesture(frame, "gestureend", 1.2).defaultPrevented).toBe(false);
});
