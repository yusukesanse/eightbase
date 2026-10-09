/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MahjongCsView } from "@/components/mahjong/MahjongCsView";

const baseEvent = {
  csEventId: "cs", name: "秋のCS", eventDate: "2026-10-10", status: "entry", demoDummy: false,
  capacity: 16, entryOpensAt: "2026-10-08T23:30:00Z", entryClosesAt: "2026-10-09T12:00:00Z",
  confirmedCount: 12, waitlistCount: 2, myEntry: null as null | {
    state: "confirmed" | "waitlisted"; waitlistPosition: number | null;
  },
  champion: null, entrants: [{ displayName: "自分", seed: false, isMe: true }],
  rounds: [] as {
    type: string; label: string; advanceCount: number;
    matches: {
      matchId: string; label: string; status: string; pendingSeats: string[];
      players: { displayName: string; points: number | null; rank: number | null; seed: boolean; isMe: boolean }[];
    }[];
  }[],
};
let event: Omit<typeof baseEvent, "capacity"> & { capacity: number | null };
let entryError: { status: number; error: string } | null;

// 時刻とネットワーク境界を固定し、表示と操作には実コンポーネントを使う。
beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T03:00:00Z"));
  event = JSON.parse(JSON.stringify(baseEvent));
  entryError = null;
  global.fetch = jest.fn(async (_url, options) => {
    if (options?.method) {
      if (entryError) {
        return { ok: false, status: entryError.status, json: async () => ({ error: entryError?.error }) };
      }
      event.myEntry = options.method === "POST" ? { state: "confirmed", waitlistPosition: null } : null;
      return { ok: true, json: async () => ({ success: true, entered: options.method === "POST" }) };
    }
    return { ok: true, json: async () => ({ event, entered: true }) };
  }) as jest.Mock;
});
afterEach(() => jest.restoreAllMocks());

// 不完全な卓でも申告できた旧方式と、新方式の札待ちを比較する。
function runningTable(count: number, status = "running") {
  event.status = status;
  event.rounds = [{
    type: "final", label: "決勝", advanceCount: 1,
    matches: [{
      matchId: "final", label: "決勝A卓", status: "reporting",
      pendingSeats: count === 2 ? ["予選A卓 1位", "予選B卓 1位"] : [],
      players: Array.from({ length: count }, (_, i) => ({
        displayName: `選手${i + 1}`, points: null, rank: null, seed: false, isMe: i === 0,
      })),
    }],
  }];
}

test("legacy setup preserves its entry status and cancellation action", async () => {
  event.capacity = null;
  event.status = "setup";
  render(<MahjongCsView />);
  expect(await screen.findByText("参加中")).toBeTruthy();
  expect(screen.getByText("どなたでも参加できます（現在 1 名エントリー中）")).toBeTruthy();
  expect(screen.getByRole("button", { name: "エントリーを取り消す" })).toBeTruthy();
});

test.each([403, 409])("new entry uses myEntry and displays the server's %s error verbatim", async (status) => {
  entryError = { status, error: status === 403
    ? "リーグ戦に1回以上参加した人だけが参加できます" : "参加受付は終了しました" };
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "参加する" }));
  expect(await screen.findByText(entryError.error)).toBeTruthy();
  expect(screen.getByText("定員 16名 / 参加確定 12名")).toBeTruthy();
  expect(screen.getByText("締切：10/9 21:00")).toBeTruthy();
  expect(screen.getByText("参加できるのはリーグ戦に1回以上出た人です")).toBeTruthy();
});

test("successful join reloads and shows confirmed status", async () => {
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "参加する" }));
  expect(await screen.findByText("参加確定")).toBeTruthy();
  expect(screen.getByRole("button", { name: "参加をやめる" })).toBeTruthy();
});

test("waitlisted entry shows its position and requires in-page cancellation confirmation", async () => {
  event.myEntry = { state: "waitlisted", waitlistPosition: 2 };
  render(<MahjongCsView />);
  expect(await screen.findByText("キャンセル待ち 2番目")).toBeTruthy();
  expect(screen.queryByText("参加中")).toBeNull();
  const notice = "繰り上がるとここが『参加確定』に変わります（通知は届きません）";
  expect(screen.getByText(notice)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "参加をやめる" }));
  expect(screen.getByText("キャンセル待ちを取り消しますか？")).toBeTruthy();
  expect((fetch as jest.Mock).mock.calls.every(([, options]) => !options.method)).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "戻る" }));
  expect(screen.queryByText("キャンセル待ちを取り消しますか？")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "参加をやめる" }));
  fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
  expect(await screen.findByRole("button", { name: "参加する" })).toBeTruthy();
});

