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
      matchId: string; label: string; status: string; advanceCount?: number; pendingSeats: string[];
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

test("legacy setup is read-only and explains that entry is unavailable", async () => {
  event.capacity = null;
  event.status = "setup";
  render(<MahjongCsView />);
  expect(await screen.findByText("このCSは旧形式のため参加受付をしていません")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /エントリー|参加/ })).toBeNull();
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
    ? "参加確定。対戦表を準備中です"
    : state === "waitlisted" ? "キャンセル待ちのまま締め切られました" : "参加受付は終了しました")).toBeTruthy();
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

test("running ticket labels become waiting sentences after players in the same waiting table", async () => {
  runningTable(2);
  render(<MahjongCsView />);
  const panel = await screen.findByRole("tabpanel");
  const label = within(panel).getByText("予選A卓の1位を待っています");
  const card = label.closest(".eb-glass");
  expect(card).toBeTruthy();
  expect(within(card as HTMLElement).getByText("勝ち上がり待ち")).toBeTruthy();
  expect(within(card as HTMLElement).getByText("予選B卓の1位を待っています")).toBeTruthy();
  expect(within(panel).getByText("選手2").compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText("予選A卓 1位")).toBeNull();
});

test("new two-player table hides self reporting", async () => {
  runningTable(2);
  render(<MahjongCsView />);
  await screen.findAllByText("決勝A卓");
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
  await screen.findAllByText("決勝A卓");
  expect(screen.queryByRole("button", { name: "結果を申告" })).toBeNull();
  expect(screen.queryByText("優勝")).toBeNull();
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

/** 予選1卓（完了）＋決勝（札待ち）。既定では決勝タブが選ばれるので予選は selectRound で開く。 */
function completedTable(advanceCount: number, type = "preliminary") {
  runningTable(4);
  const round = event.rounds[0];
  round.type = type;
  round.label = type === "final" ? "決勝" : "予選";
  round.advanceCount = advanceCount;
  round.matches[0].label = type === "final" ? "決勝A卓" : "予選A卓";
  round.matches[0].status = "completed";
  round.matches[0].players.forEach((player, index) => {
    player.rank = index + 1;
    player.points = [42000, 30000, 18000, 10000][index];
  });
  if (type !== "final") {
    event.rounds.push({
      type: "final", label: "決勝", advanceCount: 1,
      matches: [{ matchId: "final", label: "決勝A卓", status: "reporting", pendingSeats: ["予選A卓 1位"], players: [] }],
    });
  }
}
function selectRound(label: string) {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(label) }));
  return screen.getByRole("tabpanel");
}
function row(panel: HTMLElement, name: string) {
  return within(panel).getByText(name).closest("[data-cs-row]") as HTMLElement;
}

test.each([1, 2, 3])("new completed table marks the top %s players as advancing", async (advanceCount) => {
  completedTable(advanceCount);
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  const panel = selectRound("予選");
  expect(within(panel).getByText(advanceCount === 1 ? "1卓・1位が決勝へ" : `1卓・上位${advanceCount}名が決勝へ`)).toBeTruthy();
  for (let rank = 1; rank <= 4; rank++) {
    const r = row(panel, `選手${rank}`);
    expect(r.dataset.advanced === "true").toBe(rank <= advanceCount);
    expect(within(r).queryByText("次のラウンドへ進出") != null).toBe(rank <= advanceCount);
    expect(within(r).getByText(String(rank))).toBeTruthy();
  }
  expect(within(panel).getByText("42,000")).toBeTruthy();
});

test("reporting table does not highlight provisional advancing ranks and hides points", async () => {
  completedTable(2);
  event.rounds[0].matches[0].status = "reporting";
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  const panel = screen.getByRole("tabpanel");
  expect(row(panel, "選手2").dataset.advanced).toBe("false");
  expect(within(panel).queryByText("30,000")).toBeNull();
  expect(within(row(panel, "選手1")).getByText("申告済み")).toBeTruthy();
});

test("unreported players are marked as not yet reported", async () => {
  runningTable(4);
  render(<MahjongCsView />);
  const panel = await screen.findByRole("tabpanel");
  expect(within(row(panel, "選手2")).getByText("まだ申告していません")).toBeTruthy();
});

