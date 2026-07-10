"use client";

import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { ACCENT } from "@/components/mahjong/leagueShared";

/**
 * ゲームマスター（GM）専用の手動卓振り分けパネル。
 * ネイティブ HTML5 Drag & Drop で 未配置/A卓/B卓/待機 に参加者を配置し、
 * 「この半荘の卓を確定」で /api/mahjong/day/assign に送る。自己申告 UI とは別セクション。
 */

interface PoolMember { lineUserId: string; displayName: string; pictureUrl?: string }
type Zone = "pool" | "A" | "B" | "waiting";

const ZONE_META: { zone: Zone; label: string; cap?: number }[] = [
  { zone: "A", label: "A卓", cap: 4 },
  { zone: "B", label: "B卓", cap: 4 },
  { zone: "waiting", label: "待機（抜け番）" },
];

export function MahjongGmAssignPanel({ eventDate, onChanged }: { eventDate: string; onChanged: () => void }) {
  const [round, setRound] = useState(1);
  const [locked, setLocked] = useState(false);
  const [pool, setPool] = useState<PoolMember[]>([]);
  const [place, setPlace] = useState<Record<string, Zone>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

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
    setPlace((p) => ({ ...p, [id]: zone }));
  };

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

  const Chip = ({ m }: { m: PoolMember }) => (
    <div
      draggable={!locked}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", m.lineUserId); setDragId(m.lineUserId); }}
      onDragEnd={() => setDragId(null)}
      className={`inline-flex items-center gap-1.5 rounded-full pl-1 pr-2.5 py-1 text-[12px] font-bold bg-white border ${dragId === m.lineUserId ? "opacity-40" : ""} ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      style={{ borderColor: "#e4e7e9", color: "#231714" }}
    >
      <Avatar src={m.pictureUrl} name={m.displayName} size={20} />
      {m.displayName}
    </div>
  );

  const DropZone = ({ zone, label, cap }: { zone: Zone; label: string; cap?: number }) => {
    const members = inZone(zone);
    const over = cap != null && members.length > cap;
    return (
      <div
        onDragOver={(e) => { if (!locked) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, zone); }}
        className="rounded-2xl border border-dashed p-2.5 min-h-[64px]"
        style={{ borderColor: over ? "#d8533a" : "#c9d6cf", background: "#f7faf8" }}
      >
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-extrabold" style={{ color: over ? "#d8533a" : "#5f7a80" }}>
            {label}{cap != null ? `（${members.length}/${cap}）` : `（${members.length}）`}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {members.length === 0 ? (
            <span className="text-[11px] text-[#231714]/30">ここにドラッグ</span>
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

          {/* 未配置プール */}
          <div
            onDragOver={(e) => { if (!locked) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, "pool"); }}
            className="rounded-2xl border border-dashed p-2.5 min-h-[48px]"
            style={{ borderColor: unplaced > 0 ? "#b48f13" : "#e4e7e9", background: "#fff" }}
          >
            <div className="text-[11px] font-extrabold text-[#97999d] mb-1.5">未配置（{unplaced}）</div>
            <div className="flex flex-wrap gap-1.5">
              {inZone("pool").length === 0 ? (
                <span className="text-[11px] text-[#231714]/30">全員配置済み</span>
              ) : (
                inZone("pool").map((m) => <Chip key={m.lineUserId} m={m} />)
              )}
            </div>
          </div>

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
        </>
      )}
    </div>
  );
}
