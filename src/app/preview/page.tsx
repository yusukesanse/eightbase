"use client";

/**
 * プレビューモード ランディングページ
 * トークンを入力してプレビューを有効化 → 各画面へのリンク一覧を表示
 * ミニアプリ画面はiPhone 17フレーム内にiframeで表示
 */

import { useEffect, useState } from "react";
import Link from "next/link";

type ViewMode = "list" | "miniapp";

/* iPhone 17 の画面サイズ (6.3インチ / 論理解像度) */
const IPHONE_WIDTH = 402;
const IPHONE_HEIGHT = 874;
const FRAME_PADDING = 12;
const FRAME_RADIUS = "3.2rem";
const SCREEN_RADIUS = "2.6rem";

export default function PreviewPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [activating, setActivating] = useState(false);
  const [active, setActive] = useState(false);
  const [checking, setChecking] = useState(true);

  // ミニアプリ iframe 表示
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [iframeSrc, setIframeSrc] = useState("");
  const [iframeLabel, setIframeLabel] = useState("");

  useEffect(() => {
    fetch("/api/preview/activate", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setActive(data.active === true))
      .catch(() => setActive(false))
      .finally(() => setChecking(false));
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

  function openMiniApp(href: string, label: string) {
    setIframeSrc(href);
    setIframeLabel(label);
    setViewMode("miniapp");
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#FAF7F2] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#231714] border-t-transparent rounded-full animate-spin" />
      </div>
    );
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
            {error && <p className="text-xs text-red-500 px-1">{error}</p>}
            <button
              onClick={activate}
              disabled={activating || !token}
              className="w-full py-3 text-sm font-bold text-[#231714] bg-[#B0E401] rounded-xl hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {activating ? "確認中..." : "プレビューを開始"}
            </button>
          </div>

          <p className="mt-6 text-[10px] text-[#231714]/30 text-center">
            閲覧専用のプレビューモードです。
          </p>
        </div>
      </div>
    );
  }

  // ミニアプリ iframe 表示モード (iPhone 17 フレーム)
  if (viewMode === "miniapp") {
    const frameW = IPHONE_WIDTH + FRAME_PADDING * 2;
    const frameH = IPHONE_HEIGHT + FRAME_PADDING * 2;

    return (
      <div className="h-screen bg-[#1a1a2e] flex flex-col items-center justify-center p-4 gap-3 overflow-hidden">
        {/* iPhone フレーム（ビューポートに収まるよう縮小） */}
        <div
          className="relative"
          style={{
            width: frameW,
            height: frameH,
            maxHeight: "calc(100vh - 80px)",
            aspectRatio: `${frameW} / ${frameH}`,
          }}
        >
          <div
            className="absolute inset-0 bg-[#1c1c1e] shadow-2xl origin-top-left"
            style={{
              width: frameW,
              height: frameH,
              borderRadius: FRAME_RADIUS,
              padding: FRAME_PADDING,
              transform: `scale(var(--phone-scale))`,
            }}
            ref={(el) => {
              if (!el) return;
              const parent = el.parentElement!;
              const update = () => {
                const maxH = window.innerHeight - 80;
                const scale = Math.min(1, maxH / frameH, parent.clientWidth / frameW);
                el.style.setProperty("--phone-scale", String(scale));
                parent.style.width = `${frameW * scale}px`;
                parent.style.height = `${frameH * scale}px`;
              };
              update();
              window.addEventListener("resize", update);
              return () => window.removeEventListener("resize", update);
            }}
          >
            {/* Dynamic Island */}
            <div
              className="absolute z-10 bg-[#1c1c1e] left-1/2 -translate-x-1/2"
              style={{
                top: FRAME_PADDING + 10,
                width: 126,
                height: 37,
                borderRadius: 20,
              }}
            />

            {/* ステータスバー */}
            <div
              className="absolute z-20 flex items-center justify-between px-6"
              style={{
                top: FRAME_PADDING + 12,
                left: FRAME_PADDING + 4,
                right: FRAME_PADDING + 4,
                height: 22,
              }}
            >
              <span className="text-white text-[13px] font-semibold">9:41</span>
              <div className="flex items-center gap-[5px]">
                {/* 電波 */}
                <svg width="17" height="12" viewBox="0 0 17 12" fill="white">
                  <rect x="0" y="8" width="3" height="4" rx="0.7" opacity="0.4" />
                  <rect x="4.5" y="5.5" width="3" height="6.5" rx="0.7" opacity="0.6" />
                  <rect x="9" y="2.5" width="3" height="9.5" rx="0.7" opacity="0.8" />
                  <rect x="13.5" y="0" width="3" height="12" rx="0.7" />
                </svg>
                {/* WiFi */}
                <svg width="16" height="12" viewBox="0 0 16 12" fill="white">
                  <path d="M8 10.5a1.2 1.2 0 100-2.4 1.2 1.2 0 000 2.4z" />
                  <path d="M4.5 7.2a5 5 0 017 0" stroke="white" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                  <path d="M2 4.5a8.5 8.5 0 0112 0" stroke="white" strokeWidth="1.3" strokeLinecap="round" fill="none" />
                </svg>
                {/* バッテリー */}
                <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
                  <rect x="0.5" y="1" width="22" height="11" rx="2.5" stroke="white" strokeWidth="1" />
                  <rect x="2.5" y="3" width="16" height="7" rx="1.2" fill="white" />
                  <rect x="23.5" y="4.5" width="2.5" height="4" rx="0.8" fill="white" opacity="0.4" />
                </svg>
              </div>
            </div>

            {/* 画面 */}
            <div
              className="w-full h-full overflow-hidden bg-white"
              style={{ borderRadius: SCREEN_RADIUS }}
            >
              <iframe
                src={iframeSrc}
                className="w-full h-full border-0"
                title={iframeLabel}
              />
            </div>

            {/* ホームインジケーター */}
            <div
              className="absolute left-1/2 -translate-x-1/2 bg-white/30 rounded-full"
              style={{
                bottom: FRAME_PADDING + 6,
                width: 140,
                height: 5,
              }}
            />
          </div>
        </div>

        {/* 戻るボタン（フレーム外・下） */}
        <button
          onClick={() => setViewMode("list")}
          className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white text-sm font-medium transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M10 4l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          プレビュー一覧に戻る
        </button>
      </div>
    );
  }

  // 一覧表示
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
          <MiniAppLink onClick={() => openMiniApp("/info", "総合情報ページ")} label="総合情報ページ" desc="施設情報・麻雀リーグ・CS" />
          <MiniAppLink onClick={() => openMiniApp("/reservation", "予約")} label="予約" desc="施設の予約フロー" />
          <MiniAppLink onClick={() => openMiniApp("/my-reservations", "予約履歴")} label="予約履歴" desc="自分の予約一覧" />
          <MiniAppLink onClick={() => openMiniApp("/mypage", "マイページ")} label="マイページ" desc="プロフィール・設定" />
          <MiniAppLink onClick={() => openMiniApp("/games", "ゲーム一覧")} label="ゲーム一覧" desc="参加可能なゲーム" />
          <MiniAppLink onClick={() => openMiniApp("/events", "イベント")} label="イベント" desc="イベント一覧" />
          <MiniAppLink onClick={() => openMiniApp("/news", "ニュース")} label="ニュース" desc="お知らせ一覧" />
          <MiniAppLink onClick={() => openMiniApp("/members", "メンバー")} label="メンバー" desc="メンバー一覧" />
          <MiniAppLink onClick={() => openMiniApp("/timeline", "タイムライン")} label="タイムライン" desc="投稿一覧" />
        </Section>

        {/* 管理画面 */}
        <Section title="管理画面（運営向け）">
          <NavLink href="/admin" label="ダッシュボード" desc="管理トップ" />
          <NavLink href="/admin/reservations" label="予約管理" desc="予約の確認・管理" />
          <NavLink href="/admin/events" label="イベント管理" desc="イベントの作成・編集" />
          <NavLink href="/admin/games" label="ゲーム/シーズン" desc="シーズン一覧・管理" />
          <NavLink href="/admin/news" label="ニュース管理" desc="お知らせの作成・編集" />
        </Section>

        <p className="mt-8 text-[10px] text-[#231714]/30 text-center">
          プレビューモードは7日間有効です。上部バナーの「終了」で解除できます。
        </p>
      </div>
    </div>
  );
}

/* ───────── 共通コンポーネント ───────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-[#231714] mb-2">{title}</h2>
      <div className="bg-white rounded-xl border border-[#231714]/10 divide-y divide-[#231714]/5">
        {children}
      </div>
    </section>
  );
}

function NavLink({ href, label, desc }: { href: string; label: string; desc: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between px-4 py-3 hover:bg-[#231714]/[0.02] transition-colors"
    >
      <div>
        <div className="text-sm font-medium text-[#231714]">{label}</div>
        <div className="text-[11px] text-[#231714]/40 mt-0.5">{desc}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#231714]/20">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function MiniAppLink({ onClick, label, desc }: { onClick: () => void; label: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#231714]/[0.02] transition-colors text-left"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[#A5C1C8]/20">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="2.5" width="10" height="7" rx="1" stroke="#A5C1C8" strokeWidth="1.2" />
              <path d="M4 1.5h4" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-sm font-medium text-[#231714]">{label}</span>
        </div>
        <div className="text-[11px] text-[#231714]/40 mt-0.5 ml-7">{desc}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0 text-[#231714]/20">
        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
