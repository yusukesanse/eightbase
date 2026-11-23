/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MahjongCsView } from "@/components/mahjong/MahjongCsView";
import { BilliardsLeagueView } from "@/components/billiards/BilliardsLeagueView";

// CS タブ以外の中身はこのテストの対象外（通信を増やさないよう空にする）
jest.mock("@/components/billiards/BilliardsLeagueBoard", () => ({ BilliardsLeagueBoard: () => null }));
jest.mock("@/components/billiards/BilliardsJoinTab", () => ({ BilliardsJoinTab: () => null }));
jest.mock("@/components/billiards/BilliardsMatchLogTab", () => ({ BilliardsMatchLogTab: () => null }));
jest.mock("@/components/billiards/BilliardsRulesTab", () => ({ BilliardsRulesTab: () => null }));

// dartsCsView.test.tsx と同じく、ネットワーク境界だけを fetch のモックで固定し、表示と操作は実コンポーネントを使う。
const player = (name: string, isMe = false, rank: number | null = null, claimed = false) =>
  ({ displayName: name, pictureUrl: "", points: rank == null ? null : rank === 1 ? 1 : 0, rank, seed: false, isMe, claimed });
const match = (over: Record<string, unknown> = {}) => ({ matchId: "S1", label: "準決勝A卓", status: "reporting", advanceCount: 1,
  pendingSeats: [], tiebreakMine: false, myClaim: null, players: [player("自分", true), player("相手")], ...over });
const event = (matches: unknown[] = [match()], over: Record<string, unknown> = {}) => ({
  csEventId: "cs1", seasonId: "s1", name: "ビリヤードCS", eventDate: "2099-12-01", status: "running", capacity: 4,
  entryOpensAt: null, entryClosesAt: null, confirmedCount: 4, waitlistCount: 0,
  myEntry: { state: "confirmed", waitlistPosition: null }, demoDummy: false, champion: null, podium: null, entrants: [],
  rounds: [
    { type: "prelim", label: "準決勝", advanceCount: 1, matches },
    { type: "third", label: "3位決定戦", advanceCount: 1, matches: [{ matchId: "T", label: "3位決定戦", status: "reporting", advanceCount: 1,
      pendingSeats: ["準決勝A卓 敗者", "準決勝B卓 敗者"], tiebreakMine: false, myClaim: null, players: [] }] },
    { type: "final", label: "決勝", advanceCount: 1, matches: [{ matchId: "F", label: "決勝卓", status: "reporting", advanceCount: 1,
      pendingSeats: ["準決勝A卓 勝者", "準決勝B卓 勝者"], tiebreakMine: false, myClaim: null, players: [] }] },
  ],
  ...over,
});
const mockGet = (ev: unknown) => {
  global.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () =>
    url === "/api/billiards/cs" ? { event: ev, entered: ev != null } : { success: true } })) as jest.Mock;
};
const myTable = () => screen.findByRole("region", { name: "あなたの卓" });

afterEach(() => jest.restoreAllMocks());

test("ビリヤードのリーグ画面の CS タブは共通のCS画面で /api/billiards/cs を読む", async () => {
  mockGet(event());
  render(<BilliardsLeagueView />);
  fireEvent.click(await screen.findByRole("tab", { name: "CS" }));
  expect(await screen.findByText("ビリヤードCS")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/billiards/cs", expect.anything());
  expect(await screen.findByRole("button", { name: "勝敗を申告" })).toBeInTheDocument();
});

test("受付中は「参加する」が出て、/api/billiards/cs/entry に送る", async () => {
  mockGet(event([], { status: "entry", myEntry: null, rounds: [],
    entryOpensAt: "2000-01-01T00:00:00+09:00", entryClosesAt: "2099-11-20T00:00:00+09:00" }));
  render(<MahjongCsView game="billiards" />);
  fireEvent.click(await screen.findByRole("button", { name: "参加する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/billiards/cs/entry", expect.objectContaining({ method: "POST" })));
});

test("申告は「勝ったのは？」に自分か相手のボタンで答える。確認をはさんで /api/billiards/cs/match に送る（点数は入れない）", async () => {
  mockGet(event());
  render(<MahjongCsView game="billiards" />);
  fireEvent.click(await screen.findByRole("button", { name: "勝敗を申告" }));
  expect(screen.getByText("勝ったのは？")).toBeInTheDocument();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByRole("button", { name: "自分（あなた）" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "相手" }));
  expect(screen.getByText("「相手」の勝ちで申告します。よろしいですか？")).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalledWith("/api/billiards/cs/match", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/billiards/cs/match", expect.objectContaining({
    method: "PATCH", body: JSON.stringify({ csEventId: "cs1", matchId: "S1", winner: "opponent", expectedStatus: "reporting" }),
  })));
});

