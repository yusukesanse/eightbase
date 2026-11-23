/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import SeasonBilliardsCsPage from "@/app/admin/games/seasons/[seasonId]/billiards-cs/page";
import type { MahjongCsEvent } from "@/types";

jest.mock("next/navigation", () => ({ useParams: () => ({ seasonId: "s1" }) }));

const running = (over: Record<string, unknown> = {}): MahjongCsEvent => ({
  csEventId: "cs1", seasonId: "s1", name: "ビリヤードCS", eventDate: "2099-12-01", status: "running", capacity: 4,
  priorityUserIds: [], entries: [], entrants: ["a", "b"].map((id, i) => ({ lineUserId: id, displayName: `選手${id}`, tier: "B1", rank: i + 1, seed: false })),
  rounds: [{ type: "final", label: "決勝", advanceCount: 1, matches: [{ matchId: "F", label: "決勝卓", status: "reporting", advanceCount: 1,
    players: ["a", "b"].map((id) => ({ lineUserId: id, displayName: `選手${id}`, points: null, rank: null })),
    seats: ["a", "b"].map((id) => ({ kind: "player" as const, lineUserId: id })), ...over }] }],
  createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
});
const mockList = (events: unknown[]) => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ events, activeSeasonId: "s1", priorityPreviewCount: 8 }) })) as jest.Mock;
};

test("ビリヤードのCS管理は /api/admin/billiards/cs を読み、申告が食い違った卓は「確認待ち」と目立たせる", async () => {
  mockList([running({ status: "disputed", claims: { a: "a", b: "b" } })]);
  render(<SeasonBilliardsCsPage />);
  expect(await screen.findByText("ビリヤードCS")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/admin/billiards/cs?seasonId=s1", expect.anything());
  expect(screen.getByText("確認待ち")).toHaveClass("bg-red-50");
});

test("結果入力は勝者を選ぶ形で、/api/admin/billiards/cs/cs1/fix に winnerId を送る（点数の欄は無い）", async () => {
  mockList([running({ status: "disputed", claims: { a: "a", b: "b" } })]);
  render(<SeasonBilliardsCsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "結果入力" }));
  const dialog = screen.getByRole("heading", { name: "決勝卓 の結果入力" }).parentElement as HTMLElement;
  expect(within(dialog).queryByRole("spinbutton")).toBeNull();
  // 2人がそれぞれ誰の勝ちと申告したかが見える
  expect(within(dialog).getByText("選手a の申告: 選手a の勝ち")).toBeInTheDocument();
  expect(within(dialog).getByText("選手b の申告: 選手b の勝ち")).toBeInTheDocument();
  const save = within(dialog).getByRole("button", { name: "確定" });
  expect(save).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("radio", { name: "選手b の勝ち" }));
  fireEvent.click(save);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/billiards/cs/cs1/fix", expect.objectContaining({
    method: "POST", body: JSON.stringify({ action: "editMatch", matchId: "F", winnerId: "b" }),
  })));
});

test("確定した卓は 勝ち・負け で出し、内部の点数（1・0）は出さない", async () => {
  mockList([running({ status: "completed", players: [
    { lineUserId: "a", displayName: "選手a", points: 0, rank: 2 }, { lineUserId: "b", displayName: "選手b", points: 1, rank: 1 }] })]);
  render(<SeasonBilliardsCsPage />);
  expect(await screen.findByText("勝ち")).toBeInTheDocument();
  expect(screen.getByText("負け")).toBeInTheDocument();
  expect(screen.queryByText(/位 \/ /)).toBeNull();
});

test("作成フォームの優先枠の説明は B1・B2", async () => {
  mockList([]);
  render(<SeasonBilliardsCsPage />);
  expect(await screen.findByText(/優先枠 B1・B2：8名/)).toBeInTheDocument();
});

test("旧形式のビリヤードCSは won から 勝ち・負け を出し、操作は削除だけ", async () => {
  const legacy = { ...running(), capacity: undefined, status: "finished" as const, championId: "b" };
  legacy.rounds[0].matches[0].status = "completed";
  legacy.rounds[0].matches[0].players = [
    { lineUserId: "a", displayName: "選手a", won: false, rank: 1 },
    { lineUserId: "b", displayName: "選手b", won: true, rank: 7 },
  ] as unknown as typeof legacy.rounds[0]["matches"][0]["players"];
  mockList([legacy]);
  render(<SeasonBilliardsCsPage />);
  expect(await screen.findByText("勝ち")).toBeInTheDocument();
  expect(screen.getByText("負け")).toBeInTheDocument();
  expect(screen.queryByText(/7位/)).toBeNull();
  expect(screen.queryByRole("button", { name: /結果入力|修正|編成に戻す/ })).toBeNull();
  expect(screen.getByRole("button", { name: "削除" })).toBeInTheDocument();
});
