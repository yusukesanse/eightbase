/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom";
jest.mock("next/navigation", () => ({ useParams: () => ({ seasonId: "S1" }) }));
jest.mock("@/components/ui/MonthCalendar", () => ({ __esModule: true, default: ({ onSelect }: { onSelect: (date: string) => void }) => <button onClick={() => onSelect("2026-10-02")}>日付を選ぶ</button> }));
import GameScheduleCalendar from "@/components/admin/GameScheduleCalendar";
const fetchMock = jest.fn();
let scheduled: boolean;
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-25T00:00:00Z"));
  Element.prototype.scrollIntoView = jest.fn();
  scheduled = false;
  global.fetch = fetchMock;
  fetchMock.mockReset().mockImplementation(async (url: string, options?: RequestInit) => ({ ok: true, json: async () =>
    options?.method === "PATCH" ? JSON.parse(options.body as string) :
    url.includes("scoreboard/seasons") ? { seasons: [{ seasonId: "S1", startDate: "2026-10-01", endDate: "2026-10-31" }] } :
    url.includes("games/schedule") ? { dates: scheduled ? ["2026-10-02"] : [], times: { "2026-10-02": { startTime: "12:00", endTime: "13:00", overridden: true } }, startTime: "09:00", endTime: "10:00", entryFee: 3000 } :
    { participants: [], counts: { total: 0, paid: 0, refundable: 0 } }
  }));
});
afterEach(() => { cleanup(); jest.useRealTimers(); });
const chooseTime = (name: string, value: string) => {
  const trigger = screen.getByRole("button", { name });
  fireEvent.click(trigger);
  const options = within(trigger.parentElement!).getAllByRole("button", { name: value });
  fireEvent.click(options[options.length - 1]);
};
describe.each(["mahjong", "darts", "billiards", "poker"] as const)("%s", (game) => {
  test("時刻未入力の単日・一括登録は無効", async () => {
    render(<GameScheduleCalendar gameCategory={game} />);
    fireEvent.click(await screen.findByText("日付を選ぶ"));
    expect(screen.getByRole("button", { name: "一括登録" })).toBeDisabled();
    expect(screen.getByText("この日を開催日にする")).toBeDisabled();
  });
  test("一括登録の上書き注意文を表示", async () => {
    render(<GameScheduleCalendar gameCategory={game} />);
    await screen.findByText("日付を選ぶ");
    expect(screen.getByText("登録済みの日の時刻も上書きされます（明日以降の日のみ。今日と過去の日は変わりません。ダーツ・ビリヤード・ポーカーは開始時刻が参加の受付締切です）")).toBeInTheDocument();
  });
  test.each([false, true])("bulk=%s: 片方未入力・同時刻・逆転は無効、入力時刻をPOST", async (bulk) => {
    render(<GameScheduleCalendar gameCategory={game} />);
    fireEvent.click(await screen.findByText("日付を選ぶ"));
    const prefix = bulk ? "一括登録" : "単日追加";
    const submit = screen.getByRole("button", { name: bulk ? "一括登録" : "この日を開催日にする" });
    chooseTime(`${prefix}の開始時刻`, "18:00");
    expect(submit).toBeDisabled();
    chooseTime(`${prefix}の終了時刻`, "18:00");
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "18:00" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "17:00" }));
    expect(submit).toBeDisabled();
    chooseTime("17:00", "21:00");
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/games/schedule", expect.objectContaining({ method: "POST" })));
    const body = JSON.parse(fetchMock.mock.calls.find(([, options]) => options?.method === "POST")![1].body);
    expect(body).toMatchObject({ gameCategory: game, seasonId: "S1", startTime: "18:00", endTime: "21:00", ...(bulk ? { bulk: true } : { date: "2026-10-02" }) });
    if (game === "mahjong") expect(body.entryFee).toBe(3000);
  });
  test("既定に戻す・既定比較を廃止し、個別の時刻保存は残す", async () => {
    scheduled = true;
    render(<GameScheduleCalendar gameCategory={game} />);
    fireEvent.click(await screen.findByText("日付を選ぶ"));
    expect(screen.queryByRole("button", { name: /既定に戻す/ })).not.toBeInTheDocument();
    expect(screen.queryByText("既定と異なる")).not.toBeInTheDocument();
    chooseTime("12:00", "11:00");
    fireEvent.click(screen.getByText("この日の時刻を保存"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/games/schedule", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ gameCategory: game, seasonId: "S1", date: "2026-10-02", startTime: "11:00", endTime: "13:00" }) })));
  });
});
