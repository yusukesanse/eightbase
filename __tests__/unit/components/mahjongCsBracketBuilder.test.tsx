/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import CsBracketBuilder from "@/components/admin/mahjongCs/CsBracketBuilder";
import { chipKey } from "@/components/admin/mahjongCs/useCsBracketDrag";
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
// タップと同じクリック操作で人を選び、空席へ配置する。
function placeFirstPlayer() {
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1" }));
  fireEvent.click(screen.getByRole("button", { name: "予選A卓 1席目" }));
}

test("a fresh closed event is clean until a placement is made", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "2名" }));
  expect(screen.queryByText("未保存の変更があります")).toBeNull();
  placeFirstPlayer();
  expect(screen.getByText("未保存の変更があります")).toBeTruthy();
});

test.each(["chip", "pointer chip", "seat"])("selected player replaces occupant by tapping %s", (target) => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  placeFirstPlayer();
  const seat = screen.getByRole("button", { name: "予選A卓 1席目" });
  const occupant = within(seat).getByRole("button", { name: "参加者1 M1" });
  fireEvent.click(occupant);
  expect(occupant.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(occupant);
  fireEvent.click(screen.getByRole("button", { name: "参加者2 M3" }));
  if (target === "pointer chip") {
    pointer(occupant, "pointerdown", 10, 10);
    pointer(window, "pointerup", 10, 10);
    fireEvent.click(seat, { detail: 1 });
  } else {
    fireEvent.click(target === "chip" ? occupant : seat);
  }
  expect(within(seat).getByText("参加者2")).toBeTruthy();
  expect(within(seat).queryByText("参加者1")).toBeNull();
  const pool = screen.getByRole("button", { name: "参加者プールに戻す" });
  expect(within(pool).getByRole("button", { name: "参加者1 M1" })).toBeTruthy();
  expect(within(seat).getByRole("button", { name: "参加者2 M3" }).getAttribute("aria-pressed")).toBe("false");
});

test("tap placement, pool return, seed grouping and fill preserve the intended draft", async () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  placeFirstPlayer();
  const seat = screen.getByRole("button", { name: "予選A卓 1席目" });
  expect(within(seat).getByText("参加者1")).toBeTruthy();
  fireEvent.click(within(seat).getByRole("button", { name: "参加者1 M1" }));
  fireEvent.click(screen.getByRole("button", { name: "参加者プールに戻す" }));
  expect(within(seat).getByText("空席")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "M1" }));
  fireEvent.click(screen.getByRole("button", { name: "未配置の人を予選の空席に順番に入れる" }));
  expect(within(seat).getByText("参加者2")).toBeTruthy();
  expect(screen.getByText("未保存の変更があります")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);
  expect(body.action).toBe("saveBracket");
  expect(body.seedUserIds).toEqual(["p1"]);
  expect(body.rounds[0].matches[0].seats).toEqual([
    { kind: "player", lineUserId: "p2" }, { kind: "player", lineUserId: "p3" },
    { kind: "player", lineUserId: "p4" }, null,
  ]);
});

test("confirmation requires valid seats and displays server validation errors", async () => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: false, status: 400, json: async () => ({ error: "検証失敗", errors: ["サーバーの編成エラー"] }),
  });
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  const confirm = screen.getByRole("button", { name: "この組み合わせで確定" }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  fireEvent.click(screen.getByRole("button", { name: "未配置の人を予選の空席に順番に入れる" }));
  fireEvent.click(screen.getByRole("button", { name: "この組み合わせで確定" }));
  expect(await screen.findByText("サーバーの編成エラー")).toBeTruthy();
  expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).action).toBe("confirmBracket");
});

