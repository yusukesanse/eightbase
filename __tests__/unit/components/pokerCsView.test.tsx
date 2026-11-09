/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MahjongCsView } from "@/components/mahjong/MahjongCsView";

// 麻雀の mahjongCsView.test.tsx と同じく、ネットワーク境界だけを fetch のモックで固定し、表示と操作は実コンポーネントを使う。
const player = (name: string, isMe = false, points: number | null = null, rank: number | null = null) =>
  ({ displayName: name, pictureUrl: "", points, rank, seed: false, isMe });
const event = (over: Record<string, unknown> = {}) => ({
  csEventId: "cs1", seasonId: "s1", name: "ポーカーCS", eventDate: "2099-12-01", status: "running", capacity: 6,
  entryOpensAt: null, entryClosesAt: null, confirmedCount: 3, waitlistCount: 0,
  myEntry: { state: "confirmed", waitlistPosition: null }, demoDummy: false, champion: null, podium: null, entrants: [],
  rounds: [{ type: "final", label: "決勝", advanceCount: 3, matches: [{ matchId: "F", label: "決勝卓", status: "reporting",
    advanceCount: 3, pendingSeats: [], tiebreakMine: false, players: [player("自分", true), player("相手1"), player("相手2")] }] }],
  ...over,
});
type Match = { status: string; tiebreakMine: boolean; players: unknown[] };
const firstMatch = (ev: ReturnType<typeof event>) => (ev.rounds as { matches: Match[] }[])[0].matches[0];
const mockGet = (ev: unknown) => {
  global.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () =>
    url === "/api/poker/cs" ? { event: ev, entered: true } : { success: true } })) as jest.Mock;
};
const matchCalls = () => (fetch as jest.Mock).mock.calls.filter(([url]) => url === "/api/poker/cs/match");

afterEach(() => jest.restoreAllMocks());

