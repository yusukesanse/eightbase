/** @jest-environment jsdom */
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/app/admin/calendars/TermsEditor", () => ({ TermsEditor: () => null }));
import SeasonsPage from "@/app/admin/games/seasons/page";
const fetchMock = jest.fn();
afterEach(cleanup);
describe.each(["mahjong", "darts", "billiards", "poker"])("%s シーズン編集", (gameCategory) => {
  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset().mockImplementation(async () => ({ ok: true, json: async () => ({ seasons: [{ seasonId: "S1", name: "テストシーズン", gameCategory, startDate: "2026-10-01", endDate: "2026-10-31", defaultStartTime: "09:00", defaultEndTime: "10:00", active: false }], users: [] }) }));
  });
  test("開催の既定時刻のラベル・入力を表示しない", async () => {
    render(<SeasonsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    expect(screen.queryByText("開催の既定時刻")).not.toBeInTheDocument();
  });
  test("保存本文に既定時刻のキーを含めない（既存のPUTを維持）", async () => {
    render(<SeasonsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "保存する" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/admin/scoreboard/seasons/S1", expect.objectContaining({ method: "PUT" })));
    const body = JSON.parse(fetchMock.mock.calls.find(([, options]) => options?.method === "PUT")![1].body);
    expect(body).toMatchObject({ name: "テストシーズン", gameCategory });
    expect(body).not.toHaveProperty("defaultStartTime");
    expect(body).not.toHaveProperty("defaultEndTime");
  });
});
