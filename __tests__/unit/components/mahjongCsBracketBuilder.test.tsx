/** @jest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CsBracketBuilder from "@/components/admin/mahjongCs/CsBracketBuilder";
import type { MahjongCsEvent } from "@/types";

const event: MahjongCsEvent = {
  csEventId: "cs", seasonId: "season", name: "CS", eventDate: "2026-10-10", status: "closed",
  entrants: ["p1", "p2", "p3", "p4"].map((id, index) => ({
    lineUserId: id, displayName: `参加者${index + 1}`, tier: index === 0 ? "M1" : "M3",
    rank: index + 1, seed: false,
  })),
  rounds: [], createdAt: "", updatedAt: "",
};
// ネットワーク境界だけ置き換え、編成操作は実コンポーネントで行う。
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ event }) });
  Object.defineProperty(global.crypto, "randomUUID", { configurable: true, value: () => "table" });
});
// jsdom にない PointerEvent の座標と識別子を明示して送る。
function pointer(target: Element | Window, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
}


const table = (id = "F", playerIds: string[] = [], to: string | null = null, x = 0) =>
  ({ id, x, y: 0, advanceCount: 1, to, playerIds });
function setup(tables = [table()], seeds: string[] = []) {
  return render(<CsBracketBuilder event={{ ...event, bracket: { seedUserIds: seeds, rounds: [], canvas: { tables } } }} onChanged={jest.fn()} onError={jest.fn()} />);
}
function card(id = "F") { return document.querySelector(`[data-table="${id}"]`)! as HTMLElement; }
function dragTo(chip: Element, target: Element) {
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => target });
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointermove", 80, 80);
  pointer(window, "pointerup", 80, 80);
}
afterEach(() => { jest.restoreAllMocks(); Reflect.deleteProperty(window, "matchMedia"); });
test.each(["seat", "card"])("drag from pool to %s and back to pool", (target) => {
  setup();
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
  dragTo(screen.getByRole("button", { name: "参加者1 M1" }), target === "seat" ? card().querySelector('[data-zone="seat:F"]')! : card().querySelector("h3")!);
  expect(within(card()).getByText("参加者1")).toBeTruthy();
  expect(screen.getByText("未保存の変更があります")).toBeTruthy();
  dragTo(within(card()).getByRole("button", { name: /参加者1 M1/ }), screen.getByRole("button", { name: "参加者プールに戻す" }));
  expect(within(card()).queryByText("参加者1")).toBeNull();
});
test("incoming tickets occupy seats and prevent overflow placement", () => {
  setup([table("A", [], "F"), table("F", ["p2", "p3", "p4"])]);
  expect(within(card()).getByText("準決勝卓 1位")).toBeTruthy();
  dragTo(screen.getByRole("button", { name: "参加者1 M1" }), card());
  expect(within(card()).queryByText("参加者1")).toBeNull();
});
test("tap placement and remove return the player, seed badges survive", () => {
  setup([table()], ["p1"]);
  fireEvent.click(screen.getByRole("button", { name: /参加者1 M1/ }));
  fireEvent.click(card());
  expect(within(card()).getByText("S")).toBeTruthy();
  fireEvent.click(within(card()).getByRole("button", { name: "参加者1を外す" }));
  expect(within(card()).queryByText("参加者1")).toBeNull();
});
test.each(["saveBracket", "confirmBracket"])("fill and %s send canvas and become clean", async (action) => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "未配置の人を空席に入れる" }));
  expect(within(card()).getByText("参加者4")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: action === "saveBracket" ? "下書き保存" : "この組み合わせで確定" }));
  await waitFor(() => expect(screen.queryByText("未保存の変更があります")).toBeNull());
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body)).toEqual({ action, seedUserIds: [], canvas: { tables: [table("F", ["p1", "p2", "p3", "p4"])] } });
});
test("two finals block confirmation and show conversion errors", () => {
  setup([table("A"), table("F")]);
  expect((screen.getByRole("button", { name: "この組み合わせで確定" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("決勝（矢印が出ていない卓）は1つにしてください（今 2 卓）")).toBeTruthy();
});
test.each([400, 404, 409])("server error %s retains dirty draft and refreshes conflicts", async status => {
  (fetch as jest.Mock).mockResolvedValue({ ok: false, status, json: async () => ({ error: "保存失敗", errors: ["検証エラー"] }) });
  const changed = jest.fn(), error = jest.fn();
  render(<CsBracketBuilder event={event} onChanged={changed} onError={error} />);
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  expect(await screen.findByText("検証エラー")).toBeTruthy();
  expect(error).toHaveBeenLastCalledWith("保存失敗");
  expect(changed).toHaveBeenCalledTimes(status === 400 ? 0 : 1);
  expect(screen.getByText("未保存の変更があります")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "未配置の人を空席に入れる" }));
  expect(screen.queryByText("検証エラー")).toBeNull();
});
test("occupied table deletion needs confirmation and can be cancelled", () => {
  setup([table("F", ["p1"])]);
  fireEvent.click(screen.getByRole("button", { name: "決勝卓を削除" }));
  expect(card()).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
  expect(card()).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "決勝卓を削除" }));
  fireEvent.click(screen.getByRole("button", { name: "削除する" }));
  expect(card()).toBeNull();
});
test("matchMedia changes disable editing and hide pool and edit buttons", () => {
  let change: () => void = () => {};
  const media = { matches: false, addEventListener: jest.fn((_, cb) => { change = cb; }), removeEventListener: jest.fn() };
  Object.defineProperty(window, "matchMedia", { configurable: true, value: jest.fn(() => media) });
  const { unmount } = setup();
  expect(screen.getByText("参加者プール")).toBeTruthy();
  act(() => { media.matches = true; change(); });
  expect(screen.getByText("編集はパソコンでしてください")).toBeTruthy();
  expect(screen.queryByText("参加者プール")).toBeNull();
  expect(screen.queryByRole("button", { name: "卓を追加" })).toBeNull();
  expect(screen.queryByRole("button", { name: "下書き保存" })).toBeNull();
  expect(screen.getByRole("region", { name: "組み合わせキャンバス" })).toBeTruthy();
  unmount(); expect(media.removeEventListener).toHaveBeenCalled();
});
test("switching event resets draft", () => {
  const { rerender } = setup();
  rerender(<CsBracketBuilder event={{ ...event, csEventId: "other" }} onChanged={jest.fn()} onError={jest.fn()} />);
  expect(card()).toBeNull();
});

test("pointer tap selects once and cancellation preserves placement", () => {
  setup();
  const chip = screen.getByRole("button", { name: "参加者1 M1" });
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointermove", 13, 13);
  pointer(window, "pointerup", 13, 13);
  fireEvent.click(chip, { detail: 1 });
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointerup", 10, 10);
  expect(chip.getAttribute("aria-pressed")).toBe("false");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => card() });
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointermove", 80, 80);
  pointer(window, "pointercancel", 80, 80);
  pointer(window, "pointerup", 80, 80);
  expect(within(card()).queryByText("参加者1")).toBeNull();
});
test("tier seeds stay in pool during fill and repeat seed drops do not unseed", () => {
  setup();
  fireEvent.click(screen.getByRole("checkbox", { name: "M1" }));
  const chip = screen.getByRole("button", { name: "参加者1 M1 S" });
  fireEvent.click(chip);
  fireEvent.click(screen.getByRole("button", { name: "ここに落とすとシードに追加" }));
  expect(screen.getByRole("button", { name: "参加者1 M1 S" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "未配置の人を空席に入れる" }));
  expect(within(card()).queryByText("参加者1")).toBeNull();
  expect(within(card()).getByText("参加者2")).toBeTruthy();
});
test("network errors unlock saving and preserve the draft", async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error("offline"));
  const error = jest.fn();
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={error} />);
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  await waitFor(() => expect(error).toHaveBeenLastCalledWith("保存に失敗しました"));
  expect((screen.getByRole("button", { name: "下書き保存" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText("未保存の変更があります")).toBeTruthy();
});

test.each(["header", "card", "connect"])("a moved %s gesture never places the tap-selected player", target => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1" }));
  const start = target === "connect" ? within(card()).getByRole("button", { name: /から矢印を引く/ }) : card().querySelector("h3")!;
  dragTo(start, card());
  fireEvent.click(target === "header" ? start : card());
  expect(within(card()).queryByText("参加者1")).toBeNull();
});
test("header and connect handle clicks keep the selected player in the pool", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1" }));
  fireEvent.click(card().querySelector("h3")!);
  fireEvent.click(within(card()).getByRole("button", { name: /から矢印を引く/ }));
  expect(within(card()).queryByText("参加者1")).toBeNull();
  fireEvent.click(card());
  expect(within(card()).getByText("参加者1")).toBeTruthy();
});
test("seeded card players have only the row removal control and keep their seed on removal", () => {
  setup([table("F", ["p1"])], ["p1"]);
  expect(within(card()).queryByRole("button", { name: "参加者1のシードを解除" })).toBeNull();
  fireEvent.click(within(card()).getByRole("button", { name: "参加者1を外す" }));
  expect(screen.getByRole("button", { name: "参加者1 M1 S" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "参加者1のシードを解除" })).toBeTruthy();
});
test("pool highlights only for a player selected from a seat", () => {
  setup([table("F", ["p2"])], ["p1"]);
  const pool = screen.getByRole("button", { name: "参加者プールに戻す" });
  const idle = pool.style.borderColor;
  fireEvent.click(screen.getByRole("button", { name: "参加者3 M3" }));
  expect(pool.style.borderColor).toBe(idle);
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1 S" }));
  expect(pool.style.borderColor).toBe(idle);
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1 S" }));
  fireEvent.click(within(card()).getByRole("button", { name: "参加者2 M3" }));
  expect(pool.style.borderColor).not.toBe(idle);
});
test("drag moves a player from card to card", () => {
  setup([table("A", ["p1"], "F"), table("F", ["p2"])]);
  dragTo(within(card("A")).getByRole("button", { name: "参加者1 M1" }), card());
  expect(within(card("A")).queryByText("参加者1")).toBeNull();
  expect(within(card()).getByText("参加者1")).toBeTruthy();
  expect(within(card()).getByText("参加者2")).toBeTruthy();
});
test.each(["drag", "tap"])("%s from another card onto a full card preserves the board", method => {
  setup([table("A", ["p1"], "F"), table("F", ["p2", "p3", "p4"])]);
  const before = [card("A").textContent, card().textContent];
  const chip = within(card("A")).getByRole("button", { name: "参加者1 M1" });
  if (method === "drag") dragTo(chip, card());
  else { fireEvent.click(chip); fireEvent.click(card()); }
  expect([card("A").textContent, card().textContent]).toEqual(before);
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
});
test("a valid graph with an unplaced entrant blocks confirmation via bracket validation", () => {
  setup([table("F", ["p1", "p2", "p3"])]);
  expect(screen.getByText(/まだ席がない参加者/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "この組み合わせで確定" }) as HTMLButtonElement).disabled).toBe(true);
});
test("saving keeps canvas controls present while blocking changes", async () => {
  let finish!: (value: unknown) => void;
  (fetch as jest.Mock).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  setup([table("F", ["p1"])]);
  const add = screen.getByRole("button", { name: "卓を追加" });
  const remove = screen.getByRole("button", { name: "参加者1を外す" });
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  expect(screen.queryByRole("button", { name: "卓を追加" })).toBe(add);
  expect(screen.queryByRole("button", { name: "参加者1を外す" })).toBe(remove);
  fireEvent.click(add);
  fireEvent.click(remove);
  expect(document.querySelectorAll("[data-table]")).toHaveLength(1);
  expect(within(card()).getByText("参加者1")).toBeTruthy();
  await act(async () => { finish({ ok: true, json: async () => ({ event }) }); });
});
test("successful save and refreshed bracket preserve pan and zoom", async () => {
  const changed = jest.fn(), error = jest.fn();
  const initial = { ...event, bracket: { seedUserIds: [], rounds: [], canvas: { tables: [table()] } } };
  const { rerender } = render(<CsBracketBuilder event={initial} onChanged={changed} onError={error} />);
  const frame = screen.getByRole("region", { name: "組み合わせキャンバス" });
  pointer(frame, "pointerdown", 10, 10);
  pointer(window, "pointermove", 60, 90);
  pointer(window, "pointerup", 60, 90);
  fireEvent.click(screen.getByRole("button", { name: "拡大" }));
  const transform = card().parentElement!.style.transform;
  expect(transform).not.toBe("translate(0px, 0px) scale(1)");
  fireEvent.click(screen.getByRole("button", { name: "未配置の人を空席に入れる" }));
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  rerender(<CsBracketBuilder event={{ ...initial, bracket: { ...initial.bracket, canvas: { tables: [table("F", ["p1", "p2", "p3", "p4"])] } } }} onChanged={changed} onError={error} />);
  expect(card().parentElement!.style.transform).toBe(transform);
  expect(screen.getByRole("region", { name: "組み合わせキャンバス" })).toBe(frame);
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
});
test("a refreshed server bracket replaces the draft without resetting the viewport", () => {
  const { rerender } = setup();
  fireEvent.click(screen.getByRole("button", { name: "拡大" }));
  const transform = card().parentElement!.style.transform;
  rerender(<CsBracketBuilder event={{ ...event, bracket: { seedUserIds: ["p2"], rounds: [], canvas: { tables: [table("F", ["p2"])] } } }} onChanged={jest.fn()} onError={jest.fn()} />);
  expect(within(card()).getByRole("button", { name: "参加者2 M3 S" })).toBeTruthy();
  expect(card().parentElement!.style.transform).toBe(transform);
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
});

function serverEvent(players: string[], entrants = event.entrants, seeds: string[] = []): MahjongCsEvent {
  return { ...event, entrants, bracket: { seedUserIds: seeds, rounds: [], canvas: { tables: [table("F", players)] } } };
}
test("dirty resync keeps unrelated placement, removes withdrawn entrant and remains unsaved", () => {
  const props = { onChanged: jest.fn(), onError: jest.fn() };
  const { rerender } = render(<CsBracketBuilder {...props} event={serverEvent(["p1"], event.entrants, ["p1"])} />);
  fireEvent.click(screen.getByRole("button", { name: "参加者2 M3" }));
  fireEvent.click(card());
  rerender(<CsBracketBuilder {...props} event={serverEvent([], event.entrants!.filter(e => e.lineUserId !== "p1"))} />);
  expect(within(card()).getByText("参加者2")).toBeTruthy();
  expect(within(card()).queryByText("p1")).toBeNull();
  expect(screen.getByText("未保存の変更があります")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "参加者2を外す" }));
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
});
test.each([false, true])("resync clears tap selection with dirty=%s", dirty => {
  const props = { onChanged: jest.fn(), onError: jest.fn() };
  const { rerender } = render(<CsBracketBuilder {...props} event={serverEvent([])} />);
  if (dirty) fireEvent.click(screen.getByRole("button", { name: "勝ち抜けを増やす" }));
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1" }));
  rerender(<CsBracketBuilder {...props} event={serverEvent(["p2"], event.entrants!.filter(e => e.lineUserId !== "p1"))} />);
  fireEvent.click(card());
  expect(within(card()).queryByText("p1")).toBeNull();
  if (!dirty) {
    expect(within(card()).getByText("参加者2")).toBeTruthy();
    expect(screen.queryByText("未保存の変更があります")).toBeNull();
  }
});
test.each([200, 404, 409])("save stays busy until onChanged refetch finishes (%s)", async status => {
  (fetch as jest.Mock).mockResolvedValue({ ok: status === 200, status, json: async () => ({}) });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const changed = jest.fn(() => pending);
  render(<CsBracketBuilder event={serverEvent([])} onChanged={changed} onError={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect((screen.getByRole("button", { name: "下書き保存" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "勝ち抜けを増やす" }));
  expect(within(card()).getByText("表彰 1名")).toBeTruthy();
  await act(async () => { finish(); await pending; });
  expect((screen.getByRole("button", { name: "下書き保存" }) as HTMLButtonElement).disabled).toBe(false);
});
