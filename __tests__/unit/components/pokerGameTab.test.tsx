/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// next/font はビルド時の変換が前提なので、jest では変数名だけ返す。
jest.mock("next/font/google", () => ({ Chakra_Petch: () => ({ variable: "pk-num-font", className: "pk-num-font" }) }));

import { PokerGameTab } from "@/components/poker/PokerGameTab";

// ネットワーク境界（/api/poker/day）だけを固定し、表示と操作は実コンポーネントを使う。
const person = (name: string, isMe = false, paid = true) => ({ displayName: name, pictureUrl: "", isMe, paid });
const player = (name: string, isMe: boolean, chips: number | null, id?: string) =>
  ({ ...(id ? { lineUserId: id, chips } : {}), displayName: name, isMe, reported: chips !== null });
const game = (over: Record<string, unknown> = {}) => ({
  gameIndex: 1, status: "playing", dealerName: "相手", iAmDealer: false, iAmPlayer: true,
  startedAt: new Date(Date.now() - 60_000).toISOString(), durationMin: 30, players: [],
  reportedCount: 0, total: 3, myReported: false, myChips: null, maxChips: 30000, ...over,
});
const day = (over: Record<string, unknown> = {}) => ({
  started: false, finished: false, phase: "dealerSelect", eventDate: "2026-07-04", minParticipants: 3,
  paidCount: 3, entryCount: 3, iAmPaid: true, iAmParticipant: true,
  participants: [person("自分", true), person("相手"), person("三人目")],
  gamesPlayed: 0, currentGame: null, results: [], iCanFinishDay: false, ...over,
});
const mockDay = (d: unknown) => {
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => ({
    ok: true,
    json: async () => (init?.method === "POST" ? { success: true } : d),
  })) as jest.Mock;
};
const posts = (path: string) =>
  (fetch as jest.Mock).mock.calls.filter(([url, init]) => url === `/api/poker/day/${path}` && init?.method === "POST");
const gets = () => (fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith("/api/poker/day?"));
const show = () => render(<PokerGameTab onChanged={() => {}} />);

afterEach(() => jest.restoreAllMocks());

describe("ディーラー選び", () => {
  test("押せるのは自分の名前だけ。確認して「はい」でディーラーになる", async () => {
    mockDay(day());
    show();
    const me = await screen.findByRole("button", { name: /自分/ });
    expect(screen.getByText("相手")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /相手/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /三人目/ })).toBeNull();

    fireEvent.click(me);
    expect(posts("dealer")).toHaveLength(0);
    expect(screen.getByText("ディーラーをします。宜しいですか？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "はい" }));
    await waitFor(() => expect(posts("dealer")).toHaveLength(1));
  });

  test("「いいえ」なら送らない", async () => {
    mockDay(day());
    show();
    fireEvent.click(await screen.findByRole("button", { name: /自分/ }));
    fireEvent.click(screen.getByRole("button", { name: "いいえ" }));
    expect(screen.queryByText("ディーラーをします。宜しいですか？")).toBeNull();
    expect(posts("dealer")).toHaveLength(0);
  });

  test("自分が未払いなら自分の名前も押せない", async () => {
    mockDay(day({ iAmPaid: false, paidCount: 3, entryCount: 4, participants: [person("自分", true, false), person("相手"), person("三人目"), person("四人目")] }));
    show();
    expect(await screen.findByText("お支払い後にディーラーになれます")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /自分/ })).toBeNull();
  });

  test("確定済みの試合があれば「ここまでの合計」を出す", async () => {
    mockDay(day({ gamesPlayed: 1, results: [
      { displayName: "相手", pictureUrl: "", isMe: false, totalChips: 15000, rank: 1, games: [{ gameIndex: 1, chips: 15000 }] },
      { displayName: "自分", pictureUrl: "", isMe: true, totalChips: 10000, rank: 2, games: [{ gameIndex: 1, chips: 10000 }] },
    ] }));
    show();
    const panel = (await screen.findByText("ここまでの合計")).closest("section")!;
    expect(within(panel).getByText("15,000")).toBeInTheDocument();
    expect(within(panel).getByText("10,000")).toBeInTheDocument();
  });
});