test("ポーカーは /api/poker/cs を読む", async () => {
  mockGet(event());
  render(<MahjongCsView game="poker" />);
  expect(await screen.findByText("ポーカーCS")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/poker/cs", expect.anything());
});

test("申告はチップだけを入れ、確認をはさんでから /api/poker/cs/match に送る（着順は入れない）", async () => {
  mockGet(event());
  render(<MahjongCsView game="poker" />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.queryByText("着")).toBeNull();
  expect(screen.queryByText("最終持ち点")).toBeNull();
  fireEvent.change(screen.getByLabelText("終了時のチップ"), { target: { value: "12000" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  expect(screen.getByText("12,000チップで申告します。よろしいですか？")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/poker/cs/match", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ csEventId: "cs1", matchId: "F", points: 12000, expectedStatus: "reporting" }),
  })));
});

test("確認で「戻る」を押すと送らず、入力した値に戻れる", async () => {
  mockGet(event());
  render(<MahjongCsView game="poker" />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  fireEvent.change(screen.getByLabelText("終了時のチップ"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  fireEvent.click(screen.getByRole("button", { name: "戻る" }));
  expect(screen.getByLabelText("終了時のチップ")).toHaveValue("500");
  expect(screen.queryByRole("button", { name: "申告する" })).toBeNull();
  expect(matchCalls()).toHaveLength(0);
});

test("チップは 0〜1,000,000 の整数。空欄と上限超えは確認へ進めない", async () => {
  mockGet(event());
  render(<MahjongCsView game="poker" />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.getByRole("button", { name: "確認へ進む" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("終了時のチップ"), { target: { value: "1000001" } });
  expect(screen.getByRole("button", { name: "確認へ進む" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("終了時のチップ"), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "確認へ進む" })).toBeEnabled();
});

test("追加ハンドの対象のときだけ「追加ハンドを申告」が出て、同じ API に points で送る", async () => {
  const ev = event();
  firstMatch(ev).status = "tiebreak";
  firstMatch(ev).tiebreakMine = true;
  firstMatch(ev).players = [player("自分", true, 100), player("相手1", false, 100), player("相手2", false, 10)];
  mockGet(ev);
  render(<MahjongCsView game="poker" />);
  fireEvent.click(await screen.findByRole("button", { name: "追加ハンドを申告" }));
  expect(screen.queryByRole("button", { name: "結果を申告" })).toBeNull();
  fireEvent.change(screen.getByLabelText("追加ハンドのチップ"), { target: { value: "300" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  expect(screen.getByText("追加ハンドの300チップで申告します。よろしいですか？")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/poker/cs/match", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ csEventId: "cs1", matchId: "F", points: 300, expectedStatus: "tiebreak" }),
  })));
});

test("追加ハンド中の卓は状態の札が「追加ハンド」になる", async () => {
  const ev = event();
  firstMatch(ev).status = "tiebreak";
  firstMatch(ev).tiebreakMine = true;
  firstMatch(ev).players = [player("自分", true, 100), player("相手1", false, 100), player("相手2", false, 10)];
  mockGet(ev);
  render(<MahjongCsView game="poker" />);
  const mine = await screen.findByRole("region", { name: "あなたの卓" });
  expect(within(mine).getByText("追加ハンド")).toBeInTheDocument();
  expect(within(mine).queryByText("結果待ち")).toBeNull();
});

test("追加ハンドを送った後は「追加ハンド申告済み・相手待ち」と出て、ボタンは「申告を修正」", async () => {
  const ev = event();
  firstMatch(ev).status = "tiebreak";
  firstMatch(ev).tiebreakMine = true;
  (firstMatch(ev) as { tiebreakSubmitted?: boolean }).tiebreakSubmitted = true;
  firstMatch(ev).players = [player("自分", true, 100), player("相手1", false, 100), player("相手2", false, 10)];
  mockGet(ev);
  render(<MahjongCsView game="poker" />);
  const mine = await screen.findByRole("region", { name: "あなたの卓" });
  expect(within(mine).getByText("追加ハンド申告済み・相手待ち")).toBeInTheDocument();
  expect(within(mine).getByRole("button", { name: "申告を修正" })).toBeInTheDocument();
  expect(within(mine).queryByRole("button", { name: "追加ハンドを申告" })).toBeNull();
});

test("追加ハンドの対象でない人には「追加ハンド待ち」を出し、申告ボタンは出さない", async () => {
  const ev = event();
  firstMatch(ev).status = "tiebreak";
  firstMatch(ev).tiebreakMine = false;
  firstMatch(ev).players = [player("自分", true, 10), player("相手1", false, 100), player("相手2", false, 100)];
  mockGet(ev);
  render(<MahjongCsView game="poker" />);
  expect((await screen.findAllByText("追加ハンド待ち")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /申告/ })).toBeNull();
});

test("卓の状態が変わって 409 が返ったら、シートを閉じて CS を取り直し、エラー文を画面に出す", async () => {
  const ev = event();
  global.fetch = jest.fn(async (url: string, options?: { method?: string }) => {
    if (options?.method === "PATCH") {
      return { ok: false, status: 409, json: async () => ({ error: "卓の状態が変わりました。画面を更新してください" }) };
    }
    return { ok: true, json: async () => (url === "/api/poker/cs" ? { event: ev, entered: true } : { success: true }) };
  }) as jest.Mock;
  render(<MahjongCsView game="poker" />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  fireEvent.change(screen.getByLabelText("終了時のチップ"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("卓の状態が変わりました。画面を更新してください");
  expect(screen.queryByRole("button", { name: "申告する" })).toBeNull();
  expect(screen.queryByLabelText("終了時のチップ")).toBeNull();
  await waitFor(() => expect((fetch as jest.Mock).mock.calls.filter(([url]) => url === "/api/poker/cs").length).toBeGreaterThanOrEqual(2));
});

test("終了後は podium の金銀銅を出す（単位はチップ）", async () => {
  const done = event({ status: "finished",
    podium: { gold: { displayName: "相手1", pictureUrl: "" }, silver: { displayName: "自分", pictureUrl: "" }, bronze: { displayName: "相手2", pictureUrl: "" } } });
  const m = firstMatch(done);
  m.status = "completed";
  // 点数は表示名ではなく着順で引く（同姓同名でも入れ替わらない）
  m.players = [player("相手1", false, 30, 1), player("自分", true, 20, 2), player("相手1", false, 10, 3)];
  mockGet(done);
  render(<MahjongCsView game="poker" />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  expect(within(podium).getByText("優勝")).toBeInTheDocument();
  expect(within(podium).getAllByText("相手1").length).toBeGreaterThan(0);
  expect(within(podium).getByText("決勝 30チップ")).toBeInTheDocument();
  expect(within(podium).getByText("10チップ")).toBeInTheDocument();
  expect(within(podium).getByText("20チップ")).toBeInTheDocument();
  expect(within(podium).queryByText(/点/)).toBeNull();
});

test("旧形式（capacity なし）のポーカーは申告ボタンを出さず、麻雀のシード説明も出さない", async () => {
  const legacy = event({ capacity: null, status: "running" });
  mockGet(legacy);
  render(<MahjongCsView game="poker" />);
  expect(await screen.findByText("ポーカーCS")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "結果を申告" })).toBeNull();
  expect(screen.queryByText(/M1リーグ/)).toBeNull();
});

test("409 のあとに出たエラー文は、次の取り直しが成功したら消える", async () => {
  const ev = event();
  global.fetch = jest.fn(async (url: string, options?: { method?: string }) => {
    if (options?.method === "PATCH") {
      return { ok: false, status: 409, json: async () => ({ error: "卓の状態が変わりました。画面を更新してください" }) };
    }
    return { ok: true, json: async () => (url === "/api/poker/cs" ? { event: ev, entered: true } : { success: true }) };
  }) as jest.Mock;
  render(<MahjongCsView game="poker" />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  fireEvent.change(screen.getByLabelText("終了時のチップ"), { target: { value: "500" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("卓の状態が変わりました");
  // 画面復帰で useAutoRefresh が即 load する（15秒のポーリングと同じ経路）
  fireEvent.focus(window);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});