test.each([404, 409])("status %s reports the error and refetches", async (status) => {
  (fetch as jest.Mock).mockResolvedValue({
    ok: false, status, json: async () => ({ error: "状態が変わりました" }),
  });
  const changed = jest.fn();
  const error = jest.fn();
  render(<CsBracketBuilder event={event} onChanged={changed} onError={error} />);
  fireEvent.click(screen.getByRole("button", { name: "下書き保存" }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(error).toHaveBeenLastCalledWith("状態が変わりました");
});

test("filled round deletion requires in-page confirmation", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  placeFirstPlayer();
  fireEvent.click(screen.getByRole("button", { name: "予選を削除" }));
  expect(screen.getByRole("button", { name: "予選A卓 1席目" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "削除する" }));
  expect(screen.queryByRole("button", { name: "予選A卓 1席目" })).toBeNull();
});

test("switching events replaces the draft even without a parent key", () => {
  const { rerender } = render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  placeFirstPlayer();
  rerender(<CsBracketBuilder event={{ ...event, csEventId: "other" }} onChanged={jest.fn()} onError={jest.fn()} />);
  expect(screen.queryByRole("button", { name: "予選A卓 1席目" })).toBeNull();
});

// jsdom にない PointerEvent の座標と識別子を明示して送る。
function pointer(target: Element | Window, type: string, x: number, y: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  fireEvent(target, event);
}

test("pointer tap selects once and a second tap deselects", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  const chip = screen.getByRole("button", { name: "参加者1 M1" });
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointermove", 13, 13);
  pointer(window, "pointerup", 13, 13);
  fireEvent.click(chip, { detail: 1 });
  expect(chip.getAttribute("aria-pressed")).toBe("true");
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointerup", 10, 10);
  fireEvent.click(chip, { detail: 1 });
  expect(chip.getAttribute("aria-pressed")).toBe("false");
});

test("pointer drag places into the hit-tested seat and cancellation preserves the seat", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  const chip = screen.getByRole("button", { name: "参加者1 M1" });
  const seat = screen.getByRole("button", { name: "予選A卓 1席目" });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => seat });
  pointer(chip, "pointerdown", 10, 10);
  pointer(window, "pointermove", 80, 80);
  pointer(window, "pointerup", 80, 80);
  expect(within(seat).getByText("参加者1")).toBeTruthy();
  const movedChip = within(seat).getByRole("button", { name: "参加者1 M1" });
  const pool = screen.getByRole("button", { name: "参加者プールに戻す" });
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => pool });
  pointer(movedChip, "pointerdown", 80, 80);
  pointer(window, "pointermove", 10, 10);
  pointer(window, "pointercancel", 10, 10);
  pointer(window, "pointerup", 10, 10);
  expect(within(seat).getByText("参加者1")).toBeTruthy();
});

test("a seed drop adds without toggling an existing seed off", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  const seedZone = screen.getByRole("button", { name: "ここに落とすとシードに追加" });
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1" }));
  fireEvent.click(seedZone);
  fireEvent.click(screen.getByRole("button", { name: "参加者1 M1 SEED" }));
  fireEvent.click(seedZone);
  expect(screen.getByRole("button", { name: "参加者1 M1 SEED" })).toBeTruthy();
});


test("chip keys use identity fields regardless of property order", () => {
  expect(chipKey({ lineUserId: "p1", kind: "player" })).toBe("player:p1");
  expect(chipKey({ place: 2, kind: "ticket", fromMatchId: "table" })).toBe("ticket:table:2");
});

test("fill needs a table and the final tag needs multiple rounds", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  const fill = screen.getByRole("button", {
    name: "未配置の人を予選の空席に順番に入れる",
  }) as HTMLButtonElement;
  expect(fill.disabled).toBe(true);
  expect(screen.getByText("先に卓を追加してください")).toBeTruthy();
  expect(screen.queryByText("決勝")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  expect(fill.disabled).toBe(false);
  expect(screen.queryByText("先に卓を追加してください")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "予選A卓を削除" }));
  expect(fill.disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "ラウンドを追加" }));
  expect(screen.getAllByText("決勝")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "ラウンド2を削除" }));
  expect(screen.queryByText("決勝")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "予選を削除" }));
  expect(fill.disabled).toBe(true);
});

test("empty round labels restore the previous label and table names on blur", () => {
  render(<CsBracketBuilder event={event} onChanged={jest.fn()} onError={jest.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "卓を追加" }));
  const input = screen.getByRole("textbox", { name: "ラウンド1の名前" }) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "準決勝" } });
  fireEvent.blur(input);
  expect(input.value).toBe("準決勝");
  for (const value of ["", "   "]) {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value } });
    fireEvent.blur(input);
    expect(input.value).toBe("準決勝");
    expect(screen.getByRole("button", { name: "準決勝A卓 1席目" })).toBeTruthy();
  }
});