describe("開始待ち", () => {
  const ready = (over: Record<string, unknown> = {}) =>
    day({ started: true, phase: "ready", gamesPlayed: 1, currentGame: game({ gameIndex: 2, status: "ready", startedAt: null }), ...over });

  test("終了できる人にだけ「本日のリーグ戦を終了する」が出て、確認して finishDay つきで送る", async () => {
    mockDay(ready({ iCanFinishDay: true }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "本日のリーグ戦を終了する" }));
    expect(screen.getByText("本日のリーグ戦を終了します。宜しいですか？")).toBeInTheDocument();
    expect(posts("confirm")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "はい" }));
    await waitFor(() => expect(posts("confirm")).toHaveLength(1));
    expect(JSON.parse(posts("confirm")[0][1].body).finishDay).toBe(true);
  });

  test("それ以外の人には出ない", async () => {
    mockDay(ready());
    show();
    expect(await screen.findByText("開始を待っています")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "本日のリーグ戦を終了する" })).toBeNull();
  });
});

describe("プレイ中（タイマー）", () => {
  test("ディーラーにだけ「ゲーム終了」が出て、0枚の確認で「はい」を押すと終了する", async () => {
    mockDay(day({ started: true, phase: "playing", currentGame: game({ iAmDealer: true, dealerName: "自分" }) }));
    show();
    expect(await screen.findByRole("timer")).toHaveTextContent("29:00");
    fireEvent.click(screen.getByRole("button", { name: "ゲーム終了" }));
    expect(screen.getByText("誰かのチップが0になりましたか？")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "いいえ" }));
    expect(posts("end")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "ゲーム終了" }));
    fireEvent.click(screen.getByRole("button", { name: "はい" }));
    await waitFor(() => expect(posts("end")).toHaveLength(1));
  });

  test("ディーラー以外には「ゲーム終了」が出ない（タイマーは出る）", async () => {
    mockDay(day({ started: true, phase: "playing", currentGame: game() }));
    show();
    expect(await screen.findByRole("timer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ゲーム終了" })).toBeNull();
  });

  test("残り0になったら1回だけ読み直す（端末の時計が進んでいても連打しない）", async () => {
    mockDay(day({ started: true, phase: "playing", currentGame: game({ startedAt: new Date(Date.now() - 31 * 60_000).toISOString() }) }));
    show();
    expect(await screen.findByRole("timer")).toHaveTextContent("00:00");
    await waitFor(() => expect(gets()).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 1200));
    expect(gets()).toHaveLength(2);
  });
});

