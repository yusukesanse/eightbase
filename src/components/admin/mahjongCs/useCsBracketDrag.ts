"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Chip } from "@/lib/mahjongCsBracketEdit";

export type PickedChip = { chip: Chip; from: string };
const DRAG_THRESHOLD = 6;
// チップの比較用キーを生成する。
export function chipKey(chip: Chip): string {
  return JSON.stringify(chip);
}
// ゴーストを除いた座標直下の置き場を調べる。
function zoneAtPoint(x: number, y: number): string | null {
  return document.elementFromPoint(x, y)?.closest("[data-zone]")?.getAttribute("data-zone") ?? null;
}
// 座標を参照に保持し、固定のリスナーと一回の描画予約でドラッグする。
export function useCsBracketDrag(locked: boolean, apply: (picked: PickedChip, zone: string) => void) {
  const [selected, setSelected] = useState<PickedChip | null>(null);
  const [drag, setDrag] = useState<(PickedChip & { zone: string | null }) | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const point = useRef({ x: 0, y: 0 });
  const press = useRef<(PickedChip & { x: number; y: number; moved: boolean; pointerId: number }) | null>(null);
  const hover = useRef<string | null>(null);
  const raf = useRef<number | null>(null);
  const suppressClickUntil = useRef(0);
  const latest = useRef({ locked, apply });
  latest.current = { locked, apply };

  // 選択したチップを再タップした場合は選択を解除する。
  const select = useCallback((picked: PickedChip) => {
    if (latest.current.locked) return;
    setSelected((current) => current && chipKey(current.chip) === chipKey(picked.chip) ? null : picked);
  }, []);
  // 指の位置をゴーストへ反映し、枠が変わった場合だけ再描画する。
  const tick = useCallback(() => {
    raf.current = null;
    const { x, y } = point.current;
    if (ghostRef.current) {
      ghostRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(1.06)`;
    }
    const zone = zoneAtPoint(x, y);
    if (zone !== hover.current) {
      hover.current = zone;
      setDrag((current) => current ? { ...current, zone } : null);
    }
  }, []);
  // 次の描画予約を一つにまとめる。
  const schedule = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(tick);
  }, [tick]);
  // ドラッグの参照と描画予約を解放する。
  const cleanup = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    press.current = null;
    hover.current = null;
    setDrag(null);
  }, []);

  useEffect(() => {
    // 閾値を超えた移動だけドラッグとして扱う。
    const onMove = (e: PointerEvent) => {
      const current = press.current;
      if (!current || current.pointerId !== e.pointerId) return;
      if (latest.current.locked) return cleanup();
      point.current = { x: e.clientX, y: e.clientY };
      if (!current.moved) {
        if (Math.hypot(e.clientX - current.x, e.clientY - current.y) < DRAG_THRESHOLD) return;
        current.moved = true;
        setSelected(null);
        hover.current = current.from;
        setDrag({ chip: current.chip, from: current.from, zone: current.from });
      }
      e.preventDefault();
      schedule();
    };
    // 指を離した位置へ置くか、タップ選択に切り替える。
    const onUp = (e: PointerEvent) => {
      const current = press.current;
      if (!current || current.pointerId !== e.pointerId) return;
      if (!latest.current.locked) {
        if (current.moved) {
          const zone = zoneAtPoint(e.clientX, e.clientY);
          if (zone && zone !== current.from) latest.current.apply(current, zone);
          suppressClickUntil.current = Date.now() + 300;
        } else {
          select(current);
        }
      }
      cleanup();
    };
    // 中断した指の操作だけ取り消す。
    const onCancel = (e: PointerEvent) => {
      if (press.current?.pointerId === e.pointerId) cleanup();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [cleanup, schedule, select]);

  // つまみ始めの位置とチップを記録する。
  const onPointerDown = useCallback((e: ReactPointerEvent, picked: PickedChip) => {
    if (latest.current.locked || press.current || e.button !== 0 || e.isPrimary === false) return;
    point.current = { x: e.clientX, y: e.clientY };
    press.current = { ...picked, ...point.current, moved: false, pointerId: e.pointerId };
  }, []);
  // 選択中のチップをタップした置き場へ移動する。
  const onZoneClick = useCallback((zone: string) => {
    if (latest.current.locked || Date.now() < suppressClickUntil.current || !selected) return;
    latest.current.apply(selected, zone);
    setSelected(null);
  }, [selected]);
  return { selected, drag, ghostRef, point, onPointerDown, onZoneClick, select };
}
