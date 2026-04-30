"use client";

import { usePathname } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { RichMenu } from "./RichMenu";

/** ボトムナビゲーションを表示しないパス */
const NO_NAV_PATHS = ["/", "/login", "/setup-profile"];

/**
 * クライアントサイドのレイアウト。
 * - AuthGuard で認証チェック
 * - /admin 配下はフル幅・ボトムナビなし（管理画面は独自サイドバーを持つ）
 * - /login などのパブリックパスではボトムナビを非表示
 */
export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const showNav = !NO_NAV_PATHS.includes(pathname) && !isAdmin;

  // 管理画面: max-width 制約なし・ボトムナビなし・フル幅
  if (isAdmin) {
    return (
      <AuthGuard>
        <main className="flex-1 w-full">{children}</main>
      </AuthGuard>
    );
  }

  // ユーザー向け画面: 最大幅 4xl・中央寄せ・ボトムナビあり
  return (
    <AuthGuard>
      <div className="w-full max-w-4xl mx-auto flex flex-col flex-1">
        <main className={`flex-1 ${showNav ? "pb-20" : ""}`}>{children}</main>
        {showNav && <RichMenu />}
      </div>
    </AuthGuard>
  );
}
