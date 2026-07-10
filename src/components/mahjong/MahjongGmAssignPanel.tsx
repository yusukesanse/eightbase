"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ACCENT } from "@/components/mahjong/leagueShared";

/**
 * ゲームマスター（GM）専用の手動卓振り分けパネル。
 * 未配置/A卓/B卓/待機 に参加者を配置し、「この半荘の卓を確定」で
 * /api/mahjong/day/assign に送る。自己申告 UI とは別セクション。
 *
 * 操作は「指でつまんで枠へ運ぶ」。**Pointer Events** で実装しており、タッチでもマウスでも同じ経路。
 * HTML5 の drag イベント（draggable/dragstart/drop）はタッチでは発火せず、LINEミニアプリ
 * （スマホの WebView）では一切動かないため使っていない。
 * ドラッグせずに離した場合は「タップで選択 → 置きたい枠をタップ」として扱う（片手操作の保険）。
 *
 * 追従を滑らかに保つための決めごと（崩すと目に見えてカクつく）:
 *  - Chip / DropZone は**このファイルのトップレベル**に置く。コンポーネント内で定義すると
 *    レンダーごとに別のコンポーネント型になり、チップが再マウントされて指の追従が切れる。
 *  - 指の座標は state に入れない。ref に溜めて rAF で ghost の transform を直接書く。
 *    state を更新するのは「真下の枠が変わった瞬間」だけ。
 */

interface PoolMember { lineUserId: string; displayName: string; pictureUrl?: string }
type Zone = "pool" | "A" | "B" | "waiting";

const ZONE_META: { zone: Zone; label: string; cap?: number }[] = [
  { zone: "A", label: "A卓", cap: 4 },
  { zone: "B", label: "B卓", cap: 4 },
  { zone: "waiting", label: "待機（抜け番）" },
];

/** この距離(px)を超えて指が動いたら「タップ」ではなく「ドラッグ」と判定する。 */
const DRAG_THRESHOLD = 6;

/** 座標直下の枠を返す（ゴーストは pointer-events:none なので拾わない）。 */
function zoneAtPoint(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y);
  const holder = el?.closest("[data-zone]");
  const z = holder?.getAttribute("data-zone");
  return z === "pool" || z === "A" || z === "B" || z === "waiting" ? z : null;
}

/* ───────── 参加者カード ─────────
 * 指でつまむ対象なので、タッチ目標として十分な高さ（48px）を確保する。
 * touch-action:none が無いと、指を動かした瞬間にページのスクロールへ持っていかれる。 */
const Chip = memo(function Chip({
  m, selected, dragging, locked, onPointerDown,
}: {
  m: PoolMember;
  selected: boolean;
  dragging: boolean;
  locked: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      aria-pressed={selected}
      // 枠の onClick へ伝播すると、その枠へ即移動してしまうため止める。
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, m.lineUserId); }}
      className={`inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white border select-none ${dragging ? "opacity-30" : ""} ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      style={{
        touchAction: "none",
        borderColor: selected ? ACCENT : "#e4e7e9",
        color: "#231714",
        boxShadow: selected ? `0 0 0 2px ${ACCENT}` : "0 1px 2px rgba(35,23,20,.06)",
      }}
    >
      {m.displayName}
    </button>
  );
});

/* ───────── 置き場（未配置 / A卓 / B卓 / 待機） ───────── */
const DropZone = memo(function DropZone({
  zone, label, cap, members, lit, over, emptyText, litText, armed, onZoneClick, renderChip,
}: {
  zone: Zone;
  label: string;
  cap?: number;
  members: PoolMember[];
  lit: boolean;
  over: boolean;
  emptyText: string;
  litText: string;
  armed: boolean;
  onZoneClick: (zone: Zone) => void;
  renderChip: (m: PoolMember) => React.ReactNode;
}) {
  const isPool = zone === "pool";
  return (
    <div
      data-zone={zone}
      onClick={() => onZoneClick(zone)}
      className={`rounded-2xl border border-dashed p-2.5 transition-colors ${isPool ? "min-h-[56px]" : "min-h-[72px]"} ${armed ? "cursor-pointer" : ""}`}
      style={{
        borderColor: over ? "#d8533a" : lit ? ACCENT : isPool ? "#e4e7e9" : "#c9d6cf",
        background: lit ? `color-mix(in srgb, ${ACCENT} 10%, #fff)` : isPool ? "#fff" : "#f7faf8",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-extrabold" style={{ color: over ? "#d8533a" : isPool ? "#97999d" : "#5f7a80" }}>
          {label}{cap != null ? `（${members.length}/${cap}）` : `（${members.length}）`}
        </span>
        {lit && <span className="text-[10px] font-bold" style={{ color: ACCENT }}>{isPool ? "ここに戻す" : "ここに置く"}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.length === 0 ? (
          <span className="text-[11px] text-[#231714]/30">{lit ? litText : emptyText}</span>
        ) : (
          members.map((m) => renderChip(m))
        )}
      </div>
    </div>
  );
});