test("legacy table keeps one advancing player even when advanceCount is two", async () => {
  completedTable(2);
  event.capacity = null;
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  const panel = selectRound("予選");
  expect(within(panel).getByText("1卓・1位が決勝へ")).toBeTruthy();
  expect(row(panel, "選手1").dataset.advanced).toBe("true");
  expect(row(panel, "選手2").dataset.advanced).toBe("false");
});

test("finished final shows the podium and marks the winner", async () => {
  completedTable(2, "final");
  render(<MahjongCsView />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  expect(within(podium).getByText("優勝")).toBeTruthy();
  expect(within(podium).getByText("選手1")).toBeTruthy();
  expect(within(podium).getByText("決勝 42,000点")).toBeTruthy();
  expect(within(podium).getByText("選手2")).toBeTruthy();
  expect(within(podium).getByText("選手3")).toBeTruthy();
  expect(within(podium).queryByText("選手4")).toBeNull();
  const panel = screen.getByRole("tabpanel");
  expect(within(panel).getByText("1卓・1位が優勝")).toBeTruthy();
  expect(within(row(panel, "選手1")).getByText("優勝")).toBeTruthy();
  expect(row(panel, "選手2").dataset.advanced).toBe("false");
});

test("champion from the event takes precedence on the podium", async () => {
  completedTable(1, "final");
  event.champion = { displayName: "王者" } as never;
  render(<MahjongCsView />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  expect(within(podium).getByText("王者")).toBeTruthy();
  expect(within(podium).queryByText("選手1")).toBeNull();
  expect(within(podium).queryByText(/決勝 .*点/)).toBeNull();
});

test("champion matching the final winner keeps the points line", async () => {
  completedTable(1, "final");
  event.champion = { displayName: "選手1" } as never;
  render(<MahjongCsView />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  expect(within(podium).getByText("決勝 42,000点")).toBeTruthy();
});

test("finished status alone does not show provisional ranks on the podium", async () => {
  completedTable(2, "final");
  event.status = "finished";
  event.rounds[0].matches[0].status = "reporting";
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  expect(screen.queryByRole("region", { name: "表彰台" })).toBeNull();
  expect(screen.queryByText("優勝")).toBeNull();
  expect(within(screen.getByRole("tabpanel")).queryByText("42,000")).toBeNull();
});

test("multi-round headings show 各卓 only when a round has several tables", async () => {
  completedTable(1);
  const round = event.rounds[0];
  round.matches.push({ ...round.matches[0], matchId: "B", label: "予選B卓",
    players: round.matches[0].players.map(p => ({ ...p, displayName: `B${p.displayName}`, isMe: false })) });
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  expect(within(selectRound("予選")).getByText("2卓・各卓1位が決勝へ")).toBeTruthy();
});

test("five rounds keep every label intact in a scrollable tab list", async () => {
  runningTable(4);
  const labels = ["予選1回戦", "予選2回戦", "準々決勝", "準決勝", "決勝"];
  event.rounds = labels.map((label, i) => ({
    type: i === 4 ? "final" : "prelim", label, advanceCount: 1,
    matches: [{ matchId: `m${i}`, label: `${label}A卓`, status: i < 4 ? "completed" : "reporting", pendingSeats: [],
      players: Array.from({ length: 4 }, (_, j) => ({ displayName: `${label}${j + 1}`, points: 25000, rank: j + 1, seed: false, isMe: false })) }],
  }));
  render(<MahjongCsView />);
  const list = await screen.findByRole("tablist", { name: "ラウンド" });
  expect(list).toHaveClass("overflow-x-auto");
  const tabs = within(list).getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["✓ 予選1回戦", "✓ 予選2回戦", "✓ 準々決勝", "✓ 準決勝", "決勝"]);
  for (const tab of tabs) {
    expect(tab).toHaveClass("whitespace-nowrap");
    expect(tab).not.toHaveClass("truncate");
    expect(tab).toHaveAttribute("aria-controls", "cs-round-panel");
  }
  const panel = screen.getByRole("tabpanel");
  expect(panel).toHaveAttribute("id", "cs-round-panel");
  expect(panel).toHaveAttribute("aria-labelledby", tabs[4].id);
  expect(tabs[4]).toHaveAttribute("aria-selected", "true");
});

test("picked round resets to auto when the csEventId changes", async () => {
  completedTable(1);
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  selectRound("予選");
  expect(screen.getByRole("tab", { name: "✓ 予選" })).toHaveAttribute("aria-selected", "true");
  event = { ...event, csEventId: "cs2" };
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByRole("tab", { name: "決勝" })).toHaveAttribute("aria-selected", "true"));
});

