"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MahjongStanding, MahjongLeagueTier } from "@/types";

/**
 * 3D 麻雀リーグ・ピラミッド（TILES 案・確定版）
 * --------------------------------------------------------------------------
 * - Three.js で角錐をスタック：M1(頂点) → M2 → M3(土台)。前面＋遠近＋陰影で立体表現。
 * - 自分のアバター（本番は LINE プロフィール画像）を所属リーグに「あなた」フラッグ付きで浮遊表示。
 * - M1/M2/M3 ラベルは Canvas スプライトではなく **左カラムの固定 HTML オーバーレイ**
 *   （ゴールド箔風セリフ体）。回転しても動かない＝アバターと重ならない。
 * - 既定はゆっくり連続回転。mode で 旋回 / ゆらぎ / 停止 を切替。
 * - WebGL 非対応・prefers-reduced-motion を考慮。アンマウント時に GPU リソースを破棄。
 */

// DS リーグ色（順位リストやバッジと一致させる）
const TIER_HEX: Record<MahjongLeagueTier, number> = {
  M1: 0xa2125a, // magenta
  M2: 0x1172a5, // blue
  M3: 0xb48f13, // gold
};
const TIER_ORDER: MahjongLeagueTier[] = ["M1", "M2", "M3"];
const tierOf = (rank: number): MahjongLeagueTier => (rank <= 4 ? "M1" : rank <= 8 ? "M2" : "M3");

type SpinMode = "spin" | "sway" | "off";

// 左ラベルのキッカー
const KICKER: Record<MahjongLeagueTier, string> = { M1: "PREMIER", M2: "CHALLENGER", M3: "CONTENDER" };
// 各リーグの画面上での縦位置（0–1, canvas 高さ基準）。カメラ固定なので定数で十分。
const LABEL_TOP: Record<MahjongLeagueTier, number> = { M1: 0.07, M2: 0.37, M3: 0.645 };
const GOLD = "linear-gradient(180deg,#f9ead0,#e6bd52 42%,#c9962a 70%,#a9781a)";

// 各段の幾何（CylinderGeometry: radialSegments=4 で四角錐台）
const TIERS = [
  { t: "M1" as const, rb: 1.05, rt: 0.16, y: 3.05, front: 1.0 },
  { t: "M2" as const, rb: 1.85, rt: 1.05, y: 1.85, front: 1.7 },
  { t: "M3" as const, rb: 2.65, rt: 1.85, y: 0.62, front: 2.45 },
];

// 円形アバター生成（四角背景なし・周囲透明）
function drawInitial(ctx: CanvasRenderingContext2D, name: string, ring: string) {
  ctx.clearRect(0, 0, 160, 160);
  ctx.save();
  ctx.beginPath(); ctx.arc(80, 80, 74, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#ECE6DA"; ctx.fillRect(0, 0, 160, 160);
  ctx.fillStyle = "#8C7A4E"; ctx.font = "700 72px 'Noto Sans JP', sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText((name || "?").trim().charAt(0), 80, 88);
  ctx.restore();
  ctx.beginPath(); ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.lineWidth = 7; ctx.strokeStyle = ring; ctx.stroke();
}
function drawImageCircle(ctx: CanvasRenderingContext2D, img: HTMLImageElement, ring: string) {
  ctx.clearRect(0, 0, 160, 160);
  ctx.save();
  ctx.beginPath(); ctx.arc(80, 80, 74, 0, Math.PI * 2); ctx.clip();
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 6, 6, 148, 148);
  ctx.restore();
  ctx.beginPath(); ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.lineWidth = 7; ctx.strokeStyle = ring; ctx.stroke();
}
function flagTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas"); c.width = 240; c.height = 72;
  const x = c.getContext("2d")!;
  x.fillStyle = "#2E2A26";
  x.beginPath();
  (x.roundRect ? x.roundRect(34, 10, 172, 44, 22) : x.rect(34, 10, 172, 44));
  x.fill();
  x.fillStyle = "#E8CE86"; x.font = "700 27px 'Noto Sans JP', sans-serif";
  x.textAlign = "center"; x.textBaseline = "middle";
  x.fillText(text, 120, 33);
  return new THREE.CanvasTexture(c);
}

