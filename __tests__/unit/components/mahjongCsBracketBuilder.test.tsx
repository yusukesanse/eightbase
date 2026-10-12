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
