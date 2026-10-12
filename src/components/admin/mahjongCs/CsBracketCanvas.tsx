"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  addTable, canvasToRounds, connect, disconnect, incomingCount, moveTable, openSeats,
  removeTable, setTableAdvance,
} from "@/lib/mahjongCsCanvas";
import type { CanvasDraft } from "@/lib/mahjongCsCanvas";
import type { MahjongCsEntrant } from "@/types/mahjong";

type Point = { x: number; y: number };
type View = Point & { z: number };
type Props = {
  draft: CanvasDraft;
  entrantsById: Map<string, MahjongCsEntrant>;
  editable: boolean;
  onChange(next: CanvasDraft): void;
};
type Gesture = {
  kind: "pan" | "card" | "connect";
  id?: string;
  pointerId: number;
  start: Point;
  point: Point;
  view: View;
  moved: boolean;
};
const CARD_W = 200;
const CARD_H = 160;
const clampZoom = (z: number) => Math.min(1.6, Math.max(0.4, z));
const translate = (p: Point) => `translate(${p.x}px, ${p.y}px)`;
function curve(from: Point, to: Point): string {
  const bend = Math.max(40, Math.abs(to.y - from.y) / 2);
  return `M ${from.x} ${from.y} C ${from.x} ${from.y - bend}, ${to.x} ${to.y + bend}, ${to.x} ${to.y}`;
}
export function arrowPath(from: Point, to: Point): string {
  return curve({ x: from.x + CARD_W / 2, y: from.y }, { x: to.x + CARD_W / 2, y: to.y + CARD_H });
}

