/** @jest-environment jsdom */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SeasonPokerCsPage from "@/app/admin/games/seasons/[seasonId]/poker-cs/page";
import type { MahjongCsEvent } from "@/types";

jest.mock("next/navigation", () => ({ useParams: () => ({ seasonId: "s1" }) }));

const running = (): MahjongCsEvent => ({
  csEventId: "cs1", seasonId: "s1", name: "ポーカーCS", eventDate: "2099-12-01", status: "running", capacity: 5,
  priorityUserIds: ["a"], entries: [], entrants: ["a", "b", "c"].map((id, i) => ({ lineUserId: id, displayName: `選手${id}`, tier: "P1", rank: i + 1, seed: false })),
  rounds: [{ type: "final", label: "決勝", advanceCount: 3, matches: [{ matchId: "F", label: "決勝卓", status: "tiebreak", advanceCount: 3,
    players: ["a", "b", "c"].map((id) => ({ lineUserId: id, displayName: `選手${id}`, points: 10, rank: 1 })),
    seats: ["a", "b", "c"].map((id) => ({ kind: "player" as const, lineUserId: id })) }] }],
  createdAt: "2099-11-01T00:00:00Z", updatedAt: "",
});

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ events: [running()], activeSeasonId: "s1", priorityPreviewCount: 8 }) })) as jest.Mock;
});

test("ポーカーのCS管理は /api/admin/poker/cs を読む", async () => {
  render(<SeasonPokerCsPage />);
  expect(await screen.findByText("ポーカーCS")).toBeInTheDocument();
  expect(fetch).toHaveBeenCalledWith("/api/admin/poker/cs?seasonId=s1", expect.anything());
});

test("追加ハンド待ちの卓は「追加ハンド待ち」と出る", async () => {
  render(<SeasonPokerCsPage />);
  expect(await screen.findByText("追加ハンド待ち")).toBeInTheDocument();
});

// 保存ボタンの文言は麻雀の MatchResultModal と同じ「確定」。
test("結果入力はチップだけを入れ、/api/admin/poker/cs/cs1/fix に送る", async () => {
  render(<SeasonPokerCsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "結果入力" }));
  expect(screen.queryByText(/100,000点/)).toBeNull();
  for (const [i, v] of ["30", "20", "10"].entries()) {
    fireEvent.change(screen.getAllByLabelText(/チップ/)[i], { target: { value: v } });
  }
  fireEvent.click(screen.getByRole("button", { name: "確定" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/poker/cs/cs1/fix", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ action: "editMatch", matchId: "F", results: [
      { lineUserId: "a", points: 30 }, { lineUserId: "b", points: 20 }, { lineUserId: "c", points: 10 }] }),
  })));
});

test("同点で 400 が返ったら追加ハンドの入力欄が出て、値を tiebreakPoints で送る", async () => {
  global.fetch = jest.fn(async (url: string, options?: RequestInit) => {
    if (String(url).endsWith("/fix")) {
      const body = JSON.parse(String(options?.body));
      const withTiebreak = body.results.every((r: { tiebreakPoints?: number[] }) => r.tiebreakPoints);
      return withTiebreak
        ? { ok: true, status: 200, json: async () => ({ success: true }) }
        : { ok: false, status: 400, json: async () => ({ error: "通過の境目が同点です。追加ハンドの結果も入力してください" }) };
    }
    return { ok: true, json: async () => ({ events: [running()], activeSeasonId: "s1", priorityPreviewCount: 8 }) };
  }) as jest.Mock;
  render(<SeasonPokerCsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "結果入力" }));
  expect(screen.queryByLabelText(/追加ハンド/)).toBeNull();
  for (const input of screen.getAllByLabelText(/チップ/)) fireEvent.change(input, { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "確定" }));
  expect(await screen.findByText(/通過の境目が同点です/)).toBeInTheDocument();
  const tiebreaks = screen.getAllByLabelText(/追加ハンド/);
  expect(tiebreaks).toHaveLength(3);
  for (const [i, v] of ["3", "2", "1"].entries()) fireEvent.change(tiebreaks[i], { target: { value: v } });
  fireEvent.click(screen.getByRole("button", { name: "確定" }));
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/admin/poker/cs/cs1/fix", expect.objectContaining({
    body: JSON.stringify({ action: "editMatch", matchId: "F", results: [
      { lineUserId: "a", points: 10, tiebreakPoints: [3] },
      { lineUserId: "b", points: 10, tiebreakPoints: [2] },
      { lineUserId: "c", points: 10, tiebreakPoints: [1] }] }),
  })));
});

test("作成フォームの優先枠の説明は P1・P2", async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ events: [], activeSeasonId: "s1", priorityPreviewCount: 8 }) })) as jest.Mock;
  render(<SeasonPokerCsPage />);
  expect(await screen.findByText(/優先枠 P1・P2：8名/)).toBeInTheDocument();
});