test("自分だけ申告した間は「相手の申告待ち」と出て、出し直せる", async () => {
  mockGet(event([match({ myClaim: "me", players: [player("自分", true, null, true), player("相手")] })]));
  render(<MahjongCsView game="billiards" />);
  const card = await myTable();
  expect(within(card).getByText("申告済み・相手の申告待ち")).toBeInTheDocument();
  expect(within(card).getByRole("button", { name: "申告を修正" })).toBeInTheDocument();
  expect(within(card).getByText("まだ申告していません")).toBeInTheDocument();
});

test("申告が食い違った卓は「確認待ち」と出し、管理者が確認することを伝える。出し直しもできる", async () => {
  mockGet(event([match({ status: "disputed", myClaim: "me", players: [player("自分", true, null, true), player("相手", false, null, true)] })]));
  render(<MahjongCsView game="billiards" />);
  const card = await myTable();
  expect(within(card).getByText("確認待ち")).toBeInTheDocument();
  expect(within(card).getByText("申告が食い違っています。管理者が確認します")).toBeInTheDocument();
  fireEvent.click(within(card).getByRole("button", { name: "申告を出し直す" }));
  fireEvent.click(screen.getByRole("button", { name: "相手" }));
  fireEvent.click(screen.getByRole("button", { name: "申告する" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/billiards/cs/match", expect.objectContaining({
    body: JSON.stringify({ csEventId: "cs1", matchId: "S1", winner: "opponent", expectedStatus: "disputed" }),
  })));
});

test("準決勝は「勝者が決勝へ」（3位決定戦を飛ばす）、3位決定戦は「勝者が3位」、決勝は「勝者が優勝」", async () => {
  mockGet(event([match({ players: [player("別の人"), player("相手")] })]));
  render(<MahjongCsView game="billiards" />);
  expect(await screen.findByText("1卓・勝者が決勝へ")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "3位決定戦" }));
  expect(screen.getByText("1卓・勝者が3位")).toBeInTheDocument();
  expect(screen.getByText("準決勝A卓の敗者を待っています")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: "決勝" }));
  expect(screen.getByText("1卓・勝者が優勝")).toBeInTheDocument();
  expect(screen.getByText("準決勝B卓の勝者を待っています")).toBeInTheDocument();
  expect(screen.queryByText(/位が/)).toBeNull();
});

test("確定した卓は 勝・敗 で出し、内部の点数（1・0）は出さない", async () => {
  mockGet(event([match({ status: "completed", players: [player("別の人", false, 2), player("相手", false, 1)] })]));
  render(<MahjongCsView game="billiards" />);
  // 確定済みのラウンドは最初に開かないので、タブで開く
  fireEvent.click(await screen.findByRole("tab", { name: "✓ 準決勝" }));
  const rows = screen.getByText("相手").closest("[data-cs-row]") as HTMLElement;
  expect(within(rows).getByText("勝")).toBeInTheDocument();
  expect(within(rows).getByText("次のラウンドへ進出")).toBeInTheDocument();
  expect(screen.getByText("敗")).toBeInTheDocument();
});