test("picked round resets to auto when the rounds are rebuilt", async () => {
  completedTable(1);
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  selectRound("予選");
  event = { ...event, rounds: event.rounds.map((r, i) => ({ ...r, label: i === 0 ? "予選1回戦" : r.label })) };
  fireEvent.focus(window);
  await screen.findByRole("tab", { name: "✓ 予選1回戦" });
  expect(screen.getByRole("tab", { name: "決勝" })).toHaveAttribute("aria-selected", "true");
});

test("a second unfinished table of mine still offers reporting in the list", async () => {
  runningTable(4);
  const round = event.rounds[0];
  round.matches.push({ ...round.matches[0], matchId: "B", label: "決勝B卓",
    players: round.matches[0].players.map((p, i) => ({ ...p, displayName: `B${p.displayName}`, isMe: i === 0 })) });
  render(<MahjongCsView />);
  const mine = await screen.findByRole("region", { name: "あなたの卓" });
  expect(within(mine).getByText("決勝A卓")).toBeTruthy();
  const panel = screen.getByRole("tabpanel");
  const a = within(panel).getByText("決勝A卓").closest(".eb-glass") as HTMLElement;
  const b = within(panel).getByText("決勝B卓").closest(".eb-glass") as HTMLElement;
  expect(within(a).queryByRole("button", { name: "結果を申告" })).toBeNull();
  expect(within(b).getByRole("button", { name: "結果を申告" })).toBeTruthy();
});

test("the round with my unfinished table is selected first", async () => {
  completedTable(1);
  const final = event.rounds[1].matches[0];
  final.pendingSeats = [];
  final.players = Array.from({ length: 4 }, (_, i) => ({
    displayName: `決勝${i + 1}`, points: null, rank: null, seed: false, isMe: i === 1,
  }));
  event.rounds[0].matches[0].players[0].isMe = false;
  render(<MahjongCsView />);
  const tab = await screen.findByRole("tab", { name: "決勝" });
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "✓ 予選" })).toHaveAttribute("aria-selected", "false");
  const mine = screen.getByRole("region", { name: "あなたの卓" });
  expect(within(mine).getByText("決勝A卓")).toBeTruthy();
  expect(within(mine).getByText("あなたの卓・1位が優勝")).toBeTruthy();
  expect(within(mine).getByText("あなた")).toBeTruthy();
  expect(within(mine).getByRole("button", { name: "結果を申告" })).toBeTruthy();
});

test("without my table the first unfinished round is selected, then the last round", async () => {
  completedTable(1);
  event.rounds[0].matches[0].players[0].isMe = false;
  render(<MahjongCsView />);
  expect(await screen.findByRole("tab", { name: "決勝" })).toHaveAttribute("aria-selected", "true");
  expect(screen.queryByRole("region", { name: "あなたの卓" })).toBeNull();
});

test("switching rounds shows only that round's tables and survives auto-refresh", async () => {
  completedTable(1);
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  let panel = screen.getByRole("tabpanel");
  expect(within(panel).getByText("決勝A卓")).toBeTruthy();
  expect(within(panel).queryByText("予選A卓")).toBeNull();
  panel = selectRound("予選");
  expect(screen.getByRole("tab", { name: "✓ 予選" })).toHaveAttribute("aria-selected", "true");
  expect(within(panel).getByText("予選A卓")).toBeTruthy();
  expect(within(panel).queryByText("決勝A卓")).toBeNull();
  event = { ...event, name: "秋のCS（更新）" };
  fireEvent.focus(window);
  await screen.findByText("秋のCS（更新）");
  expect(screen.getByRole("tab", { name: "✓ 予選" })).toHaveAttribute("aria-selected", "true");
  expect(within(screen.getByRole("tabpanel")).getByText("予選A卓")).toBeTruthy();
});