export function LeaguePyramid3D({
  standings,
  currentUserId,
  height = 280,
  mode = "spin",
}: {
  standings: MahjongStanding[];
  currentUserId?: string;
  height?: number;
  /** "spin" 旋回（既定）/ "sway" ゆらぎ / "off" 停止。reduced-motion は内部で停止に倒す。 */
  mode?: SpinMode;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<SpinMode>(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // --- 左固定ラベル用の集計（描画とは独立に毎レンダー算出）---
  const counts: Record<MahjongLeagueTier, number> = { M1: 0, M2: 0, M3: 0 };
  standings.forEach((s) => { counts[tierOf(s.rank)] += 1; });
  const me = currentUserId ? standings.find((s) => s.lineUserId === currentUserId) : undefined;
  const meTier = me ? tierOf(me.rank) : null;

  useEffect(() => {
    const THREEok = typeof window !== "undefined";
    const host = hostRef.current;
    if (!THREEok || !host) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const W = host.clientWidth || 340;
    const Hh = height;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); }
    catch { return; } // WebGL 非対応 → 何も描画しない（順位リストは別途表示）
    renderer.setSize(W, Hh);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.domElement.style.display = "block";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, W / Hh, 0.1, 100);
    cam.position.set(0, 1.7, 9.6);
    cam.lookAt(0, 1.35, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.66));
    const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(-4, 7, 6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(5, 2, 4); scene.add(fill);
    const rim = new THREE.DirectionalLight(0xfff2cc, 0.25); rim.position.set(0, 3, -6); scene.add(rim);

    const grp = new THREE.Group();
    const disposables: { dispose: () => void }[] = [];
    TIERS.forEach((tier) => {
      const g = new THREE.CylinderGeometry(tier.rt, tier.rb, 1.2, 4, 1);
      const hex = TIER_HEX[tier.t];
      const m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0.18, flatShading: true, emissive: hex, emissiveIntensity: 0.14 });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.y = Math.PI / 4; mesh.position.y = tier.y;
      grp.add(mesh); disposables.push(g, m);
    });
    grp.position.set(0.7, -0.5, 0); // 右へ寄せて左にラベル列を確保／少し上げて基部の見切れを防止
    scene.add(grp);

    // 自分のアバター（常に正面・所属リーグ前面に浮遊）
    let avatarSprite: THREE.Sprite | null = null;
    const meGrp = new THREE.Group();
    if (me && meTier) {
      const def = TIERS.find((x) => x.t === meTier)!;
      const ring = "#" + TIER_HEX[meTier].toString(16).padStart(6, "0");
      const avCanvas = document.createElement("canvas"); avCanvas.width = 160; avCanvas.height = 160;
      const avCtx = avCanvas.getContext("2d")!;
      drawInitial(avCtx, me.displayName, ring);
      const avTex = new THREE.CanvasTexture(avCanvas);
      const avMat = new THREE.SpriteMaterial({ map: avTex, transparent: true, depthTest: false });
      avatarSprite = new THREE.Sprite(avMat);
      avatarSprite.scale.set(0.92, 0.92, 1); avatarSprite.renderOrder = 10;
      meGrp.add(avatarSprite); disposables.push(avTex, avMat);

      // 本番：LINE 画像を同一オリジンプロキシ経由で円形に差し替え（WebGL タイント回避）
      if (me.pictureUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => { drawImageCircle(avCtx, img, ring); avTex.needsUpdate = true; };
        img.src = `/api/avatar?url=${encodeURIComponent(me.pictureUrl)}`;
      }

      const flagTex = flagTexture("あなた");
      const flagMat = new THREE.SpriteMaterial({ map: flagTex, transparent: true, depthTest: false });
      const flag = new THREE.Sprite(flagMat);
      flag.scale.set(1.08, 0.34, 1); flag.position.set(0, 0.64, 0); flag.renderOrder = 10;
      meGrp.add(flag); disposables.push(flagTex, flagMat);

      meGrp.position.set(0.7, def.y - 0.5, def.front + 0.55);
      scene.add(meGrp);
    }

    let raf = 0, t0 = 0, running = true, spinY = -0.32;
    const animate = () => {
      if (!running) return;
      const md: SpinMode = reduce ? "off" : modeRef.current;
      t0 += 0.016;
      if (md === "spin") { spinY += 0.0019; grp.rotation.y = spinY; }       // 1周 ≈ 55s
      else if (md === "sway") { grp.rotation.y = -0.18 + Math.sin(t0 * 0.5) * 0.42; }
      else { grp.rotation.y = -0.32; }
      if (avatarSprite) avatarSprite.position.y = md === "off" ? 0 : Math.sin(t0 * 1.7) * 0.08;
      renderer.render(scene, cam);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const w = host.clientWidth || 340;
      renderer.setSize(w, Hh); cam.aspect = w / Hh; cam.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
    };
    // 再構築は standings/currentUserId/height のみ。mode 変更は modeRef 経由で WebGL を作り直さない。
    // me/meTier は standings/currentUserId から導出（closure 参照）。毎レンダー再構築を避けるため依存に含めない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, currentUserId, height]);

  return (
    <div style={{ position: "relative", width: "100%", height }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} aria-label="麻雀リーグの3Dピラミッド" />
      {/* 左固定ラベル（ゴールド箔風セリフ体） */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {TIER_ORDER.map((t) => {
          const col = `var(--eb-league-${t.toLowerCase()})`;
          const meHere = meTier === t;
          return (
            <div key={t} style={{ position: "absolute", left: 12, top: `${LABEL_TOP[t] * 100}%`, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, transform: "rotate(45deg)", background: `linear-gradient(135deg, rgba(255,255,255,.85), ${col})`, boxShadow: `inset 0 0 0 1px rgba(255,255,255,.4), 0 0 0 1px ${col}, 0 0 ${meHere ? 14 : 5}px ${meHere ? col : "rgba(0,0,0,.12)"}` }} />
              <div style={{ lineHeight: 1.05 }}>
                <div style={{ fontFamily: "'Noto Serif JP', serif", fontSize: 9.5, fontWeight: 600, letterSpacing: ".22em", background: GOLD, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>{KICKER[t]}</div>
                <div style={{ fontFamily: "'Noto Serif JP', serif", fontSize: 33, fontWeight: 900, letterSpacing: "-.01em", marginTop: 1,
                  background: `linear-gradient(168deg, #ffffff 8%, ${col} 62%, color-mix(in srgb, ${col} 60%, #5a0f33) 100%)`,
                  WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent",
                  filter: `drop-shadow(0 1px 0 rgba(255,255,255,.6)) drop-shadow(0 2px 3px rgba(40,20,10,.28)) drop-shadow(0 0 ${meHere ? 11 : 0}px ${col})` }}>{t}</div>
                <div style={{ fontSize: 10.5, fontWeight: 700, color: meHere ? col : "var(--text-tertiary)", marginTop: 3 }}>{counts[t]}名{meHere ? " ・ あなた" : ""}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { TIER_ORDER };
