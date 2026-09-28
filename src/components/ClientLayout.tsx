"use client";

import { usePathname } from "next/navigation";
import { AuthGuard } from "./AuthGuard";
import { RichMenu } from "./RichMenu";

/** ボトムナビゲーションを表示しないパス */
const NO_NAV_PATHS = ["/", "/login", "/setup-profile", "/guest"];

export function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const isDemo = pathname.startsWith("/demo");
  const isPreview = pathname.startsWith("/preview");
  const showNav = !NO_NAV_PATHS.includes(pathname) && !isAdmin && !isDemo && !isPreview;

  // デモ・プレビューランディング: 認証なし
  if (isDemo || isPreview) {
    return <main className="flex-1 w-full">{children}</main>;
  }

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
          {/* ⚠️ pb-20 と -mb-20（/reservation の PageBg）は対。片方だけ変えないこと（main の余白に body の白が
              透けるのを防ぐため）。背景色 bg-[color:var(--eb-bg-end)] は他画面のための着色（reservation は
              -mb-20 で打ち消されるため影響しない）。色を変えるときは globals.css の --eb-bg-end も合わせること。 */}
          <main className={`flex-1 ${showNav ? "pb-20 bg-[color:var(--eb-bg-end)]" : ""}`}>{children}</main>
        </div>
      </AuthGuard>
      {showNav && <RichMenu />}
    </>
  );
}
