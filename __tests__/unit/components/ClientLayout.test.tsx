/** @jest-environment jsdom */
import React from "react";
import { render, cleanup } from "@testing-library/react";

let mockPath = "/mypage";
jest.mock("next/navigation", () => ({ usePathname: () => mockPath }));
jest.mock("@/components/AuthGuard", () => ({ AuthGuard: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/components/RichMenu", () => ({ RichMenu: () => null }));

import { ClientLayout } from "@/components/ClientLayout";

afterEach(cleanup);

test("ボトムナビ表示画面の main には --eb-bg-end の背景色が付く", () => {
  mockPath = "/mypage";
  const { container } = render(<ClientLayout><div>content</div></ClientLayout>);
  const main = container.querySelector("main");
  expect(main).not.toBeNull();
  expect(main!.className).toContain("pb-20");
  expect(main!.className).toContain("bg-[color:var(--eb-bg-end)]");
});

test.each(["/admin/users", "/demo", "/preview", "/", "/login", "/setup-profile", "/guest"])("ナビ非表示の %s には --eb-bg-end の背景色を付けない", (path) => {
  mockPath = path;
  const { container } = render(<ClientLayout><div>content</div></ClientLayout>);
  const main = container.querySelector("main");
  expect(main).not.toBeNull();
  expect(main!.className).not.toContain("eb-bg-end");
});