test("confirmed cancellation preserves the server's deadline error", async () => {
  event.myEntry = { state: "confirmed", waitlistPosition: null };
  entryError = { status: 409, error: "締切後は取り消せません。管理者に連絡してください" };
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "参加をやめる" }));
  expect(screen.getByText("参加を取り消しますか？")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
  expect(await screen.findByText(entryError.error)).toBeTruthy();
  expect(screen.getByText("参加確定")).toBeTruthy();
});

test.each(["confirmed", "waitlisted", null] as const)("closed displays %s without actions", async (state) => {
  event.status = "closed";
  event.myEntry = state ? { state, waitlistPosition: state === "waitlisted" ? 2 : null } : null;
  render(<MahjongCsView />);
  expect(await screen.findByText(state === "confirmed"
    ? "参加確定。対戦表を準備中です" : "参加受付は終了しました")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /参加/ })).toBeNull();
});

test("opening date is shown in JST before entry opens", async () => {
  event.entryOpensAt = "2026-10-09T23:30:00Z";
  render(<MahjongCsView />);
  expect(await screen.findByText("参加受付は 10/10 08:30 から")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "参加する" })).toBeNull();
});

test("elapsed deadline hides entry actions even before status changes", async () => {
  event.entryClosesAt = "2026-10-09T02:00:00Z";
  render(<MahjongCsView />);
  expect(await screen.findByText("参加受付は終了しました")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /参加/ })).toBeNull();
});

