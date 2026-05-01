"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { initLiff } from "@/lib/liff";

export default function HomePage() {
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "no-account" | "error">("loading");
  const [statusText, setStatusText] = useState("LIFF初期化中...");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // ── Step 1: LIFF SDK 初期化 ──
        const liff = await initLiff();
        if (cancelled) return;

        // ── Step 2: LINE ログイン状態確認 ──
        if (!liff.isLoggedIn()) {
          setStatusText("LINEログイン中...");
          liff.login({ redirectUri: window.location.href });
          return;
        }

        // ── Step 3: LIFF アクセストークンでサーバーセッション作成 ──
        setStatusText("認証中...");
        const accessToken = liff.getAccessToken();

        if (!accessToken) {
          setStatusText("アクセストークンを取得できませんでした");
          setPhase("error");
          return;
        }

        // クライアント側でプロフィールを取得（サーバー側 LINE API 失敗時のフォールバック）
        let liffProfile: { userId?: string; displayName?: string; pictureUrl?: string } = {};
        try {
          const p = await liff.getProfile();
          liffProfile = { userId: p.userId, displayName: p.displayName, pictureUrl: p.pictureUrl ?? "" };
        } catch (e) {
          console.warn("[HomePage] liff.getProfile() failed:", e);
        }

        const res = await fetch("/api/auth/liff-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken, liffProfile }),
          credentials: "include",
        });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.success) {
            router.replace("/reservation");
          } else {
            // 未連携・未登録・削除済み → すべてアカウントなし画面
            setPhase("no-account");
          }
        } else {
          // 401 / 500 など
          setPhase("no-account");
        }
      } catch (err) {
        console.error("[HomePage] boot error:", err);
        if (!cancelled) {
          setStatusText("エラーが発生しました。ページを再読み込みしてください。");
          setPhase("error");
        }
      }
    }

    boot();
    return () => { cancelled = true; };
  }, [router]);

  // ── アカウントなし画面（柴犬ドット絵アニメーション） ──
  if (phase === "no-account") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] px-4">
        <style>{`
          @keyframes sJump{0%,40%,100%{transform:translateY(0)}15%,25%{transform:translateY(-30px)}20%{transform:translateY(-32px)}60%,62%{transform:translateY(0)}72%,82%{transform:translateY(-22px)}77%{transform:translateY(-24px)}}
          @keyframes legR{0%,50%{transform:translateY(0)}25%{transform:translateY(2px)}75%{transform:translateY(-2px)}}
          @keyframes legL{0%,50%{transform:translateY(0)}25%{transform:translateY(-2px)}75%{transform:translateY(2px)}}
          @keyframes tw{0%,100%{transform:rotate(-12deg)}50%{transform:rotate(18deg)}}
          @keyframes obs{0%{transform:translateX(0)}100%{transform:translateX(-380px)}}
          @keyframes cld{0%{transform:translateX(0)}100%{transform:translateX(-420px)}}
          @keyframes eb{0%,92%,96%,100%{opacity:1}94%{opacity:0}}
        `}</style>

        <div className="w-full max-w-xs overflow-hidden" style={{ imageRendering: "pixelated" }}>
          <svg width="300" height="120" viewBox="0 0 300 120" className="w-full h-auto">
            {/* スコア */}
            <text x="274" y="14" fontSize="9" fill="#231714" opacity="0.18" fontFamily="monospace" textAnchor="end">00000</text>

            {/* 雲 */}
            <g style={{ animation: "cld 20s linear infinite" }}>
              <rect x="140" y="18" width="4" height="2" fill="#ddd"/>
              <rect x="136" y="20" width="12" height="2" fill="#ddd"/>
              <rect x="132" y="22" width="20" height="2" fill="#ddd"/>
              <rect x="136" y="24" width="4" height="2" fill="#ddd"/>
              <rect x="146" y="24" width="4" height="2" fill="#ddd"/>
              <rect x="290" y="28" width="4" height="2" fill="#ddd"/>
              <rect x="286" y="30" width="12" height="2" fill="#ddd"/>
              <rect x="282" y="32" width="20" height="2" fill="#ddd"/>
              <rect x="420" y="16" width="4" height="2" fill="#ddd"/>
              <rect x="416" y="18" width="12" height="2" fill="#ddd"/>
              <rect x="412" y="20" width="20" height="2" fill="#ddd"/>
              <rect x="416" y="22" width="4" height="2" fill="#ddd"/>
            </g>

            {/* 柴犬 */}
            <g style={{ animation: "sJump 4.5s ease-in-out infinite" }}>
              {/* しっぽ */}
              <g style={{ animation: "tw 0.3s ease-in-out infinite", transformOrigin: "42px 60px" }}>
                <rect x="38" y="54" width="2" height="2" fill="#e8c97a"/>
                <rect x="36" y="52" width="2" height="2" fill="#e8c97a"/>
                <rect x="36" y="50" width="2" height="2" fill="#c4a87a"/>
                <rect x="38" y="48" width="2" height="2" fill="#c4a87a"/>
              </g>
              {/* 胴体 */}
              <rect x="42" y="54" width="2" height="2" fill="#c4a87a"/>
              <rect x="44" y="52" width="18" height="2" fill="#c4a87a"/>
              <rect x="44" y="54" width="18" height="2" fill="#c4a87a"/>
              <rect x="44" y="56" width="18" height="2" fill="#c4a87a"/>
              <rect x="44" y="58" width="18" height="2" fill="#c4a87a"/>
              <rect x="44" y="60" width="18" height="2" fill="#c4a87a"/>
              <rect x="44" y="62" width="18" height="2" fill="#c4a87a"/>
              <rect x="46" y="54" width="14" height="2" fill="#e8c97a"/>
              <rect x="46" y="56" width="14" height="2" fill="#e8c97a"/>
              <rect x="46" y="58" width="14" height="2" fill="#e8c97a"/>
              <rect x="46" y="60" width="14" height="2" fill="#e8c97a"/>
              {/* 後ろ足 */}
              <g style={{ animation: "legR 0.2s steps(2) infinite" }}>
                <rect x="46" y="64" width="4" height="2" fill="#c4a87a"/>
                <rect x="46" y="66" width="4" height="2" fill="#c4a87a"/>
                <rect x="46" y="68" width="4" height="2" fill="#c4a87a"/>
                <rect x="46" y="70" width="4" height="2" fill="#c4a87a"/>
                <rect x="48" y="72" width="4" height="2" fill="#8B6F47"/>
              </g>
              {/* 前足 */}
              <g style={{ animation: "legL 0.2s steps(2) infinite" }}>
                <rect x="54" y="64" width="4" height="2" fill="#c4a87a"/>
                <rect x="54" y="66" width="4" height="2" fill="#c4a87a"/>
                <rect x="54" y="68" width="4" height="2" fill="#c4a87a"/>
                <rect x="54" y="70" width="4" height="2" fill="#c4a87a"/>
                <rect x="56" y="72" width="4" height="2" fill="#8B6F47"/>
              </g>
              {/* 頭 */}
              <rect x="58" y="38" width="2" height="2" fill="#c4a87a"/>
              <rect x="56" y="40" width="6" height="2" fill="#c4a87a"/>
              <rect x="54" y="42" width="14" height="2" fill="#c4a87a"/>
              <rect x="54" y="44" width="16" height="2" fill="#c4a87a"/>
              <rect x="54" y="46" width="16" height="2" fill="#c4a87a"/>
              <rect x="56" y="48" width="14" height="2" fill="#c4a87a"/>
              <rect x="58" y="50" width="10" height="2" fill="#c4a87a"/>
              {/* 右耳 */}
              <rect x="72" y="40" width="2" height="2" fill="#c4a87a"/>
              <rect x="70" y="42" width="6" height="2" fill="#c4a87a"/>
              <rect x="70" y="44" width="4" height="2" fill="#c4a87a"/>
              <rect x="70" y="46" width="4" height="2" fill="#c4a87a"/>
              <rect x="70" y="44" width="2" height="2" fill="#f5b0a0"/>
              {/* 左耳 */}
              <rect x="56" y="40" width="2" height="2" fill="#c4a87a"/>
              <rect x="54" y="42" width="4" height="2" fill="#c4a87a"/>
              <rect x="54" y="44" width="4" height="2" fill="#c4a87a"/>
              <rect x="54" y="46" width="2" height="2" fill="#c4a87a"/>
              <rect x="56" y="42" width="2" height="2" fill="#f5b0a0"/>
              {/* 顔（白い部分） */}
              <rect x="58" y="44" width="10" height="2" fill="#e8c97a"/>
              <rect x="58" y="46" width="10" height="2" fill="#e8c97a"/>
              <rect x="60" y="48" width="6" height="2" fill="#e8c97a"/>
              {/* 目 */}
              <rect x="60" y="44" width="2" height="2" fill="#231714" style={{ animation: "eb 4s step-end infinite" }}/>
              <rect x="66" y="44" width="2" height="2" fill="#231714" style={{ animation: "eb 4s step-end infinite 0.2s" }}/>
              {/* 鼻 */}
              <rect x="64" y="48" width="2" height="2" fill="#231714"/>
              {/* マズル */}
              <rect x="68" y="48" width="4" height="2" fill="#c4a87a"/>
              <rect x="70" y="46" width="2" height="2" fill="#c4a87a"/>
            </g>

            {/* 障害物（サボテン） */}
            <g style={{ animation: "obs 3.8s linear infinite" }}>
              <rect x="210" y="58" width="2" height="16" fill="#8B9B5A"/>
              <rect x="208" y="56" width="6" height="4" fill="#8B9B5A"/>
              <rect x="212" y="52" width="2" height="8" fill="#8B9B5A"/>
              <rect x="214" y="52" width="2" height="2" fill="#8B9B5A"/>
              <rect x="206" y="60" width="2" height="6" fill="#8B9B5A"/>
              <rect x="204" y="60" width="2" height="2" fill="#8B9B5A"/>
              <rect x="310" y="54" width="2" height="20" fill="#8B9B5A"/>
              <rect x="308" y="52" width="6" height="4" fill="#8B9B5A"/>
              <rect x="312" y="48" width="2" height="8" fill="#8B9B5A"/>
              <rect x="314" y="48" width="2" height="2" fill="#8B9B5A"/>
              <rect x="306" y="56" width="2" height="6" fill="#8B9B5A"/>
              <rect x="304" y="56" width="2" height="2" fill="#8B9B5A"/>
              <rect x="318" y="56" width="2" height="18" fill="#8B9B5A"/>
              <rect x="316" y="54" width="6" height="4" fill="#8B9B5A"/>
            </g>

            {/* 地面 */}
            <rect x="0" y="74" width="300" height="2" fill="#bbb"/>
            <rect x="8" y="78" width="6" height="2" fill="#ddd"/>
            <rect x="24" y="80" width="2" height="2" fill="#ddd"/>
            <rect x="44" y="78" width="10" height="2" fill="#ddd"/>
            <rect x="72" y="80" width="4" height="2" fill="#ddd"/>
            <rect x="96" y="78" width="8" height="2" fill="#ddd"/>
            <rect x="120" y="80" width="2" height="2" fill="#ddd"/>
            <rect x="142" y="78" width="6" height="2" fill="#ddd"/>
            <rect x="168" y="80" width="4" height="2" fill="#ddd"/>
            <rect x="190" y="78" width="10" height="2" fill="#ddd"/>
            <rect x="220" y="80" width="2" height="2" fill="#ddd"/>
            <rect x="240" y="78" width="6" height="2" fill="#ddd"/>
            <rect x="262" y="80" width="4" height="2" fill="#ddd"/>
            <rect x="280" y="78" width="8" height="2" fill="#ddd"/>
          </svg>
        </div>

        <p className="text-sm font-medium text-[#231714] mt-4 font-mono">NO ACCOUNT</p>
        <p className="text-xs text-[#231714]/30 mt-1 font-mono">アカウントが見つかりませんでした</p>
        <Link
          href="/login"
          className="inline-block mt-5 text-xs text-[#A5C1C8] underline underline-offset-2"
        >
          アカウント情報をお持ちの方はこちら
        </Link>
      </div>
    );
  }

  // ── エラー画面 ──
  if (phase === "error") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <div className="opacity-20 mb-6">
          <Image src="/logo.svg" alt="EIGHT BASE UNGA" width={80} height={80} priority />
        </div>
        <p className="text-sm text-[#231714]/50 text-center">{statusText}</p>
      </div>
    );
  }

  // ── ローディング画面 ──
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-400 mt-2">{statusText}</p>
      </div>
    </div>
  );
}
