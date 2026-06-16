"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { MahjongStanding, MahjongLeagueTier } from "@/types";

/**
 * 正面向きの 3D 麻雀リーグ・ピラミッド（深色ジュエル調）
 * - Three.js で実装。前面＋遠近＋陰影で立体感（横向き擬似立体ではない）
 * - 自分のアバター（本番では LINE プロフィール画像）を所属リーグに浮遊表示・上下アニメーション
 * - WebGL 非対応時はフォールバックで何も描画しない（リストは別途表示）
 */

const TIER_3D: Record<MahjongLeagueTier, number> = {
  M1: 0xe4007f, // マゼンタ（画像準拠）
  M2: 0x00a0e9, // シアン
  M3: 0xffcb05, // イエロー
};

const TIER_ORDER: MahjongLeagueTier[] = ["M1", "M2", "M3"];

/** 丸く切り抜いたアバターを生成（四角い背景なし・周囲は透明） */
function makeCircleCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext("2d")!;
  return { canvas, ctx };
}

function drawInitial(ctx: CanvasRenderingContext2D, name: string, ringColor: string) {
  ctx.clearRect(0, 0, 160, 160);
  ctx.save();
  ctx.beginPath();
  ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#ECE6DA";
  ctx.fillRect(0, 0, 160, 160);
  ctx.fillStyle = "#8C7A4E";
  ctx.font = "600 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name.trim().charAt(0) || "?", 80, 86);
  ctx.restore();
  // 丸い縁取り
  ctx.beginPath();
  ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = ringColor;
  ctx.stroke();
}

function drawImageCircle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  ringColor: string
) {
  ctx.clearRect(0, 0, 160, 160);
  ctx.save();
  ctx.beginPath();
  ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.clip();
  // 中央クロップで円に画像を敷き詰める
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 6, 6, 148, 148);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.lineWidth = 6;
  ctx.strokeStyle = ringColor;
  ctx.stroke();
}

function flagTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 220;
  c.height = 64;
  const x = c.getContext("2d")!;
  x.fillStyle = "#2E2A26";
  if (x.roundRect) {
    x.beginPath();
    x.roundRect(26, 8, 168, 40, 20);
    x.fill();
  } else {
    x.fillRect(26, 8, 168, 40);
  }
  x.fillStyle = "#E8CE86";
  x.font = "500 26px sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, 110, 29);
  return new THREE.CanvasTexture(c);
}

function labelTexture(text: string, sub?: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 128;
  const x = c.getContext("2d")!;
  x.fillStyle = "rgba(255,255,255,0.96)";
  x.font = "600 60px sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText(text, 128, sub ? 50 : 64);
  if (sub) {
    x.font = "400 30px sans-serif";
    x.fillStyle = "rgba(255,255,255,0.82)";
    x.fillText(sub, 128, 96);
  }
  return new THREE.CanvasTexture(c);
}

export function LeaguePyramid3D({
  standings,
  currentUserId,
  height = 300,
}: {
  standings: MahjongStanding[];
  currentUserId?: string;
  height?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const counts: Record<MahjongLeagueTier, number> = { M1: 0, M2: 0, M3: 0 };
    standings.forEach((s) => (counts[s.tier] += 1));
    const me = currentUserId
      ? standings.find((s) => s.lineUserId === currentUserId)
      : undefined;

    const W = host.clientWidth || 360;
    const H = height;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      return; // WebGL 非対応
    }
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(34, W / H, 0.1, 100);
    cam.position.set(0, 1.7, 9.4);
    cam.lookAt(0, 1.4, 0);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(-4, 7, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.28);
    fill.position.set(5, 2, 4);
    scene.add(fill);

    const tiers = [
      { t: "M1" as const, rb: 1.05, rt: 0.16, y: 3.05, front: 1.0 },
      { t: "M2" as const, rb: 1.85, rt: 1.05, y: 1.85, front: 1.7 },
      { t: "M3" as const, rb: 2.65, rt: 1.85, y: 0.62, front: 2.45 },
    ];

    const grp = new THREE.Group();
    const disposables: { dispose: () => void }[] = [];

    tiers.forEach((tier) => {
      const g = new THREE.CylinderGeometry(tier.rt, tier.rb, 1.2, 4, 1);
      const m = new THREE.MeshStandardMaterial({
        color: TIER_3D[tier.t],
        roughness: 0.82,
        metalness: 0.05,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.y = Math.PI / 4;
      mesh.position.y = tier.y;
      grp.add(mesh);
      disposables.push(g, m);

      const sub = tier.t === "M3" ? `${counts.M3}名` : `${counts[tier.t]}名`;
      const labTex = labelTexture(tier.t, sub);
      const labMat = new THREE.SpriteMaterial({ map: labTex, transparent: true });
      const lab = new THREE.Sprite(labMat);
      lab.scale.set(1.1, 0.55, 1);
      lab.position.set(0, tier.y, tier.front);
      grp.add(lab);
      disposables.push(labTex, labMat);
    });

    grp.position.y = -1.0;
    scene.add(grp);

    // 自分のアバター（丸アイコンのみ・四角背景なし・浮遊アニメーション）
    let avatarSprite: THREE.Sprite | null = null;
    const meGrp = new THREE.Group();
    if (me) {
      const tierDef = tiers.find((x) => x.t === me.tier)!;
      const ringColorHex = "#" + TIER_3D[me.tier].toString(16).padStart(6, "0");

      const { canvas: avCanvas, ctx: avCtx } = makeCircleCanvas();
      drawInitial(avCtx, me.displayName, ringColorHex);
      const avTex = new THREE.CanvasTexture(avCanvas);
      const avMat = new THREE.SpriteMaterial({ map: avTex, transparent: true });
      avatarSprite = new THREE.Sprite(avMat);
      avatarSprite.scale.set(0.9, 0.9, 1);
      meGrp.add(avatarSprite);
      disposables.push(avTex, avMat);

      // 本番 LINE 画像があれば丸く切り抜いて差し替え（同一オリジンプロキシ経由）
      if (me.pictureUrl) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          drawImageCircle(avCtx, img, ringColorHex);
          avTex.needsUpdate = true;
        };
        img.src = `/api/avatar?url=${encodeURIComponent(me.pictureUrl)}`;
      }

      const flagTex = flagTexture("あなた");
      const flagMat = new THREE.SpriteMaterial({ map: flagTex, transparent: true });
      const flag = new THREE.Sprite(flagMat);
      flag.scale.set(1.05, 0.32, 1);
      flag.position.set(0, 0.62, 0);
      meGrp.add(flag);
      disposables.push(flagTex, flagMat);

      meGrp.position.set(0, tierDef.y - 1.0, tierDef.front + 0.1);
      scene.add(meGrp);
    }

    let raf = 0;
    let t0 = 0;
    let running = true;
    const animate = () => {
      if (!running) return;
      t0 += 0.016;
      grp.rotation.y = Math.sin(t0 * 0.5) * 0.16;
      meGrp.rotation.y = grp.rotation.y;
      if (avatarSprite) {
        avatarSprite.position.y = Math.sin(t0 * 1.6) * 0.07;
      }
      renderer.render(scene, cam);
      raf = requestAnimationFrame(animate);
    };
    animate();

    const onResize = () => {
      const w = host.clientWidth || 360;
      renderer.setSize(w, H);
      cam.aspect = w / H;
      cam.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [standings, currentUserId, height]);

  return <div ref={hostRef} style={{ width: "100%", height }} aria-label="麻雀リーグの3Dピラミッド" />;
}

export { TIER_ORDER };
