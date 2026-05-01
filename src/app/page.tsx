"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { initLiff } from "@/lib/liff";

// ── 柴犬ドット絵ゲーム コンポーネント ──
function ShibaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const gameRef = useRef({
    run: false, over: false, score: 0, hi: 0, spd: 2.5,
    sy: 0, vy: 0, jmp: false,
    obs: [] as { x: number; w: number; h: number }[],
    cld: [{ x: 100, y: 12, s: 1 }, { x: 200, y: 22, s: 0.7 }, { x: 300, y: 8, s: 0.5 }],
    dots: [] as { x: number; y: number; w: number }[],
    lf: 0, lt: 0, ta: 0, td: 1, bt: 0, bk: false, st: 0, fc: 0,
  });

  const W = 340, H = 180, GY = 144, SX = 38;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const cx = cv.getContext("2d")!;
    const g = gameRef.current;

    // 地面ドット初期化
    g.dots = [];
    for (let i = 0; i < 15; i++) {
      g.dots.push({ x: Math.random() * W, y: GY + 4 + Math.random() * 12, w: 2 + Math.random() * 6 });
    }

    function px(x: number, y: number, w: number, h: number, c: string) {
      cx.fillStyle = c;
      cx.fillRect(x, y, w, h);
    }

    function drawShiba(by: number) {
      const x = SX, y = by;
      const t = g.ta;

      // しっぽ（柴犬らしい太い巻き尾）
      px(x - 1, y - 2, 3, 2, "#c4a87a");
      px(x - 2, y - 4, 3, 2, "#c4a87a");
      px(x - 3, y - 6, 3, 2, "#e8c97a");
      px(x - 4 + (t > 0 ? 1 : 0), y - 8, 3, 2, "#e8c97a");
      px(x - 4 + (t > 0 ? 2 : 0), y - 10, 3, 2, "#e8c97a");
      px(x - 3 + (t > 0 ? 2 : 0), y - 11, 2, 2, "#c4a87a");
      px(x - 4, y - 5, 2, 2, "#e8c97a");
      px(x - 5 + (t > 0 ? 1 : 0), y - 7, 2, 2, "#d8b86a");
      px(x - 5 + (t > 0 ? 2 : 0), y - 9, 2, 2, "#d8b86a");

      // 胴体
      for (let r = -6; r <= 2; r += 2) px(x, y + r, 14, 2, "#c4a87a");
      for (let r = -4; r <= 0; r += 2) px(x + 1, y + r, 12, 2, "#e8c97a");

      // 足
      const lo = g.lf === 0 ? 0 : (g.lf === 1 ? 1 : -1);
      // 後ろ足
      px(x + 1, y + 4 - lo, 3, 2, "#a89060"); px(x + 1, y + 6 - lo, 3, 2, "#a89060"); px(x + 2, y + 8 - lo, 3, 2, "#7a5f3a");
      px(x + 3, y + 4 + lo, 3, 2, "#c4a87a"); px(x + 3, y + 6 + lo, 3, 2, "#c4a87a"); px(x + 4, y + 8 + lo, 3, 2, "#8B6F47");
      // 前足
      px(x + 8, y + 4 + lo, 3, 2, "#a89060"); px(x + 8, y + 6 + lo, 3, 2, "#a89060"); px(x + 9, y + 8 + lo, 3, 2, "#7a5f3a");
      px(x + 10, y + 4 - lo, 3, 2, "#c4a87a"); px(x + 10, y + 6 - lo, 3, 2, "#c4a87a"); px(x + 11, y + 8 - lo, 3, 2, "#8B6F47");

      // 頭
      const hx = x + 11, hy = y - 14;
      px(hx, hy, 2, 2, "#c4a87a"); px(hx - 1, hy + 2, 3, 2, "#c4a87a"); px(hx, hy + 2, 2, 2, "#f5b0a0");
      px(hx + 8, hy, 2, 2, "#c4a87a"); px(hx + 7, hy + 2, 3, 2, "#c4a87a"); px(hx + 8, hy + 2, 2, 2, "#f5b0a0");
      px(hx - 1, hy + 4, 12, 2, "#c4a87a");
      px(hx - 1, hy + 6, 12, 2, "#c4a87a");
      px(hx, hy + 8, 10, 2, "#c4a87a");
      px(hx + 1, hy + 10, 8, 2, "#c4a87a");
      px(hx + 1, hy + 6, 8, 2, "#e8c97a");
      px(hx + 2, hy + 8, 6, 2, "#e8c97a");
      px(hx + 3, hy + 10, 4, 2, "#e8c97a");
      if (!g.bk) { px(hx + 2, hy + 6, 2, 2, "#231714"); px(hx + 7, hy + 6, 2, 2, "#231714"); }
      px(hx + 5, hy + 10, 2, 2, "#231714");
      px(hx + 8, hy + 8, 2, 2, "#c4a87a"); px(hx + 9, hy + 6, 2, 2, "#c4a87a");
      px(hx + 1, hy + 8, 2, 2, "#f0d090"); px(hx + 7, hy + 8, 2, 2, "#f0d090");
    }

    function drawCactus(ox: number, ow: number, oh: number) {
      const c = "#8B9B5A", d = "#6B7B3A";
      const bx = Math.floor(ox);
      const tw = Math.min(ow, 6);
      for (let r = 0; r < oh; r += 2) px(bx, GY - oh + r, tw, 2, c);
      if (oh > 16) {
        px(bx + tw, GY - oh + 6, 3, 2, c); px(bx + tw + 2, GY - oh + 4, 2, 4, c); px(bx + tw + 3, GY - oh + 3, 2, 2, d);
        px(bx - 3, GY - oh + 10, 3, 2, c); px(bx - 3, GY - oh + 8, 2, 4, c); px(bx - 4, GY - oh + 8, 2, 2, d);
      }
      if (ow > 10) {
        const tx = bx + ow - 6, ch2 = oh - 4;
        for (let r = 0; r < ch2; r += 2) px(tx, GY - ch2 + r, 6, 2, c);
        if (ch2 > 10) { px(tx + 6, GY - ch2 + 4, 2, 3, c); px(tx + 7, GY - ch2 + 3, 2, 2, d); }
      }
    }

    function update() {
      if (g.over) return;
      g.fc++;
      g.spd = Math.min(7, 2.5 + Math.floor(g.score / 8) * 0.25);
      if (g.run && g.fc % 6 === 0) g.score++;
      if (g.jmp) { g.vy += 0.5; g.sy += g.vy; if (g.sy >= 0) { g.sy = 0; g.vy = 0; g.jmp = false; } }
      if (!g.jmp && g.run) { g.lt++; if (g.lt > 4) { g.lt = 0; g.lf = (g.lf + 1) % 3; } }
      g.ta += 0.15 * g.td; if (g.ta > 1 || g.ta < -1) g.td *= -1;
      g.bt++; if (g.bt > 140) { g.bk = true; if (g.bt > 146) { g.bk = false; g.bt = 0; } }

      // 障害物生成
      if (g.run) {
        g.st++;
        const mn = Math.max(50, 90 - Math.floor(g.score / 10) * 4);
        const mx = Math.max(80, 160 - Math.floor(g.score / 10) * 7);
        if (g.st > mn + Math.random() * (mx - mn)) {
          g.st = 0;
          const types = [{ w: 6, h: 20 }, { w: 8, h: 16 }, { w: 10, h: 14 }, { w: 5, h: 24 }];
          if (g.score > 20) types.push({ w: 14, h: 12 });
          if (g.score > 40) types.push({ w: 18, h: 10 });
          const t = types[Math.floor(Math.random() * types.length)];
          g.obs.push({ x: W + 10, w: t.w, h: t.h });
        }
      }

      for (let i = g.obs.length - 1; i >= 0; i--) { g.obs[i].x -= g.spd; if (g.obs[i].x < -30) g.obs.splice(i, 1); }
      for (const c of g.cld) { c.x -= g.spd * 0.15; if (c.x < -20) c.x = W + 10 + Math.random() * 40; }
      for (const d of g.dots) { d.x -= g.spd; if (d.x < -10) d.x = W + Math.random() * 20; }

      // 当たり判定（胴体中心のみ）
      const sl = SX + 4, sr = SX + 12, st2 = GY - 6 + g.sy, sb = GY - 2 + g.sy;
      for (const o of g.obs) {
        const ol = o.x + 1, or2 = o.x + Math.min(o.w, 6) - 1, ot = GY - o.h + 4;
        if (sr > ol && sl < or2 && sb > ot && st2 < GY) {
          g.over = true; g.run = false; if (g.score > g.hi) g.hi = g.score;
        }
      }
    }

    function draw() {
      cx.clearRect(0, 0, W, H);
      for (const c of g.cld) { cx.fillStyle = "#e8e8e8"; const s = c.s; cx.fillRect(c.x, c.y, 16 * s, 3); cx.fillRect(c.x - 2, c.y + 3, 20 * s, 3); cx.fillRect(c.x + 2, c.y + 6, 12 * s, 2); }
      cx.fillStyle = "rgba(35,23,20,0.18)"; cx.font = "14px monospace"; cx.textAlign = "right";
      cx.fillText(String(g.score).padStart(5, "0"), W - 8, 18);
      if (g.hi > 0) { cx.fillStyle = "rgba(35,23,20,0.1)"; cx.font = "11px monospace"; cx.fillText("HI " + String(g.hi).padStart(5, "0"), W - 8, 32); }
      drawShiba(GY - 10 + g.sy);
      for (const o of g.obs) drawCactus(o.x, o.w, o.h);
      cx.fillStyle = "#bbb"; cx.fillRect(0, GY, W, 2);
      cx.fillStyle = "#ddd"; for (const d of g.dots) cx.fillRect(d.x, d.y, d.w, 2);
      if (g.over) {
        cx.fillStyle = "rgba(35,23,20,0.65)"; cx.font = "bold 16px monospace"; cx.textAlign = "center";
        cx.fillText("GAME OVER", W / 2, H / 2 - 6);
        cx.fillStyle = "rgba(35,23,20,0.35)"; cx.font = "11px monospace"; cx.fillText("TAP TO RETRY", W / 2, H / 2 + 12);
      }
      if (!g.run && !g.over) {
        cx.fillStyle = "rgba(35,23,20,0.25)"; cx.font = "bold 13px monospace"; cx.textAlign = "center";
        cx.fillText("TAP !!!", W / 2, H - 14);
      }
    }

    function gameLoop() { update(); draw(); animRef.current = requestAnimationFrame(gameLoop); }
    animRef.current = requestAnimationFrame(gameLoop);
    return () => { cancelAnimationFrame(animRef.current); };
  }, []);

  const handleTap = useCallback(() => {
    const g = gameRef.current;
    if (g.over) { g.over = false; g.run = true; g.score = 0; g.spd = 2.5; g.obs = []; g.st = 0; g.fc = 0; g.sy = 0; g.vy = 0; g.jmp = false; return; }
    if (!g.run) g.run = true;
    if (!g.jmp) { g.jmp = true; g.vy = -7.5; }
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafafa] px-4">
      <div
        className="w-full max-w-sm overflow-hidden cursor-pointer select-none"
        style={{ imageRendering: "pixelated" }}
        onClick={handleTap}
        onTouchStart={(e) => { e.preventDefault(); handleTap(); }}
      >
        <canvas
          ref={canvasRef}
          width={340}
          height={180}
          className="w-full h-auto"
          style={{ imageRendering: "pixelated" }}
        />
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

  // ── アカウントなし画面（柴犬インタラクティブゲーム） ──
  if (phase === "no-account") {
    return <ShibaGame />;
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