test("running ticket labels appear after players in the same waiting table", async () => {
  runningTable(2);
  render(<MahjongCsView />);
  const label = await screen.findByText("予選A卓 1位");
  const card = label.closest(".eb-glass");
  expect(card).toBeTruthy();
  expect(within(card as HTMLElement).getByText("勝ち上がり待ち")).toBeTruthy();
  expect(within(card as HTMLElement).getByText("予選B卓 1位")).toBeTruthy();
  expect(screen.getByText("選手2").compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("new two-player table hides self reporting", async () => {
  runningTable(2);
  render(<MahjongCsView />);
  await screen.findByText("決勝A卓");
  expect(screen.queryByRole("button", { name: "結果を申告" })).toBeNull();
});

test("four-player table opens the existing self-report sheet", async () => {
  runningTable(4);
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(await screen.findByText("最終持ち点")).toBeTruthy();
});

test("finished new event hides reporting even on an incomplete table", async () => {
  runningTable(4, "finished");
  render(<MahjongCsView />);
  await screen.findByText("決勝A卓");
  expect(screen.queryByRole("button", { name: "結果を申告" })).toBeNull();
});

test("legacy two-player table still allows self reporting", async () => {
  runningTable(2);
  event.capacity = null;
  render(<MahjongCsView />);
  await waitFor(() => expect(screen.getByRole("button", { name: "結果を申告" })).toBeTruthy());
});


test.each(["POST", "DELETE"])("rejected %s shows a retry message and closes confirmation", async (method) => {
  if (method === "DELETE") event.myEntry = { state: "confirmed", waitlistPosition: null };
  render(<MahjongCsView />);
  const action = await screen.findByRole("button", { name: method === "POST" ? "参加する" : "参加をやめる" });
  (fetch as jest.Mock).mockImplementationOnce(() => Promise.reject(new Error("offline")));
  fireEvent.click(action);
  if (method === "DELETE") fireEvent.click(screen.getByRole("button", { name: "取り消す" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("通信に失敗しました。もう一度お試しください");
  expect(screen.queryByText("参加を取り消しますか？")).toBeNull();
  expect(screen.getByRole("button", { name: method === "POST" ? "参加する" : "参加をやめる" })).toBeEnabled();
});

function completedTable(advanceCount: number, type = "preliminary") {
  runningTable(4);
  const round = event.rounds[0];
  round.type = type;
  round.advanceCount = advanceCount;
  round.matches[0].status = "completed";
  round.matches[0].players.forEach((player, index) => { player.rank = index + 1; });
}

test.each([1, 2, 3])("new completed table highlights the top %s players", async (advanceCount) => {
  completedTable(advanceCount);
  render(<MahjongCsView />);
  expect(await screen.findByText(advanceCount === 1 ? "1着通過" : `${advanceCount}着まで通過`)).toBeTruthy();
  for (let rank = 1; rank <= 4; rank++) {
    const row = screen.getByText(`選手${rank}`).parentElement!;
    expect(row.style.boxShadow.includes("var(--eb-green)")).toBe(rank <= advanceCount);
  }
});

test("reporting table does not highlight provisional advancing ranks", async () => {
  completedTable(2);
  event.rounds[0].matches[0].status = "reporting";
  render(<MahjongCsView />);
  await screen.findByText("選手2");
  expect(screen.getByText("選手2").parentElement!.style.boxShadow).not.toContain("var(--eb-green)");
});

test("legacy table keeps one advancing player even when advanceCount is two", async () => {
  completedTable(2);
  event.capacity = null;
  render(<MahjongCsView />);
  expect(await screen.findByText("1着通過")).toBeTruthy();
  expect(screen.getByText("選手2").parentElement!.style.boxShadow).not.toContain("var(--eb-green)");
});

test("new final highlights only its champion in gold", async () => {
  completedTable(2, "final");
  render(<MahjongCsView />);
  await screen.findByText("選手1");
  expect(screen.getByText("選手1").parentElement!.style.boxShadow).toContain("var(--eb-gold)");
  expect(screen.getByText("選手2").parentElement!.style.boxShadow).not.toContain("var(--eb-green)");
  expect(screen.getByText("2着")).toBeTruthy();
  expect(screen.getByText("3着")).toBeTruthy();
});

test("new seeded player keeps the legacy S badge and gets a header legend", async () => {
  runningTable(4);
  event.rounds[0].matches[0].players[1].seed = true;
  render(<MahjongCsView />);
  const player = await screen.findByText("選手2");
  expect(within(player.parentElement!).getByText("S")).toBeTruthy();
  expect(screen.getByText("SEED＝シード（予選免除）")).toBeTruthy();
});

test("new seeded entrant gets a legend before brackets are published", async () => {
  event.entrants[0].seed = true;
  render(<MahjongCsView />);
  expect(await screen.findByText("SEED＝シード（予選免除）")).toBeTruthy();
});

test("new header without seeds has no seed legend and sizes its paragraph directly", async () => {
  render(<MahjongCsView />);
  const description = await screen.findByText("各卓の上位が勝ち上がり、決勝1位が優勝。");
  expect(description.tagName).toBe("P");
  expect(description).toHaveClass("text-[15px]");
  expect(screen.queryByText("SEED＝シード（予選免除）")).toBeNull();
});

test("successful POST returning waitlisted reloads and displays the queue position", async () => {
  render(<MahjongCsView />);
  const join = await screen.findByRole("button", { name: "参加する" });
  (fetch as jest.Mock).mockImplementationOnce(async () => {
    event = { ...event, myEntry: { state: "waitlisted", waitlistPosition: 3 } };
    return { ok: true, json: async () => ({ success: true, entered: true, ...event.myEntry }) };
  });
  fireEvent.click(join);
  expect(await screen.findByText("キャンセル待ち 3番目")).toBeTruthy();
  expect(screen.queryByText("参加中")).toBeNull();
});

test("waitlisted entry without a position omits the number", async () => {
  event.myEntry = { state: "waitlisted", waitlistPosition: null };
  render(<MahjongCsView />);
  expect(await screen.findByText("キャンセル待ち")).toBeTruthy();
  expect(screen.queryByText(/null番目/)).toBeNull();
});

test.each(["POST", "DELETE"])("non-ok %s reloads entry state", async (method) => {
  if (method === "DELETE") event.myEntry = { state: "confirmed", waitlistPosition: null };
  entryError = { status: 409, error: "受付状態が変わりました" };
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: method === "POST" ? "参加する" : "参加をやめる" }));
  if (method === "DELETE") {
    const cancel = screen.getByRole("button", { name: "取り消す" });
    expect(cancel).toHaveClass("bg-[color:var(--eb-coral)]");
    fireEvent.click(cancel);
  }
  await screen.findByRole("alert");
  await waitFor(() => expect((fetch as jest.Mock).mock.calls.filter(([, options]) => !options.method)).toHaveLength(2));
});

test("entry state change from auto-refresh resets cancellation confirmation", async () => {
  event.myEntry = { state: "waitlisted", waitlistPosition: 2 };
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "参加をやめる" }));
  expect(screen.getByText("キャンセル待ちを取り消しますか？")).toBeTruthy();
  event = { ...event, myEntry: { state: "confirmed", waitlistPosition: null } };
  fireEvent.focus(window);
  await screen.findByText("参加確定");
  await waitFor(() => expect(screen.queryByRole("button", { name: "取り消す" })).toBeNull());
  expect(screen.getByRole("button", { name: "参加をやめる" })).toBeTruthy();
});
