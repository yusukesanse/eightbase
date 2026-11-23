/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SeasonDartsCsPage from "@/app/admin/games/seasons/[seasonId]/darts-cs/page";
import type { MahjongCsEvent } from "@/types";

jest.mock("next/navigation", () => ({ useParams: () => ({ seasonId: "s1" }) }));

const running = (status: "reporting" | "tiebreak" = "tiebreak"): MahjongCsEvent => ({
  csEventId: "cs1", seasonId: "s1", name: "ダーツCS", eventDate: "2099-12-01", status: "running", capacity: 5,
  priorityUserIds: ["a"], entries: [], entrants: ["a", "b", "c"].map((id, i) => ({ lineUserId: id, displayName: `選手${id}`, tier: "D1", rank: i + 1, seed: false })),
  rounds: [{ type: "final", label: "決勝", advanceCount: 3, matches: [{ matchId: "F", label: "決勝卓", status, advanceCount: 3,
    players: ["a", "b", "c"].map((id) => ({ lineUserId: id, displayName: `選手${id}`, points: 10, rank: 1 })),
    seats: ["a", "b", "c"].map((id) => ({ kind: "player" as const, lineUserId: id })) }] }],
  createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
});
const mockList = (events: unknown[]) => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ events, activeSeasonId: "s1", priorityPreviewCount: 8 }) })) as jest.Mock;
};

test("ダーツのCS管理は /api/admin/darts/cs を読み、追加スロー待ちの卓は「追加スロー待ち」と出る", async () => {
  mockList([running()]);
  render(<SeasonDartsCsPage />);
  expect(await screen.findByText("ダーツCS")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/admin/darts/cs?seasonId=s1", expect.anything());
  expect(screen.getByText("追加スロー待ち")).toBeInTheDocument();
});

test("結果入力は点数だけを入れ、/api/admin/darts/cs/cs1/fix に送る", async () => {
  mockList([running("reporting")]);
  render(<SeasonDartsCsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "結果入力" }));
  expect(screen.queryByText(/100,000点/)).toBeNull();
  for (const [i, v] of ["900", "700", "500"].entries()) {
    fireEvent.change(screen.getAllByLabelText(/の点数/)[i], { target: { value: v } });
  }
  fireEvent.click(screen.getByRole("button", { name: "確定" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/darts/cs/cs1/fix", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ action: "editMatch", matchId: "F", results: [
      { lineUserId: "a", points: 900 }, { lineUserId: "b", points: 700 }, { lineUserId: "c", points: 500 }] }),
  })));
});

test("作成フォームの優先枠の説明は D1・D2", async () => {
  mockList([]);
  render(<SeasonDartsCsPage />);
  expect(await screen.findByText(/優先枠 D1・D2：8名/)).toBeInTheDocument();
});

test("旧形式のダーツCSは score だけの選手も点数つきで出て undefined にならない", async () => {
  const legacy = { ...running(), capacity: undefined, status: "finished" as const };
  legacy.rounds[0].matches[0].status = "completed";
  legacy.rounds[0].matches[0].players = [
    { lineUserId: "a", displayName: "選手a", rank: 1, score: 1200 },
    { lineUserId: "b", displayName: "選手b", rank: 2 },
  ] as unknown as typeof legacy.rounds[0]["matches"][0]["players"];
  mockList([legacy]);
  render(<SeasonDartsCsPage />);
  expect(await screen.findByText("1位 / 1,200")).toBeInTheDocument();
  expect(screen.getByText("2位")).toBeInTheDocument();
  expect(screen.queryByText(/undefined/)).toBeNull();
});
