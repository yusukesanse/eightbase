/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
jest.mock("@/lib/date", () => ({ ...jest.requireActual("@/lib/date"), todayJst: () => "2026-09-25" }));
jest.mock("@/components/mahjong/MahjongRulesTab", () => ({ MahjongRulesTab: () => null }));
jest.mock("next/navigation", () => ({ useParams: () => ({ seasonId: "S1" }) }));
jest.mock("@/hooks/useAutoRefresh", () => ({ useAutoRefresh: () => {} }));
jest.mock("@/components/ui/MonthCalendar", () => ({ __esModule: true, default: ({ onSelect }: { onSelect: (date: string) => void }) => <button onClick={() => onSelect("2026-10-02")}>金曜を選ぶ</button> }));
jest.mock("@/components/admin/MahjongEntryAdminPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/admin/MahjongDayResultForm", () => ({ __esModule: true, default: () => null }));
import GameScheduleCalendar from "@/components/admin/GameScheduleCalendar";
import SeasonMahjongPage from "@/app/admin/games/seasons/[seasonId]/mahjong/page";
import { MahjongLeagueView } from "@/components/mahjong/MahjongLeagueView";
import { JoinTab } from "@/components/mahjong/MahjongJoinTab";
import { PokerJoinTab } from "@/components/poker/PokerJoinTab";
import { DartsJoinTab } from "@/components/darts/DartsJoinTab";
import { BilliardsJoinTab } from "@/components/billiards/BilliardsJoinTab";
import { UserDetailPanel } from "@/app/admin/users/UserDetailPanel";
import type { User } from "@/app/admin/users/types";
let dates: string[];
const fetchMock = jest.fn();
beforeEach(() => {
  dates = ["2026-10-02"];
  global.fetch = fetchMock;
  fetchMock.mockReset().mockImplementation(async (url: string) => ({ ok: true, json: async () =>
    url.includes("scoreboard/seasons") ? { seasons: [{ seasonId: "S1", startDate: "2026-10-01", endDate: "2026-10-31" }] } :
    url.includes("games/schedule") ? { dates, entryFees: { "2026-10-02": 5000 }, times: {}, startTime: "10:00", endTime: "11:00" } :
    { entries: [], standings: [], tables: [], assignments: [], dayStates: [], participants: [], counts: { total: 0, paid: 0, refundable: 0 } }
  }));
});
afterEach(cleanup);
test.each([PokerJoinTab, DartsJoinTab, BilliardsJoinTab])("月制限停止中は説明の括弧書きを出さない", (Tab) => {
  const props = { enteredDates: new Set<string>(), scheduleDates: new Set<string>(), cancelledDates: new Set<string>(), paymentRequired: true, paymentStatusByDate: {}, onChanged: () => {} };
  const { rerender, container } = render(<Tab {...props} monthlyExempt={false} />);
  expect(container.textContent).not.toContain("参加は1か月に1回");
  rerender(<Tab {...props} monthlyExempt />);
  expect(container.textContent).not.toContain("同じ月に何度でも");
});
test("管理ユーザーの免除操作を非表示", () => {
  const noop = () => {};
  render(<UserDetailPanel user={{ displayName: "会員", role: "member" } as User} onClose={noop} onDelete={noop} onReissuePasscode={noop} onSetRole={noop} onToggleActive={noop} onToggleMonthlyExempt={noop} />);
  expect(screen.queryByText("ゲーム参加の月1回制限")).not.toBeInTheDocument();
});
test("麻雀は日程料金を表示し、日程があると土曜固定の説明を出さない", async () => {
  const props = { enteredDates: new Set<string>(), myEntries: {}, closedDates: new Set<string>(), cancelledDates: new Set<string>(), scheduledDates: new Set(["2026-10-02"]), entryFees: new Map([["2026-10-02", 5000]]), paymentRequired: true, onChanged: () => {} };
  render(<JoinTab {...props} />);
  expect(screen.queryByText(/土曜日が開催日です/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("金曜を選ぶ"));
  expect(await screen.findByText("¥5,000")).toBeInTheDocument();
});
test("管理の参加者・卓プルダウンに金曜の日程を表示", async () => {
  const { container } = render(<SeasonMahjongPage />);
  await waitFor(() => expect(container.querySelectorAll('option[value="2026-10-02"]').length).toBe(2));
  expect(container.querySelector('option[value="2026-10-03"]')).toBeNull();
});
test("管理は日程0件だけ土曜にフォールバック", async () => {
  dates = [];
  const { container } = render(<SeasonMahjongPage />);
  await waitFor(() => expect(container.querySelectorAll('option[value="2026-10-03"]').length).toBe(2));
});
test("麻雀の単日・一括入力は無効料金で保存不可、日別PATCH可能", async () => {
  dates = [];
  render(<GameScheduleCalendar gameCategory="mahjong" />);
  await screen.findByText("金曜を選ぶ");
  fireEvent.click(screen.getByRole("button", { name: "一括登録の開始時刻" }));
  fireEvent.click(screen.getByRole("button", { name: "16:00" }));
  fireEvent.click(screen.getByRole("button", { name: "一括登録の終了時刻" }));
  fireEvent.click(screen.getByRole("button", { name: "17:00" }));
  expect(screen.getByText("一括登録")).toBeEnabled();
  const bulkFee = screen.getByLabelText("一括登録の参加費（円）");
  fireEvent.change(bulkFee, { target: { value: "" } });
  expect(screen.getByText("一括登録")).toBeDisabled();
  fireEvent.click(screen.getByText("金曜を選ぶ"));
  fireEvent.click(screen.getByRole("button", { name: "単日追加の開始時刻" }));
  fireEvent.click(screen.getByRole("button", { name: "18:00" }));
  fireEvent.click(screen.getByRole("button", { name: "単日追加の終了時刻" }));
  fireEvent.click(screen.getByRole("button", { name: "21:00" }));
  const fee = screen.getByLabelText("参加費（円）");
  fireEvent.change(fee, { target: { value: "0" } });
  expect(screen.getByText("この日を開催日にする")).toBeDisabled();
  fireEvent.change(fee, { target: { value: "5000" } });
  fireEvent.click(screen.getByText("この日を開催日にする"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/games/schedule", expect.objectContaining({ method: "POST", body: JSON.stringify({ gameCategory: "mahjong", seasonId: "S1", date: "2026-10-02", startTime: "18:00", endTime: "21:00", entryFee: 5000 }) })));
  await screen.findByText("この日の参加費を保存");
  fireEvent.change(screen.getByLabelText("参加費（円）"), { target: { value: "7000" } });
  fireEvent.click(screen.getByText("この日の参加費を保存"));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/games/schedule", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ gameCategory: "mahjong", seasonId: "S1", date: "2026-10-02", entryFee: 7000 }) })));
});
test.each(["darts", "billiards", "poker"] as const)("%s に料金入力を出さない", async (game) => {
  render(<GameScheduleCalendar gameCategory={game} />);
  await screen.findByText("金曜を選ぶ");
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
});

test("既存entryの表示は日程7000より保存額5000を優先", async () => {
  render(<JoinTab enteredDates={new Set(["2026-10-02"])} myEntries={{ "2026-10-02": {
    entryId: "E1", eventDate: "2026-10-02", paymentStatus: null, pendingExpiresAt: null, paymentUrl: null, unpaid: true,
    paymentAmount: 5000,
  } }} closedDates={new Set()} cancelledDates={new Set()} scheduledDates={new Set(["2026-10-02"])} entryFees={new Map([["2026-10-02", 7000]])} paymentRequired onChanged={() => {}} />);
  fireEvent.click(screen.getByText("金曜を選ぶ"));
  expect(await screen.findByText("¥5,000")).toBeInTheDocument();
  expect(screen.queryByText("¥7,000")).not.toBeInTheDocument();
});

test("LeagueViewが日程APIの料金を参加タブまで渡す", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/mahjong/schedule") return { ok: true, json: async () => ({ schedule: [{ date: "2026-10-02", type: "league", entryFee: 5000 }] }) };
    if (url === "/api/mahjong/entries?mine=1") return { ok: true, json: async () => ({ entries: [], paymentRequired: true }) };
    return original(url);
  });
  render(<MahjongLeagueView />);
  fireEvent.click(screen.getByText("参加"));
  fireEvent.click(await screen.findByText("金曜を選ぶ"));
  expect(await screen.findByText("¥5,000")).toBeInTheDocument();
});

