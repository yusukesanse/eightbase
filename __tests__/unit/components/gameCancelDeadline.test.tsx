/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DartsJoinTab } from "@/components/darts/DartsJoinTab";
import { BilliardsJoinTab } from "@/components/billiards/BilliardsJoinTab";
import { PokerJoinTab } from "@/components/poker/PokerJoinTab";
jest.mock("@/components/ui/MonthCalendar", () => ({ __esModule: true, default: ({ onSelect }: { onSelect: (date: string) => void }) =>
  <>{["2026-09-24", "2026-09-25", "2026-09-26"].map(date => <button key={date} onClick={() => onSelect(date)}>{date}</button>)}</> }));
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date("2026-09-24T15:00:00Z")); // JST当日0時
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ entries: [], standings: [] }) });
});
afterEach(() => { cleanup(); jest.useRealTimers(); });
describe.each([DartsJoinTab, BilliardsJoinTab, PokerJoinTab])("%p キャンセル期限", Tab => {
  test.each(["2026-09-24", "2026-09-25", "2026-09-26"])("開催日%sは前日までだけボタン表示", async date => {
    render(<Tab enteredDates={new Set([date])} scheduleDates={new Set([date])} cancelledDates={new Set()} paymentRequired paymentStatusByDate={{ [date]: "paid" }} onChanged={() => {}} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: date })); });
    const button = screen.queryByRole("button", { name: /支払いをキャンセル/ });
    if (date === "2026-09-26") expect(button).toBeInTheDocument();
    else expect(button).not.toBeInTheDocument();
  });
});
