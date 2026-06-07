"use client";

import { usePathname } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { RichMenu } from "./RichMenu";

/** ボトムナビゲーションを表示しないパス */
const NO_NAV_PATHS = ["/", "/login", "/setup-profile"];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const showNav = !NO_NAV_PATHS.includes(pathname) && !isAdmin;

  // 管理画面: フル幅・ボトムナビなし
  if (isAdmin) {
    return (
      <AuthGuard>
        <main className="flex-1 w-full">{children}</main>
      </AuthGuard>
    );
  }

  // ユーザー向け画面: ボトムナビはAuthGuardの外に配置（常に表示）
  return (
    <>
      <AuthGuard>
        <div className="w-full max-w-4xl mx-auto flex flex-col flex-1">
          <main className={`flex-1 ${showNav ? "pb-20" : ""}`}>{children}</main>
        </div>
      </AuthGuard>
      {showNav && <RichMenu />}
    </>
  );
}