export default function CsBracketCanvas({ draft, editable, onChange }: Props) {
  const frame = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const arrows = useRef(new Map<string, SVGPathElement>());
  const temporary = useRef<SVGPathElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const raf = useRef<number | null>(null);
  const view = useRef<View>({ x: 0, y: 0, z: 1 });
  const [selected, setSelected] = useState<string | null>(null);
  const latest = useRef({ draft, editable, onChange });
  latest.current = { draft, editable, onChange };
  const markerId = `cs-arrow-${useId().replace(/:/g, "")}`;
  const names = useMemo(() => new Map(canvasToRounds(draft.tables).rounds.flatMap(
    (round) => round.matches.map((match) => [match.matchId, match.label] as const),
  )), [draft.tables]);
  const name = (id: string) => names.get(id) ?? "卓";

  const paintView = (next: View) => {
    view.current = next;
    if (layer.current) layer.current.style.transform = `${translate(next)} scale(${next.z})`;
    if (frame.current) {
      frame.current.style.backgroundPosition = `${next.x}px ${next.y}px`;
      frame.current.style.backgroundSize = `${20 * next.z}px ${20 * next.z}px`;
    }
  };

  useEffect(() => {
    const position = (id: string, active: Gesture | null): Point => {
      const table = latest.current.draft.tables.find((t) => t.id === id)!;
      if (active?.kind !== "card" || active.id !== id || !active.moved) return table;
      return { x: table.x + (active.point.x - active.start.x) / active.view.z,
        y: table.y + (active.point.y - active.start.y) / active.view.z };
    };
    const paintTables = (active: Gesture | null) => {
      const tables = latest.current.draft.tables;
      for (const table of tables) {
        const card = cards.current.get(table.id);
        if (card) card.style.transform = translate(position(table.id, active));
        if (table.to && tables.some((t) => t.id === table.to)) {
          arrows.current.get(table.id)?.setAttribute("d", arrowPath(position(table.id, active), position(table.to, active)));
        }
      }
    };
    const tick = () => {
      raf.current = null;
      const active = gesture.current;
      if (!active?.moved) return;
      if (active.kind === "pan") {
        paintView({ ...active.view, x: active.view.x + active.point.x - active.start.x,
          y: active.view.y + active.point.y - active.start.y });
      } else if (active.kind === "card") paintTables(active);
      else {
        const rect = frame.current!.getBoundingClientRect();
        const source = latest.current.draft.tables.find((t) => t.id === active.id);
        if (!source || !temporary.current) return;
        temporary.current.setAttribute("d", curve({ x: source.x + CARD_W / 2, y: source.y }, {
          x: (active.point.x - rect.left - view.current.x) / view.current.z,
          y: (active.point.y - rect.top - view.current.y) / view.current.z,
        }));
      }
    };
    const cleanup = () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      raf.current = null;
      gesture.current = null;
      temporary.current?.setAttribute("d", "");
      paintTables(null);
    };
    const onMove = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) return;
      if (active.kind !== "pan" && !latest.current.editable) return cleanup();
      active.point = { x: event.clientX, y: event.clientY };
      if (!active.moved && Math.hypot(active.point.x - active.start.x, active.point.y - active.start.y) < 6) return;
      active.moved = true;
      event.preventDefault();
      if (raf.current === null) raf.current = requestAnimationFrame(tick);
    };
    const onUp = (event: PointerEvent) => {
      const active = gesture.current;
      if (!active || active.pointerId !== event.pointerId) return;
      active.point = { x: event.clientX, y: event.clientY };
      const { draft: current, editable: canEdit, onChange: change } = latest.current;
      if (active.moved && (canEdit || active.kind === "pan")) {
        if (active.kind === "pan") tick();
        else if (active.kind === "card" && current.tables.some((t) => t.id === active.id)) {
          const point = position(active.id!, active);
          change(moveTable(current, active.id!, point.x, point.y));
        } else if (active.kind === "connect") {
          const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-table]");
          const id = target?.getAttribute("data-table");
          if (id && id !== active.id && frame.current?.contains(target!)) change(connect(current, active.id!, id));
        }
      }
      cleanup();
    };
    const onCancel = (event: PointerEvent) => {
      if (gesture.current?.pointerId === event.pointerId) cleanup();
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (gesture.current) return;
      const rect = frame.current!.getBoundingClientRect();
      const old = view.current;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
      const z = clampZoom(old.z * Math.exp(-delta * 0.001));
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      paintView({ z, x: x - (x - old.x) * z / old.z, y: y - (y - old.y) * z / old.z });
    };
    const element = frame.current!;
    element.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("blur", cleanup);
    return () => {
      element.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("blur", cleanup);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, []);

  function start(event: ReactPointerEvent, kind: Gesture["kind"], id?: string) {
    if (event.button !== 0 || event.isPrimary === false || gesture.current || (kind !== "pan" && !editable)) return;
    event.preventDefault();
    event.stopPropagation();
    frame.current?.focus({ preventScroll: true });
    setSelected(null);
    const point = { x: event.clientX, y: event.clientY };
    gesture.current = { kind, id, pointerId: event.pointerId, start: point, point, view: { ...view.current }, moved: false };
  }
  function deleteArrow() {
    if (!editable || !selected) return;
    onChange(disconnect(draft, selected));
    setSelected(null);
  }
  function fitAll() {
    if (!draft.tables.length) return paintView({ x: 0, y: 0, z: 1 });
    const rect = frame.current!.getBoundingClientRect();
    const left = Math.min(...draft.tables.map((t) => t.x));
    const top = Math.min(...draft.tables.map((t) => t.y));
    const right = Math.max(...draft.tables.map((t) => t.x + CARD_W));
    const bottom = Math.max(...draft.tables.map((t) => t.y + CARD_H));
    const z = clampZoom(Math.min((rect.width - 64) / (right - left), (rect.height - 64) / (bottom - top)));
    paintView({ z, x: rect.width / 2 - (left + right) * z / 2, y: rect.height / 2 - (top + bottom) * z / 2 });
  }
  function createTable() {
    const rect = frame.current!.getBoundingClientRect();
    const { x, y, z } = view.current;
    const suffix = globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10).padEnd(8, "0");
    onChange(addTable(draft, `t_${suffix}`, (rect.width / 2 - x) / z - CARD_W / 2,
      (rect.height / 2 - y) / z - CARD_H / 2, 1));
  }
  const buttonClass = "rounded-lg border border-[color:var(--eb-line)] bg-white px-3 py-2 text-xs font-bold";
  return (
    <div className="space-y-3">
      {editable && <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={createTable}>卓を追加</button>
        <button type="button" className={buttonClass} onClick={fitAll}>全体を表示</button>
      </div>}
      <div ref={frame} role="region" aria-label="組み合わせキャンバス" tabIndex={0}
        className="relative overflow-hidden rounded-xl border border-[color:var(--eb-line)] bg-slate-50 outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        style={{ height: "min(70vh, 720px)", touchAction: "none", backgroundImage: "radial-gradient(#cbd5e1 1px, transparent 1px)", backgroundSize: "20px 20px" }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[data-table], [role="button"], button')) return;
          start(event, "pan");
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || !editable) return;
          if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteArrow(); }
        }}>
        <div ref={layer} className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `${translate(view.current)} scale(${view.current.z})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <defs><marker id={markerId} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--eb-green, #059669)" />
            </marker></defs>
            {draft.tables.map((table) => {
              const target = draft.tables.find((t) => t.id === table.to);
              return target && <path key={table.id} ref={(node) => { if (node) arrows.current.set(table.id, node); else arrows.current.delete(table.id); }}
                d={arrowPath(table, target)} fill="none" stroke="var(--eb-green, #059669)"
                strokeWidth={editable && selected === table.id ? 5 : 3} markerEnd={`url(#${markerId})`}
                style={{ pointerEvents: editable ? "stroke" : "none", cursor: editable ? "pointer" : undefined }}
                role={editable ? "button" : undefined} tabIndex={editable ? 0 : undefined}
                aria-label={`${name(table.id)}→${name(target.id)}の矢印`}
                onClick={() => { if (editable) { setSelected(table.id); frame.current?.focus({ preventScroll: true }); } }}
                onKeyDown={(event) => {
                  if (editable && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault(); setSelected(table.id); frame.current?.focus({ preventScroll: true });
                  }
                }} />;
            })}
            <path ref={temporary} fill="none" stroke="var(--eb-green, #059669)" strokeWidth="3" strokeDasharray="6 4" markerEnd={`url(#${markerId})`} />
          </svg>
          {draft.tables.map((table) => <div key={table.id} data-table={table.id}
            ref={(node) => { if (node) cards.current.set(table.id, node); else cards.current.delete(table.id); }}
            className="absolute left-0 top-0 rounded-xl border border-[color:var(--eb-line)] bg-white shadow-sm"
            style={{ width: CARD_W, height: CARD_H, transform: translate(table) }}>
            {editable && <button type="button" aria-label={`${name(table.id)}から矢印を引く`}
              className="absolute -top-2 left-1/2 z-10 h-4 w-4 -translate-x-1/2 cursor-crosshair rounded-full border-2 border-white bg-emerald-600 ring-1 ring-emerald-700"
              onPointerDown={(event) => start(event, "connect", table.id)} />}
            <h3 aria-label={editable ? `${name(table.id)}を移動` : undefined}
              className={`rounded-t-xl bg-emerald-50 px-3 py-3 text-sm font-bold select-none ${editable ? "cursor-grab" : ""}`}
              onPointerDown={editable ? (event) => start(event, "card", table.id) : undefined}>{name(table.id)}</h3>
            <div className="space-y-3 p-3 text-xs">
              <div className="flex items-center justify-between gap-1">
                <span>{table.to === null ? `表彰 ${table.advanceCount}名` : `勝ち抜け ${table.advanceCount}名`}</span>
                {editable && <div className="flex gap-1">
                  <button type="button" className="h-7 w-7 rounded border disabled:opacity-30" aria-label="勝ち抜けを減らす" disabled={table.advanceCount <= 1}
                    onClick={() => onChange(setTableAdvance(draft, table.id, table.advanceCount - 1))}>−</button>
                  <button type="button" className="h-7 w-7 rounded border disabled:opacity-30" aria-label="勝ち抜けを増やす" disabled={table.advanceCount >= 3}
                    onClick={() => onChange(setTableAdvance(draft, table.id, table.advanceCount + 1))}>＋</button>
                  <button type="button" className="h-7 w-7 rounded border text-red-700" aria-label={`${name(table.id)}を削除`}
                    onClick={() => onChange(removeTable(draft, table.id))}>×</button>
                </div>}
              </div>
              <dl className="flex justify-between gap-1 text-center">
                {[["入ってくる人数", incomingCount(draft.tables, table.id)], ["直接", table.playerIds.length], ["空席", openSeats(draft.tables, table.id)]].map(([label, count]) =>
                  <div key={label}><dt className="text-[10px] text-slate-500">{label}</dt><dd aria-label={String(label)} className="mt-1 font-bold">{count}</dd></div>)}
              </dl>
            </div>
            {editable && selected === table.id && table.to && <button type="button" aria-label="矢印を消す" onClick={deleteArrow}
              className="absolute -right-9 top-0 h-8 w-8 rounded-full border bg-white text-red-700 shadow-sm">×</button>}
          </div>)}
        </div>
      </div>
    </div>
  );
}
