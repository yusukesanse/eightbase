/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("@/app/admin/calendars/TermsEditor", () => ({ TermsEditor: () => null }));
import CalendarsPage from "@/app/admin/calendars/page";
import AdminNotificationsPage from "@/app/admin/notifications/page";

const originalFetch = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => { global.fetch = mockFetch; mockFetch.mockReset(); });
afterEach(() => { cleanup(); global.fetch = originalFetch; });

test("not_found explains both missing calendar and missing sharing", async () => {
  mockFetch.mockImplementation(async (url: string) => ({ ok: true, json: async () =>
    url.endsWith("calendar-check") ? { ok: false, errorKind: "not_found" } : {
      facilities: [{ id: "room", name: "Room", type: "booth", capacity: 1, calendarId: "cal", active: true, order: 1 }],
    },
  }));
  render(<CalendarsPage />);
  fireEvent.click(await screen.findByTitle("編集"));
  fireEvent.click(screen.getByRole("button", { name: "接続チェックを実行" }));
  expect(await screen.findByText("カレンダーが見つからないか、アプリ用アカウントに共有されていません（カレンダーIDと共有設定の両方を確認してください）")).toBeInTheDocument();
});

test("calendar_unreadable notification shows Japanese label and alert color", async () => {
  mockFetch.mockResolvedValue({ json: async () => ({ notifications: [{ id: "alert", type: "calendar_unreadable", message: "読み取り失敗" }] }) });
  render(<AdminNotificationsPage />);
  expect(await screen.findByText("カレンダー読取不可")).toHaveStyle({ background: "#d8533a" });
});
