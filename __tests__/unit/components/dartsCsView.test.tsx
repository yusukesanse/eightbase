/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MahjongCsView } from "@/components/mahjong/MahjongCsView";
import { DartsLeagueView } from "@/components/darts/DartsLeagueView";

// CS タブ以外の中身はこのテストの対象外（通信を増やさないよう空にする）
jest.mock("@/components/darts/DartsLeagueBoard", () => ({ DartsLeagueBoard: () => null }));
jest.mock("@/components/darts/DartsJoinTab", () => ({ DartsJoinTab: () => null }));
jest.mock("@/components/darts/DartsReportTab", () => ({ DartsReportTab: () => null }));
jest.mock("@/components/darts/DartsRulesTab", () => ({ DartsRulesTab: () => null }));

// pokerCsView.test.tsx と同じく、ネットワーク境界だけを fetch のモックで固定し、表示と操作は実コンポーネントを使う。
const player = (name: string, isMe = false, points: number | null = null, rank: number | null = null) =>
  ({ displayName: name, pictureUrl: "", points, rank, seed: false, isMe });
const event = (over: Record<string, unknown> = {}) => ({
  csEventId: "cs1", seasonId: "s1", name: "ダーツCS", eventDate: "2099-12-01", status: "running", capacity: 6,
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
    url === "/api/darts/cs" ? { event: ev, entered: ev != null } : { success: true } })) as jest.Mock;
};

afterEach(() => jest.restoreAllMocks());

test("ダーツのリーグ画面の CS タブは共通のCS画面で /api/darts/cs を読む", async () => {
  mockGet(event());
  render(<DartsLeagueView />);
  fireEvent.click(await screen.findByRole("tab", { name: "CS" }));
  expect(await screen.findByText("ダーツCS")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/darts/cs", expect.anything());
  expect(await screen.findByRole("button", { name: "結果を申告" })).toBeInTheDocument();
});

test("受付中は「参加する」が出て、/api/darts/cs/entry に送る", async () => {
  mockGet(event({ status: "entry", myEntry: null, rounds: [],
    entryOpensAt: "2000-01-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00" }));
  render(<MahjongCsView game="darts" />);
  fireEvent.click(await screen.findByRole("button", { name: "参加する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/darts/cs/entry", expect.objectContaining({ method: "POST" })));
});

test("申告欄は「カウントアップの点数」で、単位は「点」。確認をはさんで /api/darts/cs/match に送る", async () => {
  mockGet(event());
  render(<MahjongCsView game="darts" />);
  fireEvent.click(await screen.findByRole("button", { name: "結果を申告" }));
  expect(screen.queryByText("最終持ち点")).toBeNull();
  expect(screen.queryByText(/チップ/)).toBeNull();
  const input = screen.getByLabelText("カウントアップの点数");
  expect(input.parentElement).toHaveTextContent(/^点$/);
  fireEvent.change(input, { target: { value: "1180" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  expect(screen.getByText("1,180点で申告します。よろしいですか？")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/darts/cs/match", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ csEventId: "cs1", matchId: "F", points: 1180, expectedStatus: "reporting" }),
  })));
});

test("追加スローの対象のときだけ「追加スローを申告」が出て、同じ API に points で送る", async () => {
  const ev = event();
  firstMatch(ev).status = "tiebreak";
  firstMatch(ev).tiebreakMine = true;
  firstMatch(ev).players = [player("自分", true, 500), player("相手1", false, 500), player("相手2", false, 100)];
  mockGet(ev);
  render(<MahjongCsView game="darts" />);
  fireEvent.click(await screen.findByRole("button", { name: "追加スローを申告" }));
  fireEvent.change(screen.getByLabelText("追加スローの点数"), { target: { value: "60" } });
  fireEvent.click(screen.getByRole("button", { name: "確認へ進む" }));
  expect(screen.getByText("追加スローの60点で申告します。よろしいですか？")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/darts/cs/match", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ csEventId: "cs1", matchId: "F", points: 60, expectedStatus: "tiebreak" }),
  })));
});

test("追加スローの対象でない人には「追加スロー待ち」を出し、申告ボタンは出さない", async () => {
  const ev = event();
  firstMatch(ev).status = "tiebreak";
  firstMatch(ev).players = [player("自分", true, 10), player("相手1", false, 500), player("相手2", false, 500)];
  mockGet(ev);
  render(<MahjongCsView game="darts" />);
  expect((await screen.findAllByText("追加スロー待ち")).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /申告/ })).toBeNull();
});

test("終了後は podium の金銀銅を出す（単位は点）", async () => {
  const done = event({ status: "finished",
    podium: { gold: { displayName: "相手1", pictureUrl: "" }, silver: { displayName: "自分", pictureUrl: "" }, bronze: { displayName: "相手2", pictureUrl: "" } } });
  const m = firstMatch(done);
  m.status = "completed";
  m.players = [player("相手1", false, 900, 1), player("自分", true, 700, 2), player("相手2", false, 500, 3)];
  mockGet(done);
  render(<MahjongCsView game="darts" />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  expect(within(podium).getByText("決勝 900点")).toBeInTheDocument();
  expect(within(podium).getByText("700点")).toBeInTheDocument();
  expect(within(podium).queryByText(/チップ/)).toBeNull();
});

test("旧形式（capacity なし）のダーツは申告ボタンを出さない", async () => {
  mockGet(event({ capacity: null, status: "running" }));
  render(<MahjongCsView game="darts" />);
  expect(await screen.findByText("ダーツCS")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "結果を申告" })).toBeNull();
});
