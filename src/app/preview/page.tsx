"use client";

/**
 * プレビューモード ランディングページ
 * トークンを入力してプレビューを有効化 → 各画面へのリンク一覧を表示
 */

import { useEffect, useState } from "react";
import Link from "next/link";

export default function PreviewPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(document.cookie.includes("__preview="));
  }, []);

  async function activate() {
    setError("");
    setActivating(true);
    try {
      const res = await fetch("/api/preview/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setActive(true);
      } else {
        const data = await res.json();
        setError(data.error || "エラーが発生しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setActivating(false);
    }
  }

  async function deactivate() {
    await fetch("/api/preview/activate", { method: "DELETE" });
    setActive(false);
  }

  if (!active) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold text-[#231714] text-center">
            EIGHTBASE プレビュー
          </h1>
          <p className="mt-2 text-xs text-[#231714]/50 text-center">
            チーム共有用のUIプレビューモードです。
            <br />
            アクセストークンを入力してください。
          </p>

          <div className="mt-6 space-y-3">
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && activate()}
              placeholder="アクセストークン"
              className="w-full px-4 py-3 text-sm border border-[#231714]/15 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-[#B0E401]"
            />
            {error && (
              <p className="text-xs text-red-500 px-1">{error}</p>
            )}
            <button
              onClick={activate}
              disabled={activating || !token}
              className="w-full py-3 text-sm font-bold text-[#231714] bg-[#B0E401] rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {activating ? "確認中..." : "プレビューを開始"}
            </button>
          </div>

          <p className="mt-6 text-[10px] text-[#231714]/30 text-center">
            本番データへの書き込みが発生する可能性があります。
            <br />
            閲覧のみを推奨します。
          </p>
        </div>
      </div>
    );
  }

  // プレビュー有効時: 全画面へのナビゲーション
  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-2xl mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-[#231714]">
              EIGHTBASE プレビュー
            </h1>
            <p className="text-xs text-[#231714]/50 mt-0.5">
              ログイン不要で全画面を確認できます
            </p>
          </div>
          <button
            onClick={deactivate}
            className="px-3 py-1.5 text-xs text-[#231714]/50 border border-[#231714]/10 rounded-lg hover:bg-white"
          >
            終了
          </button>
        </div>

        {/* ミニアプリ（利用者向け） */}
        <Section title="ミニアプリ（利用者向け）">
          <NavLink href="/info" label="総合情報ページ" desc="施設情報・麻雀リーグ・CS" />
          <NavLink href="/reservation" label="予約" desc="施設の予約フロー" />
          <NavLink href="/my-reservations" label="予約履歴" desc="自分の予約一覧" />
          <NavLink href="/mypage" label="マイページ" desc="プロフィール・設定" />
          <NavLink href="/games" label="ゲーム一覧" desc="参加可能なゲーム" />
          <NavLink href="/events" label="イベント" desc="イベント一覧" />
          <NavLink href="/news" label="ニュース" desc="お知らせ一覧" />
          <NavLink href="/members" label="メンバー" desc="メンバー一覧" />
          <NavLink href="/timeline" label="タイムライン" desc="投稿一覧" />
        </Section>

        {/* 管理画面 */}
        <Section title="管理画面（運営向け）">
          <NavLink href="/admin" label="ダッシュボード" desc="管理トップ" />
          <NavLink href="/admin/users" label="ユーザー管理" desc="登録ユーザー一覧" />
          <NavLink href="/admin/reservations" label="予約管理" desc="予約の確認・管理" />
          <NavLink href="/admin/calendars" label="カレンダー管理" desc="営業日・枠の設定" />
          <NavLink href="/admin/events" label="イベント管理" desc="イベントの作成・編集" />
          <NavLink href="/admin/games" label="ゲーム/シーズン" desc="シーズン一覧・管理" />
          <NavLink href="/admin/news" label="ニュース管理" desc="お知らせの作成・編集" />
          <NavLink href="/admin/admin-users" label="管理者設定" desc="管理者アカウント管理" />
        </Section>

        {/* デモ（モックデータ） */}
        <Section title="デモ（モックデータのみ）">
          <NavLink href="/demo/app" label="ミニアプリ デモ" desc="麻雀リーグUI（サンプルデータ）" />
          <NavLink href="/demo/admin" label="管理画面 デモ" desc="管理UIプレビュー（サンプルデータ）" />
        </Section>

        <p className="mt-8 text-[10px] text-[#231714]/30 text-center">
          プレビューモードは7日間有効です。上部バナーの「終了」で解除できます。
        </p>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-[#231714] mb-2">{title}</h2>
      <div className="bg-white rounded-xl border border-[#231714]/10 divide-y divide-[#231714]/5">
        {children}
      </div>
    </section>
  );
}

function NavLink({
  href,
  label,
  desc,
}: {
  href: string;
  label: string;
  desc: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-4 py-3 hover:bg-[#231714]/[0.02] transition-colors"
    >
      <div>
        <div className="text-sm font-medium text-[#231714]">{label}</div>
        <div className="text-[11px] text-[#231714]/40 mt-0.5">{desc}</div>
      </div>
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        className="shrink-0 text-[#231714]/20"
      >
        <path
          d="M6 4l4 4-4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
