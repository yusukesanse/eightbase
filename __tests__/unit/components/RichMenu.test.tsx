/** @jest-environment jsdom */
import React from "react";
import { render, waitFor, cleanup, act } from "@testing-library/react";

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

/** ロール取得（fetch → json → setRole の promise 連鎖）が全部流れた状態まで待つ。 */
async function renderSettled(ui: React.ReactElement) {
  const result = render(ui);
  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
  return result;
}

const floatOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-testid="richmenu-float"]');

test("会員で /members/abc のときは「メンバー」だけが aria-current=page", async () => {
  mockPath = "/members/abc";
  const { getAllByRole, getByRole } = await renderSettled(<RichMenu />);

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
  const { getAllByRole, container } = await renderSettled(<RichMenu />);
  const links = getAllByRole("link");
  expect(links).toHaveLength(1);
  expect(links[0].getAttribute("aria-label")).toBe("ゲーム");
  expect(links[0].getAttribute("href")).toBe("/games");
  expect(links[0].getAttribute("aria-current")).toBe("page");
  // 1タブなので円は中央（先頭スロット＝ずらさない）
  expect(floatOf(container)!.style.transform).toBe("translateX(0%)");
});

test("既定ではラベル文字を出さず aria-label だけ付ける。showLabels で文字が出る", async () => {
  const { queryByText, getAllByRole, unmount } = await renderSettled(<RichMenu />);
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

  const withLabels = await renderSettled(<RichMenu showLabels />);
  for (const label of ["予約", "Info", "メンバー", "ゲーム", "マイページ"]) {
    expect(withLabels.getByText(label)).toBeTruthy();
  }
});

test("選択タブが無いパス（/my-reservations）では aria-current も円も出さない", async () => {
  mockPath = "/my-reservations";
  const { getAllByRole, container } = await renderSettled(<RichMenu />);
  expect(getAllByRole("link").filter((a) => a.hasAttribute("aria-current"))).toHaveLength(0);
  expect(floatOf(container)).toBeNull();
});

test("会員で /games のとき円層は4番目のスロット（translateX(300%)）へ滑る", async () => {
  mockPath = "/games";
  const { container } = await renderSettled(<RichMenu />);
  const float = floatOf(container)!;
  expect(float.style.transform).toBe("translateX(300%)");
  expect(float.style.width).toBe("20%");
});