export function MahjongGmAssignPanel({ eventDate, onChanged }: { eventDate: string; onChanged: () => void }) {
  const [round, setRound] = useState(1);
  const [locked, setLocked] = useState(false);
  const [pool, setPool] = useState<PoolMember[]>([]);
  const [place, setPlace] = useState<Record<string, Zone>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // タップ操作: 選択中の参加者。枠をタップするとそこへ移動する。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ドラッグ中の参加者と、指の真下の枠。**座標は含めない**（含めると毎フレーム再レンダーになる）。
  const [drag, setDrag] = useState<{ id: string; from: Zone; zone: Zone | null } | null>(null);

  const ghostRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ id: string; from: Zone; x: number; y: number; moved: boolean } | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  const hoverZone = useRef<Zone | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetch(`/api/mahjong/day/assignment?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setRound(d.round ?? 1);
        setLocked(!!d.locked);
        setPool(d.pool ?? []);
        const p: Record<string, Zone> = {};
        for (const m of d.pool ?? []) p[m.lineUserId] = "pool";
        for (const t of d.draft?.tables ?? []) {
          if (t.label === "A" || t.label === "B") for (const id of t.memberIds) p[id] = t.label;
        }
        for (const id of d.draft?.waiting ?? []) p[id] = "waiting";
        setPlace(p);
        setError(null);
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);

  const move = useCallback((id: string, zone: Zone) => {
    if (locked) return;
    setDone(false);
    setSelectedId(null);
    setPlace((p) => ({ ...p, [id]: zone }));
  }, [locked]);

  /* ───────── つまんで運ぶ（Pointer Events。タッチ/マウス共通） ───────── */

  // 1フレームに1回だけ、ゴーストの transform を直接書き、枠が変わったときだけ state を更新する。
  const tick = useCallback(() => {
    raf.current = null;
    const { x, y } = point.current;
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(1.06)`;
    const z = zoneAtPoint(x, y);
    if (z !== hoverZone.current) {
      hoverZone.current = z;
      setDrag((d) => (d ? { ...d, zone: z } : d));
    }
  }, []);

  const schedule = useCallback(() => {
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const cleanup = useCallback(() => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    press.current = null;
    hoverZone.current = null;
    setDrag(null);
  }, []);

  // pointermove/up は window で**一度だけ**張る。要素に付けると、再レンダーや
  // レイアウト変化で取りこぼす余地が残る（pointer capture も要素の生存が前提）。
  // 実際に処理するかは press.current（ref）で判断するので、張り直しは不要。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      point.current = { x: e.clientX, y: e.clientY };
      if (!p.moved) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        p.moved = true;
        setSelectedId(null); // ドラッグに切り替わったらタップ選択は解除
        hoverZone.current = p.from;
        setDrag({ id: p.id, from: p.from, zone: p.from });
      }
      e.preventDefault(); // スクロール/テキスト選択を抑止
      schedule();
    };

    const onUp = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (p.moved) {
        const zone = zoneAtPoint(e.clientX, e.clientY);
        if (zone && zone !== p.from) move(p.id, zone); // 枠の外で離したら元のまま
      } else {
        setSelectedId((cur) => (cur === p.id ? null : p.id)); // 動かさずに離した＝タップ
      }
      cleanup();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cleanup);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
    };
  }, [move, schedule, cleanup]);

  const onPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    if (locked) return;
    point.current = { x: e.clientX, y: e.clientY };
    press.current = { id, from: (place[id] ?? "pool") as Zone, x: e.clientX, y: e.clientY, moved: false };
  }, [locked, place]);

  const inZone = (z: Zone) => pool.filter((m) => (place[m.lineUserId] ?? "pool") === z);
  const aCount = inZone("A").length;
  const bCount = inZone("B").length;
  const unplaced = inZone("pool").length;
  const valid = !locked && unplaced === 0 && aCount <= 4 && bCount <= 4 && aCount + bCount >= 1;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const tables = [
        { label: "A", memberIds: inZone("A").map((m) => m.lineUserId) },
        { label: "B", memberIds: inZone("B").map((m) => m.lineUserId) },
      ].filter((t) => t.memberIds.length > 0);
      const waiting = inZone("waiting").map((m) => m.lineUserId);
      const res = await fetch("/api/mahjong/day/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate, round, tables, waiting }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "確定に失敗しました"); return; }
      setDone(true);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const onZoneClick = useCallback((zone: Zone) => {
    if (locked || !selectedId) return;
    if ((place[selectedId] ?? "pool") === zone) return;
    move(selectedId, zone);
  }, [locked, selectedId, place, move]);

  const renderChip = useCallback((m: PoolMember) => (
    <Chip
      key={m.lineUserId}
      m={m}
      selected={selectedId === m.lineUserId}
      dragging={drag?.id === m.lineUserId}
      locked={locked}
      onPointerDown={onPointerDown}
    />
  ), [selectedId, drag?.id, locked, onPointerDown]);

  /** 枠を光らせるか（選択中の移動先 or 指の真下。いま居る枠は光らせない）。 */
  const isLit = (zone: Zone) => {
    if (drag) return drag.zone === zone && drag.from !== zone;
    return selectedId != null && !locked && (place[selectedId] ?? "pool") !== zone;
  };
  const isArmed = (zone: Zone) => !locked && !drag && selectedId != null && (place[selectedId] ?? "pool") !== zone;

  const dragMember = drag ? pool.find((m) => m.lineUserId === drag.id) : undefined;

  return (
    <div className="rounded-2xl border-2 p-4 flex flex-col gap-3" style={{ borderColor: ACCENT, background: "color-mix(in srgb, " + ACCENT + " 5%, #fff)" }}>
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-black" style={{ color: ACCENT }}>卓振り分け（GM）・第{round}半荘</div>
        {locked && <span className="text-[10px] font-bold text-[#c0563c]">申告開始済み・変更不可</span>}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <>
          {error && <div className="text-[11px] font-bold text-[#d8533a] bg-[#fdece8] rounded-lg px-3 py-2">{error}</div>}
          {done && !error && <div className="text-[11px] font-bold text-[#2f7d57] bg-[#eef6f0] rounded-lg px-3 py-2">卓を確定しました。</div>}

          {!locked && (
            <p className="text-[10.5px] text-[#231714]/50">
              {selectedId
                ? "置きたい枠をタップしてください。"
                : "参加者を指でつまんで、A卓 / B卓 / 待機 へ運びます（タップで選んでから枠をタップしても移動できます）。"}
            </p>
          )}

          <DropZone
            zone="pool"
            label={`未配置`}
            members={inZone("pool")}
            lit={isLit("pool")}
            over={false}
            armed={isArmed("pool")}
            emptyText="全員配置済み"
            litText="ここで指を離す"
            onZoneClick={onZoneClick}
            renderChip={renderChip}
          />

          <div className="grid grid-cols-1 gap-2.5">
            {ZONE_META.map((z) => {
              const members = inZone(z.zone);
              return (
                <DropZone
                  key={z.zone}
                  zone={z.zone}
                  label={z.label}
                  cap={z.cap}
                  members={members}
                  lit={isLit(z.zone)}
                  over={z.cap != null && members.length > z.cap}
                  armed={isArmed(z.zone)}
                  emptyText="空き"
                  litText="ここで指を離す"
                  onZoneClick={onZoneClick}
                  renderChip={renderChip}
                />
              );
            })}
          </div>

          {!locked && (
            <button
              onClick={confirm}
              disabled={!valid || busy}
              className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40"
              style={{ background: ACCENT }}
            >
              {busy ? "確定中…" : "この半荘の卓を確定"}
            </button>
          )}
          {!valid && !locked && unplaced > 0 && (
            <p className="text-[10.5px] text-[#231714]/50 text-center">全員をA卓/B卓/待機に配置すると確定できます。</p>
          )}

          {/* 指に追従するゴースト。位置は rAF で transform を直接書く（React を経由しない）。 */}
          {drag && dragMember && (
            <div
              ref={ghostRef}
              className="fixed left-0 top-0 z-50 pointer-events-none inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white"
              style={{
                willChange: "transform",
                transform: `translate3d(${point.current.x}px, ${point.current.y}px, 0) translate(-50%, -50%) scale(1.06)`,
                border: `2px solid ${ACCENT}`,
                color: "#231714",
                boxShadow: "0 8px 20px rgba(35,23,20,.18)",
              }}
            >
              {dragMember.displayName}
            </div>
          )}
        </>
      )}
    </div>
  );
}