test("new seeded player is labelled and gets a header legend", async () => {
  runningTable(4);
  event.rounds[0].matches[0].players[1].seed = true;
  render(<MahjongCsView />);
  const panel = await screen.findByRole("tabpanel");
  expect(within(row(panel, "選手2")).getByText("シード")).toBeTruthy();
  expect(screen.getByText("S＝シード（予選免除）")).toBeTruthy();
});

test("new seeded entrant gets a legend before brackets are published", async () => {
  event.entrants[0].seed = true;
  render(<MahjongCsView />);
  expect(await screen.findByText("S＝シード（予選免除）")).toBeTruthy();
});

test("new header without seeds has no seed legend and sizes its paragraph directly", async () => {
  render(<MahjongCsView />);
  const description = await screen.findByText("各卓の上位が勝ち上がり、決勝1位が優勝。");
  expect(description.tagName).toBe("P");
  expect(description).toHaveClass("text-[15px]");
  expect(screen.queryByText("S＝シード（予選免除）")).toBeNull();
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


test.each(["running", "finished"])("%sでもキャンセル待ちの締切を伝える", async (status) => {
  runningTable(4, status);
  event.myEntry = { state: "waitlisted", waitlistPosition: 2 };
  render(<MahjongCsView />);
  expect(await screen.findByText("キャンセル待ちのまま締め切られました")).toBeTruthy();
  expect(screen.queryByText("参加受付は終了しました")).toBeNull();
  expect(screen.queryByRole("button", { name: /参加する|参加をやめる/ })).toBeNull();
});

test.each([1, 2, 3])("新方式の申告シートは上位%s名の進出を2箇所で伝える", async (advanceCount) => {
  runningTable(4);
  event.rounds[0].type = "preliminary";
  event.rounds[0].advanceCount = advanceCount;
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.getAllByText(new RegExp(`上位${advanceCount}名が次へ進出`))).toHaveLength(2);
  expect(screen.queryByText(/1着のみ/)).toBeNull();
});

test("新方式の決勝申告シートは進出を案内しない", async () => {
  runningTable(4);
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.getAllByText("決勝です。1位が優勝です。", { exact: false })).toHaveLength(2);
  expect(screen.queryByText(/次へ進出|次のラウンドへ進出/)).toBeNull();
});

test("旧方式の申告シートの進出案内を維持する", async () => {
  runningTable(4);
  event.capacity = null;
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.getAllByText(/1着のみ/)).toHaveLength(2);
});

test.each([1, 3])("卓の通過人数%sで強調し共通見出しを表示する", async (n) => {
  completedTable(2);
  event.rounds[0].matches[0].advanceCount = n;
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  const panel = selectRound("予選");
  for (let rank = 1; rank <= 4; rank++) {
    expect(row(panel, `選手${rank}`).dataset.advanced === "true").toBe(rank <= n);
  }
  expect(within(panel).getByText(n === 1 ? "1卓・1位が決勝へ" : "1卓・上位3名が決勝へ")).toBeTruthy();
});
test("通過人数が混在すると見出しから外して各卓に表示する", async () => {
  completedTable(2);
  const round = event.rounds[0];
  round.matches[0].advanceCount = 3;
  round.matches.push({ ...round.matches[0], matchId: "B", label: "予選B卓", advanceCount: undefined,
    players: round.matches[0].players.map(p => ({ ...p, displayName: `B${p.displayName}` })) });
  render(<MahjongCsView />);
  await screen.findByRole("tablist");
  const panel = selectRound("予選");
  expect(within(panel).getByText("2卓")).toBeTruthy();
  expect(within(panel).queryByText(/各卓/)).toBeNull();
  expect(within(within(panel).getByText("予選A卓").closest(".eb-glass") as HTMLElement).getByText("上位3名が決勝へ")).toBeTruthy();
  expect(within(within(panel).getByText("予選B卓").closest(".eb-glass") as HTMLElement).getByText("上位2名が決勝へ")).toBeTruthy();
  expect(row(panel, "B選手3").dataset.advanced).toBe("false");
});
test("申告シートはラウンドより卓の通過人数を優先する", async () => {
  runningTable(4);
  event.rounds[0].type = "prelim";
  event.rounds[0].matches[0].advanceCount = 3;
  render(<MahjongCsView />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.getAllByText(/上位3名が次へ進出/)).toHaveLength(2);
});