test("終了後の表彰台は金銀銅を出し、点数は出さない（銅は3位決定戦の勝者）", async () => {
  const done = event([match({ status: "completed", players: [player("自分", true, 1), player("相手", false, 2)] })], { status: "finished",
    champion: { displayName: "自分", pictureUrl: "" },
    podium: { gold: { displayName: "自分", pictureUrl: "" }, silver: { displayName: "決勝の相手", pictureUrl: "" }, bronze: { displayName: "銅の人", pictureUrl: "" } } });
  const rounds = done.rounds as { matches: Record<string, unknown>[] }[];
  rounds[2].matches[0] = { ...rounds[2].matches[0], status: "completed", pendingSeats: [], players: [player("自分", true, 1), player("決勝の相手", false, 2)] };
  rounds[1].matches[0] = { ...rounds[1].matches[0], status: "completed", pendingSeats: [], players: [player("銅の人", false, 1), player("相手", false, 2)] };
  mockGet(done);
  render(<MahjongCsView game="billiards" />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  expect(within(podium).getByText("自分")).toBeInTheDocument();
  expect(within(podium).getByText("決勝の相手")).toBeInTheDocument();
  expect(within(podium).getByText("銅の人")).toBeInTheDocument();
  expect(within(podium).queryByText(/決勝 \d/)).toBeNull();
});

test("旧形式（capacity なし）のビリヤードは申告ボタンを出さず、参加受付をしていないと伝える", async () => {
  mockGet(event([match()], { capacity: null, status: "setup" }));
  render(<MahjongCsView game="billiards" />);
  expect(await screen.findByText("このCSは旧形式のため参加受付をしていません")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /申告/ })).toBeNull();
});

// ---- レビュー指摘 ----

const withFinal = (thirdDone: boolean) => {
  const ev = event([match({ status: "completed", loserAdvances: true, players: [player("自分", true, 1), player("相手", false, 2)] })]);
  const rounds = ev.rounds as { matches: Record<string, unknown>[] }[];
  rounds[2].matches[0] = { ...rounds[2].matches[0], status: "completed", pendingSeats: [], players: [player("自分", true, 1), player("決勝の相手", false, 2)] };
  rounds[1].matches[0] = { ...rounds[1].matches[0], pendingSeats: [],
    ...(thirdDone ? { status: "completed", players: [player("銅の人", false, 1), player("相手", false, 2)] }
      : { players: [player("銅の人"), player("相手")] }) };
  // 終了すると（両方確定）サーバーが podium を返す
  if (thirdDone) Object.assign(ev, { status: "finished", podium: {
    gold: { displayName: "自分", pictureUrl: "" }, silver: { displayName: "決勝の相手", pictureUrl: "" }, bronze: { displayName: "銅の人", pictureUrl: "" } } });
  return ev;
};

test("決勝が先に確定しても、3位決定戦が確定するまで表彰台は出さない", async () => {
  mockGet(withFinal(false));
  render(<MahjongCsView game="billiards" />);
  expect(await screen.findByText("ビリヤードCS")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "表彰台" })).toBeNull();
});

test("決勝と3位決定戦の両方が確定すると、表彰台に金銀銅が出る", async () => {
  mockGet(withFinal(true));
  render(<MahjongCsView game="billiards" />);
  const podium = await screen.findByRole("region", { name: "表彰台" });
  for (const name of ["自分", "決勝の相手", "銅の人"]) expect(within(podium).getByText(name)).toBeInTheDocument();
});

test("準決勝の敗者は、3位決定戦へ進む卓なら確定後の行に「3位決定戦へ」と出る", async () => {
  mockGet(withFinal(false));
  render(<MahjongCsView game="billiards" />);
  fireEvent.click(await screen.findByRole("tab", { name: "✓ 準決勝" }));
  const panel = screen.getByRole("tabpanel");
  const loser = within(panel).getByText("相手").closest("[data-cs-row]") as HTMLElement;
  expect(within(loser).getByText("3位決定戦へ")).toBeInTheDocument();
  const winnerRow = within(panel).getByText("自分").closest("[data-cs-row]") as HTMLElement;
  expect(within(winnerRow).queryByText("3位決定戦へ")).toBeNull();
});
