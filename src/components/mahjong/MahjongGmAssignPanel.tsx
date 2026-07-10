"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

/** 座標直下の枠を返す（指の位置で判定する。ゴーストは pointer-events:none なので拾わない）。 */
function zoneAtPoint(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y);
  const holder = el?.closest("[data-zone]");
  const z = holder?.getAttribute("data-zone");
  return z === "pool" || z === "A" || z === "B" || z === "waiting" ? z : null;
}

export function MahjongGmAssignPanel({ eventDate, onChanged }: { eventDate: string; onChanged: () => void }) {
  const [round, setRound] = useState(1);
  const [locked, setLocked] = useState(false);
  const [pool, setPool] = useState<PoolMember[]>([]);
  const [place, setPlace] = useState<Record<string, Zone>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // つまんで運んでいる最中の参加者と、指の位置・その真下の枠。
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; zone: Zone | null } | null>(null);
  // タップ操作: 選択中の参加者。枠をタップするとそこへ移動する。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 押し始めの座標と、しきい値を超えたか（超えるまではタップ候補のまま）。
  const press = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);

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

  const move = (id: string, zone: Zone) => {
    if (locked) return;
    setDone(false);
    setSelectedId(null);
    setPlace((p) => ({ ...p, [id]: zone }));
  };

  /* ───────── つまんで運ぶ（Pointer Events。タッチ/マウス共通） ───────── */

  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (locked) return;
    // 以降の pointermove/up を、指が要素外へ出てもこの要素で受け続ける。
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { id, x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.moved = true;
    setSelectedId(null); // ドラッグに切り替わったらタップ選択は解除
    setDrag({ id: p.id, x: e.clientX, y: e.clientY, zone: zoneAtPoint(e.clientX, e.clientY) });
  };

  const endPointer = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.moved) {
      const zone = zoneAtPoint(e.clientX, e.clientY);
      if (zone) move(p.id, zone); // 枠の外で離したら元の位置のまま（何もしない）
      setDrag(null);
    } else {
      // 動かさずに離した＝タップ。選択のトグル。
      setSelectedId((cur) => (cur === p.id ? null : p.id));
    }
  };

  const cancelPointer = () => {
    press.current = null;
    setDrag(null);
  };

  const dragging = drag?.id ?? null;
  const dragMember = dragging ? pool.find((m) => m.lineUserId === dragging) : undefined;

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

  /**
   * 参加者カード。指でつまむ対象なので、タッチ目標として十分な高さ（48px）を確保する。
   * `touch-action: none` を付けないと、指を動かした瞬間にページのスクロールへ持っていかれる。
   */
  const Chip = ({ m }: { m: PoolMember }) => {
    const selected = selectedId === m.lineUserId;
    const isDragging = dragging === m.lineUserId;
    return (
      <button
        type="button"
        disabled={locked}
        aria-pressed={selected}
        // 枠の onClick へ伝播すると、その枠へ即移動してしまうため止める。
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, m.lineUserId); }}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => { e.stopPropagation(); endPointer(e); }}
        onPointerCancel={cancelPointer}
        className={`inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white border select-none ${isDragging ? "opacity-30" : ""} ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
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
  };

  const DropZone = ({ zone, label, cap }: { zone: Zone; label: string; cap?: number }) => {
    const members = inZone(zone);
    const over = cap != null && members.length > cap;
    // 選択中の参加者が「この枠以外」に居るときだけ、置き先として光らせる。
    const armed = !locked && selectedId != null && (place[selectedId] ?? "pool") !== zone;
    // 運んでいる指がこの枠の上にある（元いた枠は光らせない）。
    const hovered = drag != null && drag.zone === zone && (place[drag.id] ?? "pool") !== zone;
    const lit = armed || hovered;
    return (
      <div
        data-zone={zone}
        onClick={() => { if (armed && selectedId) move(selectedId, zone); }}
        className={`rounded-2xl border border-dashed p-2.5 min-h-[72px] transition-colors ${armed ? "cursor-pointer" : ""}`}
        style={{
          borderColor: over ? "#d8533a" : lit ? ACCENT : "#c9d6cf",
          background: lit ? `color-mix(in srgb, ${ACCENT} 10%, #fff)` : "#f7faf8",
        }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-extrabold" style={{ color: over ? "#d8533a" : "#5f7a80" }}>
            {label}{cap != null ? `（${members.length}/${cap}）` : `（${members.length}）`}
          </span>
          {lit && <span className="text-[10px] font-bold" style={{ color: ACCENT }}>ここに置く</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {members.length === 0 ? (
            <span className="text-[11px] text-[#231714]/30">{lit ? "ここで指を離す" : "空き"}</span>
          ) : (
            members.map((m) => <Chip key={m.lineUserId} m={m} />)
          )}
        </div>
      </div>
    );
  };

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

          {/* 未配置プール */}
          {(() => {
            const armed = !locked && selectedId != null && (place[selectedId] ?? "pool") !== "pool";
            const hovered = drag != null && drag.zone === "pool" && (place[drag.id] ?? "pool") !== "pool";
            const lit = armed || hovered;
            return (
              <div
                data-zone="pool"
                onClick={() => { if (armed && selectedId) move(selectedId, "pool"); }}
                className={`rounded-2xl border border-dashed p-2.5 min-h-[56px] transition-colors ${armed ? "cursor-pointer" : ""}`}
                style={{
                  borderColor: lit ? ACCENT : unplaced > 0 ? "#b48f13" : "#e4e7e9",
                  background: lit ? `color-mix(in srgb, ${ACCENT} 10%, #fff)` : "#fff",
                }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[11px] font-extrabold text-[#97999d]">未配置（{unplaced}）</span>
                  {lit && <span className="text-[10px] font-bold" style={{ color: ACCENT }}>ここに戻す</span>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {inZone("pool").length === 0 ? (
                    <span className="text-[11px] text-[#231714]/30">{lit ? "ここで指を離す" : "全員配置済み"}</span>
                  ) : (
                    inZone("pool").map((m) => <Chip key={m.lineUserId} m={m} />)
                  )}
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-1 gap-2.5">
            {ZONE_META.map((z) => (
              <DropZone key={z.zone} zone={z.zone} label={z.label} cap={z.cap} />
            ))}
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

          {/* 指に追従するゴースト。pointer-events:none にしないと自分自身を拾って枠判定が壊れる。 */}
          {drag && dragMember && (
            <div
              className="fixed z-50 pointer-events-none inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white"
              style={{
                left: drag.x,
                top: drag.y,
                transform: "translate(-50%, -50%) scale(1.06)",
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