describe("チップ入力と確定", () => {
  const players = (c: number | null) => [player("自分", true, 10000, "me"), player("相手", false, 15000, "b"), player("三人目", false, c, "c")];
  const reporting = (c: number | null, over: Record<string, unknown> = {}) =>
    day({ started: true, phase: "reporting", currentGame: game({
      status: "reporting", iAmDealer: true, dealerName: "自分", players: players(c),
      reportedCount: c === null ? 2 : 3, myReported: true, myChips: 10000, ...over,
    }) });

  test("全員そろうまで確定ボタンは押せず、未入力の人には「代わりに入力」が出る", async () => {
    mockDay(reporting(null));
    show();
    expect(await screen.findByRole("button", { name: "確定して次の試合へ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "確定してリーグ戦を終了" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "代わりに入力" }));
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "00" }));
    fireEvent.click(screen.getByRole("button", { name: "入力する" }));
    await waitFor(() => expect(posts("report")).toHaveLength(1));
    expect(JSON.parse(posts("report")[0][1].body)).toMatchObject({ chips: 500, targetUserId: "c" });
  });

  test("全員そろったら「確定して次の試合へ」で確定する（finishDay なし）", async () => {
    mockDay(reporting(5000));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "確定して次の試合へ" }));
    await waitFor(() => expect(posts("confirm")).toHaveLength(1));
    expect(JSON.parse(posts("confirm")[0][1].body).finishDay).toBeFalsy();
  });

  test("「確定してリーグ戦を終了」は確認をはさみ、finishDay つきで送る", async () => {
    mockDay(reporting(5000));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "確定してリーグ戦を終了" }));
    expect(screen.getByText("本日のリーグ戦を終了します。宜しいですか？")).toBeInTheDocument();
    expect(posts("confirm")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "はい" }));
    await waitFor(() => expect(posts("confirm")).toHaveLength(1));
    expect(JSON.parse(posts("confirm")[0][1].body).finishDay).toBe(true);
  });

  test("ディーラー以外には確定ボタンが出ない。自分のチップは数字ボタンで入れる", async () => {
    mockDay(day({ started: true, phase: "reporting", currentGame: game({
      status: "reporting", players: [player("自分", true, null), player("相手", false, 15000), player("三人目", false, null)], reportedCount: 1,
    }) }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    fireEvent.click(screen.getByRole("button", { name: "00" }));
    fireEvent.click(screen.getByRole("button", { name: "0" }));
    expect(screen.getByLabelText("チップ数")).toHaveValue("12,000");
    fireEvent.click(screen.getByRole("button", { name: "入力する" }));
    await waitFor(() => expect(posts("report")).toHaveLength(1));
    expect(JSON.parse(posts("report")[0][1].body)).toEqual({ eventDate: expect.any(String), chips: 12000 });
    expect(screen.queryByRole("button", { name: "確定して次の試合へ" })).toBeNull();
    expect(screen.getByText("1/3人")).toBeInTheDocument();
  });

  test("上限を超える値は「入力する」を押せず、上限の文言が出る（自分の入力）", async () => {
    mockDay(day({ started: true, phase: "reporting", currentGame: game({ status: "reporting" }) }));
    show();
    fireEvent.change(await screen.findByLabelText("チップ数"), { target: { value: "30001" } });
    expect(screen.getByRole("button", { name: "入力する" })).toBeDisabled();
    expect(screen.getByText("30,000枚までです")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("チップ数"), { target: { value: "30000" } });
    expect(screen.getByRole("button", { name: "入力する" })).toBeEnabled();
    expect(screen.queryByText("30,000枚までです")).toBeNull();
  });

  test("上限を超える値は「入力する」を押せない（代わりの入力）", async () => {
    mockDay(reporting(null));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "代わりに入力" }));
    fireEvent.change(screen.getByLabelText("チップ数"), { target: { value: "30001" } });
    expect(screen.getByRole("button", { name: "入力する" })).toBeDisabled();
    expect(screen.getByText("30,000枚までです")).toBeInTheDocument();
  });

  test("入力済みなら「入力し直す」で直せる", async () => {
    mockDay(day({ started: true, phase: "reporting", currentGame: game({ status: "reporting", myReported: true, myChips: 12000, reportedCount: 1 }) }));
    show();
    expect(await screen.findByText("入力済み ・ 12,000 枚")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "入力し直す" }));
    expect(screen.getByLabelText("チップ数")).toHaveValue("12,000");
  });
});

describe("本日終了・参加者以外", () => {
  test("本日終了は表彰台と合計を出し、注記を残す", async () => {
    mockDay(day({ started: true, finished: true, phase: "finished", gamesPlayed: 2, results: [
      { displayName: "相手", pictureUrl: "", isMe: false, totalChips: 25000, rank: 1, games: [{ gameIndex: 1, chips: 15000 }, { gameIndex: 2, chips: 10000 }] },
      { displayName: "自分", pictureUrl: "", isMe: true, totalChips: 22000, rank: 2, games: [{ gameIndex: 1, chips: 10000 }, { gameIndex: 2, chips: 12000 }] },
      { displayName: "三人目", pictureUrl: "", isMe: false, totalChips: 13000, rank: 3, games: [{ gameIndex: 1, chips: 5000 }, { gameIndex: 2, chips: 8000 }] },
    ] }));
    show();
    expect(await screen.findByText("本日のリーグ戦は終了しました")).toBeInTheDocument();
    expect(screen.getByText("15,000 ＋ 10,000")).toBeInTheDocument();
    expect(screen.getAllByText("25,000").length).toBeGreaterThan(0);
    expect(screen.getByText(/本日の対局はすべて終了しました/)).toBeInTheDocument();
  });

  test("直前の試合のディーラーは、ディーラー選びの画面から本日終了にできる", async () => {
    mockDay(day({ gamesPlayed: 1, iCanFinishDay: true }));
    show();
    fireEvent.click(await screen.findByRole("button", { name: "本日のリーグ戦を終了する" }));
    fireEvent.click(screen.getByRole("button", { name: "はい" }));
    await waitFor(() => expect(posts("confirm")).toHaveLength(1));
    expect(JSON.parse(posts("confirm")[0][1].body).finishDay).toBe(true);
  });

  test("参加者以外には進行の画面を出さない", async () => {
    mockDay(day({ iAmParticipant: false }));
    show();
    expect(await screen.findByText("参加当日に表示されます")).toBeInTheDocument();
    expect(screen.queryByText("ディーラーを決めます")).toBeNull();
  });
});
