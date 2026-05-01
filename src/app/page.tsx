"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { initLiff } from "@/lib/liff";

// ── 柴犬ドット絵ゲーム コンポーネント ──
function ShibaGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<{
    running: boolean;
    gameOver: boolean;
    score: number;
    highScore: number;
    speed: number;
    shibaY: number;
    velocityY: number;
    isJumping: boolean;
    obstacles: { x: number; w: number; h: number }[];
    clouds: { x: number; y: number; size: number }[];
    groundDots: { x: number; y: number; w: number }[];
    legFrame: number;
    legTimer: number;
    tailAngle: number;
    tailDir: number;
    blinkTimer: number;
    isBlinking: boolean;
    spawnTimer: number;
    frameCount: number;
  }>({
    running: false,
    gameOver: false,
    score: 0,
    highScore: 0,
    speed: 3,
    shibaY: 0,
    velocityY: 0,
    isJumping: false,
    obstacles: [],
    clouds: [
      { x: 120, y: 20, size: 1 },
      { x: 220, y: 30, size: 0.8 },
      { x: 50, y: 15, size: 0.6 },
    ],
    groundDots: [],
    legFrame: 0,
    legTimer: 0,
    tailAngle: 0,
    tailDir: 1,
    blinkTimer: 0,
    isBlinking: false,
    spawnTimer: 0,
    frameCount: 0,
  });
  const animRef = useRef<number>(0);

  const P = 2; // pixel size
  const GROUND_Y = 130;
  const SHIBA_X = 50;
  const JUMP_VELOCITY = -10;
  const GRAVITY = 0.45;
  const BASE_SPEED = 3;
  const MAX_SPEED = 9;

  const drawPixel = useCallback((ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x * P, y * P, w * P, h * P);
  }, [P]);

  const drawShiba = useCallback((ctx: CanvasRenderingContext2D, baseY: number, g: typeof gameRef.current) => {
    const bx = SHIBA_X;
    const by = baseY;

    // しっぽ（巻き尾）
    const ta = g.tailAngle;
    const tx = bx - 2;
    const ty = by - 6;
    drawPixel(ctx, tx, ty + 4, 2, 2, "#c4a87a");
    drawPixel(ctx, tx - 1 + (ta > 0 ? 1 : 0), ty + 2, 2, 2, "#e8c97a");
    drawPixel(ctx, tx - 1 + (ta > 0 ? 2 : 0), ty, 2, 2, "#c4a87a");
    drawPixel(ctx, tx + (ta > 0 ? 2 : -1), ty - 1, 2, 2, "#e8c97a");

    // 胴体（長め）
    drawPixel(ctx, bx, by - 8, 20, 2, "#c4a87a");
    drawPixel(ctx, bx, by - 6, 20, 2, "#c4a87a");
    drawPixel(ctx, bx, by - 4, 20, 2, "#c4a87a");
    drawPixel(ctx, bx, by - 2, 20, 2, "#c4a87a");
    drawPixel(ctx, bx, by, 20, 2, "#c4a87a");
    // 明るい部分（背中のハイライト）
    drawPixel(ctx, bx + 2, by - 6, 16, 2, "#e8c97a");
    drawPixel(ctx, bx + 2, by - 4, 16, 2, "#e8c97a");
    drawPixel(ctx, bx + 2, by - 2, 16, 2, "#e8c97a");

    // 後ろ足（2本、奥の足は暗め）
    const legOff = g.legFrame === 0 ? 0 : (g.legFrame === 1 ? 1 : -1);
    // 奥の後ろ足
    drawPixel(ctx, bx + 2, by + 2 - legOff, 4, 2, "#a89060");
    drawPixel(ctx, bx + 2, by + 4 - legOff, 4, 2, "#a89060");
    drawPixel(ctx, bx + 2, by + 6 - legOff, 4, 2, "#a89060");
    drawPixel(ctx, bx + 3, by + 8 - legOff, 4, 2, "#7a5f3a");
    // 手前の後ろ足
    drawPixel(ctx, bx + 5, by + 2 + legOff, 4, 2, "#c4a87a");
    drawPixel(ctx, bx + 5, by + 4 + legOff, 4, 2, "#c4a87a");
    drawPixel(ctx, bx + 5, by + 6 + legOff, 4, 2, "#c4a87a");
    drawPixel(ctx, bx + 6, by + 8 + legOff, 4, 2, "#8B6F47");

    // 前足（2本、奥の足は暗め）
    // 奥の前足
    drawPixel(ctx, bx + 13, by + 2 + legOff, 4, 2, "#a89060");
    drawPixel(ctx, bx + 13, by + 4 + legOff, 4, 2, "#a89060");
    drawPixel(ctx, bx + 13, by + 6 + legOff, 4, 2, "#a89060");
    drawPixel(ctx, bx + 14, by + 8 + legOff, 4, 2, "#7a5f3a");
    // 手前の前足
    drawPixel(ctx, bx + 16, by + 2 - legOff, 4, 2, "#c4a87a");
    drawPixel(ctx, bx + 16, by + 4 - legOff, 4, 2, "#c4a87a");
    drawPixel(ctx, bx + 16, by + 6 - legOff, 4, 2, "#c4a87a");
    drawPixel(ctx, bx + 17, by + 8 - legOff, 4, 2, "#8B6F47");

    // 頭
    const hx = bx + 17;
    const hy = by - 16;
    // 耳（左）
    drawPixel(ctx, hx, hy - 4, 2, 2, "#c4a87a");
    drawPixel(ctx, hx - 1, hy - 2, 4, 2, "#c4a87a");
    drawPixel(ctx, hx, hy - 2, 2, 2, "#f5b0a0");
    // 耳（右）
    drawPixel(ctx, hx + 10, hy - 4, 2, 2, "#c4a87a");
    drawPixel(ctx, hx + 9, hy - 2, 4, 2, "#c4a87a");
    drawPixel(ctx, hx + 10, hy - 2, 2, 2, "#f5b0a0");
    // 頭の輪郭
    drawPixel(ctx, hx - 1, hy, 14, 2, "#c4a87a");
    drawPixel(ctx, hx - 1, hy + 2, 14, 2, "#c4a87a");
    drawPixel(ctx, hx, hy + 4, 12, 2, "#c4a87a");
    drawPixel(ctx, hx + 1, hy + 6, 10, 2, "#c4a87a");
    // 顔（明るい部分）
    drawPixel(ctx, hx + 1, hy + 2, 10, 2, "#e8c97a");
    drawPixel(ctx, hx + 2, hy + 4, 8, 2, "#e8c97a");
    drawPixel(ctx, hx + 3, hy + 6, 6, 2, "#e8c97a");
    // 目
    if (!g.isBlinking) {
      drawPixel(ctx, hx + 3, hy + 2, 2, 2, "#231714");
      drawPixel(ctx, hx + 8, hy + 2, 2, 2, "#231714");
    }
    // 鼻
    drawPixel(ctx, hx + 6, hy + 6, 2, 2, "#231714");
    // マズル
    drawPixel(ctx, hx + 9, hy + 4, 3, 2, "#c4a87a");
    drawPixel(ctx, hx + 11, hy + 2, 2, 2, "#c4a87a");
    // ほっぺ模様
    drawPixel(ctx, hx + 1, hy + 4, 2, 2, "#f0d090");
    drawPixel(ctx, hx + 9, hy + 4, 2, 2, "#f0d090");
  }, [drawPixel, P]);

  const drawCactus = useCallback((ctx: CanvasRenderingContext2D, x: number, w: number, h: number) => {
    const col = "#8B9B5A";
    const dark = "#6B7B3A";
    const gy = GROUND_Y / P;
    const cw = Math.floor(w / P);
    const ch = Math.floor(h / P);
    const cx = Math.floor(x / P);

    // メイン幹
    const trunkW = Math.min(cw, 3);
    for (let row = 0; row < ch; row++) {
      drawPixel(ctx, cx, gy - ch + row, trunkW, 1, col);
    }
    // 枝（高い障害物のみ）
    if (ch > 8) {
      drawPixel(ctx, cx + trunkW, gy - ch + 3, 2, 1, col);
      drawPixel(ctx, cx + trunkW + 1, gy - ch + 2, 1, 3, col);
      drawPixel(ctx, cx + trunkW + 2, gy - ch + 1, 1, 1, dark);
      drawPixel(ctx, cx - 2, gy - ch + 5, 2, 1, col);
      drawPixel(ctx, cx - 2, gy - ch + 4, 1, 2, col);
      drawPixel(ctx, cx - 3, gy - ch + 4, 1, 1, dark);
    }
    // 横幅が広い場合は複数幹
    if (cw > 4) {
      const tx2 = cx + cw - 3;
      const ch2 = ch - 2;
      for (let row = 0; row < ch2; row++) {
        drawPixel(ctx, tx2, gy - ch2 + row, 3, 1, col);
      }
      if (ch2 > 6) {
        drawPixel(ctx, tx2 + 3, gy - ch2 + 2, 1, 2, col);
        drawPixel(ctx, tx2 + 4, gy - ch2 + 1, 1, 1, dark);
      }
    }
  }, [drawPixel, P]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;

    const W = canvas.width;
    const H = canvas.height;
    const g = gameRef.current;

    // 地面のドット初期化
    g.groundDots = [];
    for (let i = 0; i < 20; i++) {
      g.groundDots.push({
        x: Math.random() * W,
        y: GROUND_Y + 6 + Math.random() * 10,
        w: 2 + Math.random() * 6,
      });
    }

    function update() {
      if (g.gameOver) return;

      g.frameCount++;

      // 難易度上昇: スコアに応じて速度アップ
      g.speed = Math.min(MAX_SPEED, BASE_SPEED + Math.floor(g.score / 5) * 0.3);

      // スコア
      if (g.running && g.frameCount % 6 === 0) {
        g.score++;
      }

      // ジャンプ
      if (g.isJumping) {
        g.velocityY += GRAVITY;
        g.shibaY += g.velocityY;
        if (g.shibaY >= 0) {
          g.shibaY = 0;
          g.velocityY = 0;
          g.isJumping = false;
        }
      }

      // 足のアニメーション
      if (!g.isJumping && g.running) {
        g.legTimer++;
        if (g.legTimer > 4) {
          g.legTimer = 0;
          g.legFrame = (g.legFrame + 1) % 3;
        }
      }

      // しっぽ
      g.tailAngle += 0.15 * g.tailDir;
      if (g.tailAngle > 1 || g.tailAngle < -1) g.tailDir *= -1;

      // 瞬き
      g.blinkTimer++;
      if (g.blinkTimer > 120) {
        g.isBlinking = true;
        if (g.blinkTimer > 126) {
          g.isBlinking = false;
          g.blinkTimer = 0;
        }
      }

      // 障害物生成
      if (g.running) {
        g.spawnTimer++;
        // 難易度上昇に伴いスポーン間隔を短く
        const minInterval = Math.max(40, 80 - Math.floor(g.score / 10) * 5);
        const maxInterval = Math.max(70, 140 - Math.floor(g.score / 10) * 8);
        const interval = minInterval + Math.random() * (maxInterval - minInterval);
        if (g.spawnTimer > interval) {
          g.spawnTimer = 0;
          const types = [
            { w: 8, h: 24 },   // 細い背の高いサボテン
            { w: 12, h: 20 },  // 中くらい
            { w: 16, h: 16 },  // 横長 低い
            { w: 6, h: 28 },   // 細長い
          ];
          // 難易度が上がると横長も出現
          if (g.score > 20) {
            types.push({ w: 22, h: 14 }); // より横長
          }
          if (g.score > 40) {
            types.push({ w: 28, h: 12 }); // かなり横長
          }
          const t = types[Math.floor(Math.random() * types.length)];
          g.obstacles.push({ x: W + 10, w: t.w, h: t.h });
        }
      }

      // 障害物移動
      for (let i = g.obstacles.length - 1; i >= 0; i--) {
        g.obstacles[i].x -= g.speed;
        if (g.obstacles[i].x < -40) {
          g.obstacles.splice(i, 1);
        }
      }

      // 雲移動
      for (const c of g.clouds) {
        c.x -= g.speed * 0.2;
        if (c.x < -30) c.x = W / P + 10;
      }

      // 地面ドット移動
      for (const d of g.groundDots) {
        d.x -= g.speed;
        if (d.x < -10) d.x = W + Math.random() * 20;
      }

      // 当たり判定
      const shibaLeft = SHIBA_X * P + 4;
      const shibaRight = (SHIBA_X + 20) * P - 4;
      const shibaTop = (GROUND_Y / P - 10 + g.shibaY / P) * P;
      const shibaBottom = GROUND_Y;

      for (const obs of g.obstacles) {
        const obsLeft = obs.x;
        const obsRight = obs.x + obs.w;
        const obsTop = GROUND_Y - obs.h;

        if (
          shibaRight > obsLeft + 4 &&
          shibaLeft < obsRight - 4 &&
          shibaBottom > obsTop + 4 &&
          shibaTop < GROUND_Y
        ) {
          g.gameOver = true;
          g.running = false;
          if (g.score > g.highScore) g.highScore = g.score;
        }
      }
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // 雲
      for (const c of g.clouds) {
        ctx.fillStyle = "#e0e0e0";
        const s = c.size;
        ctx.fillRect(c.x * P, c.y * P, 8 * s * P, 2 * P);
        ctx.fillRect((c.x - 1) * P, (c.y + 1) * P, 10 * s * P, 2 * P);
        ctx.fillRect((c.x + 1) * P, (c.y + 2) * P, 6 * s * P, 2 * P);
      }

      // スコア
      ctx.fillStyle = "rgba(35,23,20,0.2)";
      ctx.font = "16px monospace";
      ctx.textAlign = "right";
      ctx.fillText(String(g.score).padStart(5, "0"), W - 10, 22);

      if (g.highScore > 0) {
        ctx.fillStyle = "rgba(35,23,20,0.12)";
        ctx.font = "12px monospace";
        ctx.fillText("HI " + String(g.highScore).padStart(5, "0"), W - 10, 38);
      }

      // 柴犬
      const shibaBaseY = GROUND_Y / P - 10 + g.shibaY / P;
      drawShiba(ctx, shibaBaseY, g);

      // 障害物
      for (const obs of g.obstacles) {
        drawCactus(ctx, obs.x, obs.w, obs.h);
      }

      // 地面
      ctx.fillStyle = "#bbb";
      ctx.fillRect(0, GROUND_Y, W, 2);

      // 地面のドット
      ctx.fillStyle = "#ddd";
      for (const d of g.groundDots) {
        ctx.fillRect(d.x, d.y, d.w, 2);
      }

      // ゲームオーバー表示
      if (g.gameOver) {
        ctx.fillStyle = "rgba(35,23,20,0.7)";
        ctx.font = "bold 18px monospace";
        ctx.textAlign = "center";
        ctx.fillText("GAME OVER", W / 2, H / 2 - 10);
        ctx.fillStyle = "rgba(35,23,20,0.4)";
        ctx.font = "12px monospace";
        ctx.fillText("TAP TO RETRY", W / 2, H / 2 + 14);
      }

      // 開始前の表示
      if (!g.running && !g.gameOver) {
        ctx.fillStyle = "rgba(35,23,20,0.3)";
        ctx.font = "bold 14px monospace";
        ctx.textAlign = "center";
        ctx.fillText("TAP !!!", W / 2, H - 20);
      }
    }

    function gameLoop() {
      update();
      draw();
      animRef.current = requestAnimationFrame(gameLoop);
    }

    animRef.current = requestAnimationFrame(gameLoop);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [drawShiba, drawCactus, drawPixel, P]);

  const handleTap = useCallback(() => {
    const g = gameRef.current;
    if (g.gameOver) {
      // リセット
      g.gameOver = false;
      g.running = true;
      g.score = 0;
      g.speed = BASE_SPEED;
      g.obstacles = [];
      g.spawnTimer = 0;
      g.frameCount = 0;
      g.shibaY = 0;
      g.velocityY = 0;
      g.isJumping = false;
      return;
    }
    if (!g.running) {
      g.running = true;
    }
    if (!g.isJumping) {
      g.isJumping = true;
      g.velocityY = JUMP_VELOCITY;
    }
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
