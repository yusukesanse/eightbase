import Link from "next/link";

export const metadata = { title: "EIGHTBASE デモ" };

/**
 * デモ用ランディング
 * 認証不要・モックデータのみで動くUIプレビュー（関係者への共有用）
 */
export default function DemoLandingPage() {
  return (
    <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-bold text-[#231714] text-center">EIGHTBASE UIデモ</h1>
        <p className="mt-2 text-sm text-[#231714]/65 text-center">
          ログイン不要のUIプレビューです。表示されているデータはすべてサンプルで、実際のデータには接続されていません。
        </p>

        <div className="mt-8 space-y-4">
          <Link
            href="/demo/app"
            className="block bg-white rounded-2xl border border-[#231714]/10 p-5 hover:shadow-md transition-shadow"
          >
            <div className="text-base font-bold text-[#231714]">ミニアプリ（利用者向け）</div>
            <p className="mt-1 text-sm text-[#231714]/65">
              麻雀リーグのピラミッド順位表・卓作成・スコア申告のデモ
            </p>
          </Link>

          <Link
            href="/demo/admin"
            className="block bg-white rounded-2xl border border-[#231714]/10 p-5 hover:shadow-md transition-shadow"
          >
            <div className="text-base font-bold text-[#231714]">管理画面（運営向け）</div>
            <p className="mt-1 text-sm text-[#231714]/65">
              麻雀リーグの順位表・卓の申告状況・スコア修正のデモ
            </p>
          </Link>
        </div>

        <p className="mt-8 text-xs text-[#231714]/55 text-center">
          © EIGHTBASE — 開発中のプレビュー版です
        </p>
      </div>
    </div>
  );
}
