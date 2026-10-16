/** @jest-environment jsdom */
import React from "react";
import { render, waitFor, cleanup } from "@testing-library/react";

let mockPath = "/reservation";
let mockRole = "member";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));

import { RichMenu } from "@/components/RichMenu";

const originalFetch = global.fetch;

beforeEach(() => {
  mockPath = "/reservation";
  mockRole = "member";
  global.fetch = jest.fn(async () => ({
    json: async () => ({ authorized: true, role: mockRole }),
  })) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

test("会員で /members/abc のときは「メンバー」だけが aria-current=page", async () => {
  mockPath = "/members/abc";
  const { getAllByRole, getByRole } = render(<RichMenu />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());

  const links = getAllByRole("link");
  expect(links).toHaveLength(5);
  const current = links.filter((a) => a.getAttribute("aria-current") === "page");
  expect(current).toHaveLength(1);
  expect(current[0]).toBe(getByRole("link", { name: "メンバー" }));
  expect(current[0].getAttribute("href")).toBe("/members");
});

test("guest ロールでは「ゲーム」のリンク1つだけになる", async () => {
  mockRole = "guest";
  mockPath = "/games";
  const { getAllByRole } = render(<RichMenu />);
  await waitFor(() => expect(getAllByRole("link")).toHaveLength(1));
  const link = getAllByRole("link")[0];
  expect(link.getAttribute("aria-label")).toBe("ゲーム");
  expect(link.getAttribute("href")).toBe("/games");
  expect(link.getAttribute("aria-current")).toBe("page");
});

test("既定ではラベル文字を出さず aria-label だけ付ける。showLabels で文字が出る", async () => {
  const { queryByText, getAllByRole, unmount } = render(<RichMenu />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  for (const label of ["予約", "Info", "メンバー", "ゲーム", "マイページ"]) {
    expect(queryByText(label)).toBeNull();
  }
  expect(getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual([
    "予約",
    "Info",
    "メンバー",
    "ゲーム",
    "マイページ",
  ]);
  unmount();

  const withLabels = render(<RichMenu showLabels />);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  for (const label of ["予約", "Info", "メンバー", "ゲーム", "マイページ"]) {
    expect(withLabels.getByText(label)).toBeTruthy();
  }
});