test("C: 単日追加後の表示は入力9000でなくサーバーの5000", async () => {
  dates = [];
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === "/api/admin/games/schedule" && options?.method === "POST") return { ok: true, json: async () => ({ success: true, entryFee: 5000 }) };
    return original(url, options);
  });
  render(<GameScheduleCalendar gameCategory="mahjong" />);
  fireEvent.click(await screen.findByText("金曜を選ぶ"));
  fireEvent.change(screen.getByLabelText("参加費（円）"), { target: { value: "9000" } });
  fireEvent.click(screen.getByRole("button", { name: "単日追加の開始時刻" }));
  fireEvent.click(screen.getByRole("button", { name: "18:00" }));
  fireEvent.click(screen.getByRole("button", { name: "単日追加の終了時刻" }));
  fireEvent.click(screen.getByRole("button", { name: "21:00" }));
  fireEvent.click(screen.getByText("この日を開催日にする"));
  expect(await screen.findByText("参加費 ¥5,000")).toBeInTheDocument();
  expect(screen.getByText("参加表明済みの人の金額は変わりません")).toBeInTheDocument();
});
test("D: 日程外の卓がある月・日を両プルダウンで選べる", async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/mahjong/tables?")) return { ok: true, json: async () => ({ tables: [
      { tableId: "T1", eventDate: "2026-10-09", tableLabel: "A", members: [] },
      { tableId: "T2", eventDate: "2026-11-06", tableLabel: "B", members: [] },
    ] }) };
    return original(url);
  });
  const { container } = render(<SeasonMahjongPage />);
  await waitFor(() => expect(container.querySelectorAll('option[value="2026-11"]').length).toBe(2));
  const month = container.querySelector('option[value="2026-10"]')!.parentElement!;
  fireEvent.change(month, { target: { value: "2026-10" } });
  await waitFor(() => expect(container.querySelectorAll('option[value="2026-10-09"]').length).toBe(2));
  expect(container.querySelectorAll('option[value="2026-10-02"]').length).toBe(2);
  fireEvent.change(month, { target: { value: "2026-11" } });
  await waitFor(() => expect(container.querySelectorAll('option[value="2026-11-06"]').length).toBe(2));
});
