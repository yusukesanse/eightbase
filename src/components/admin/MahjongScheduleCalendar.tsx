"use client";

import { useCallback, useEffect, useState } from "react";
import MonthCalendar from "@/components/ui/MonthCalendar";
import type { MahjongEntry } from "@/types";

/**
 * 麻雀 日程（開催日）。毎週土曜が開催日。
 * カレンダーは画面幅いっぱいの大サイズ。日付クリックで右（下）に詳細を表示し、
 * その日の休催切替・参加者・決済状況を確認できる。
 */

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const isSat = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6;
const dateParts = (d: string) => {
  const dt = new Date(`${d}T12:00:00Z`);
  return { label: `${dt.getUTCMonth() + 1}月${dt.getUTCDate()}日`, wd: WD[dt.getUTCDay()] };
};

// 決済状況バッジ（管理者向け）。
function payLabel(e: MahjongEntry): { t: string; c: string; bg: string } {
  if (e.paymentStatus === "paid") return { t: "支払済", c: "#2f7d57", bg: "#eef6f0" };
  if (e.paymentStatus === "cancelRequested") return { t: "返金対応中", c: "#a1502c", bg: "#fff4ec" };
  if (e.paymentStatus === "pending") return { t: "決済中", c: "#1172a5", bg: "#eaf3f8" };
  if (e.status === "paid") return { t: "参加確定", c: "#2f7d57", bg: "#eef6f0" }; // staff等（支払い免除）
  return { t: "参加済み（未払い）", c: "#b48f13", bg: "#fdf4e3" }; // 参加確定・未払い（利用者向けに「仮予約」は使わない）
}

export default function MahjongScheduleCalendar() {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [entries, setEntries] = useState<MahjongEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const loadClosed = useCallback(
    () =>
      fetch("/api/admin/mahjong/closed-dates", { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d) => setClosed(new Set<string>(d.dates ?? [])))
        .catch(() => {}),
    []
  );
  useEffect(() => {
    loadClosed();
  }, [loadClosed]);

  // 選択日の参加者＋決済状況を取得
  useEffect(() => {
    if (!selected) {
      setEntries([]);
      return;
    }
    let alive = true;
    setLoadingEntries(true);
    fetch(`/api/admin/mahjong/entries?eventDate=${selected}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => alive && setEntries(d.entries ?? []))
      .catch(() => alive && setEntries([]))
      .finally(() => alive && setLoadingEntries(false));
    return () => {
      alive = false;
    };
  }, [selected]);

  async function toggleClosed() {
    if (!selected || busy) return;
    setBusy(true);
    setWarn(null);
    const isClosed = closed.has(selected);
    const res = await fetch(`/api/admin/mahjong/closed-dates${isClosed ? `?date=${selected}` : ""}`, {
      method: isClosed ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: isClosed ? undefined : JSON.stringify({ date: selected }),
    }).catch(() => null);
    if (res?.ok && !isClosed) {
      const d = await res.json().catch(() => ({}));
      const a = d.affected;
      if (a?.total > 0) setWarn(`参加者${a.total}名（支払済${a.paid}名）がいます。返金対応をご確認ください。`);
    }
    await loadClosed();
    setBusy(false);
  }

  const selClosed = selected ? closed.has(selected) : false;
  const selEditable = !!selected && selected >= today; // 過去日の休催切替は不可（閲覧のみ）
  const paidCount = entries.filter((e) => e.paymentStatus === "paid" || e.status === "paid").length;

  return (
    <div className="p-4 sm:p-6">
      <h1 className="text-lg font-bold text-[#231714] mb-1">麻雀 日程（開催日）</h1>
      <p className="text-sm text-[#231714]/60 mb-4">
        毎週土曜が開催日です。<b>日付をクリック</b>すると詳細（休催の切替・参加者・決済状況）を表示します。
      </p>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* 大きいカレンダー（画面幅いっぱい） */}
        <div className="flex-1 min-w-0 bg-white rounded-2xl border border-[#231714]/10 p-4 sm:p-6">
          <MonthCalendar
            value={selected}
            onSelect={setSelected}
            isSelectable={(d) => isSat(d)}
            marked={(d) => closed.has(d)}
            accent="#c0563c"
            size="lg"
          />
          <div className="mt-4 text-xs text-[#231714]/50 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#c0563c" }} />
            赤印＝休催（この土曜は開催しない）
          </div>
        </div>

        {/* 詳細パネル */}
        <div className="lg:w-[380px] shrink-0">
          {!selected ? (
            <div className="bg-white rounded-2xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
              日付をクリックすると詳細を表示します
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-[#231714]/10 p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-[#231714]">
                  {dateParts(selected).label}（{dateParts(selected).wd}）
                </h2>
                <span
                  className="text-[11px] font-black px-2 py-0.5 rounded-full"
                  style={selClosed ? { color: "#c0563c", background: "#fdece8" } : { color: "#2f7d57", background: "#eef6f0" }}
                >
                  {selClosed ? "休催" : "開催"}
                </span>
              </div>

              {selEditable ? (
                <button
                  onClick={toggleClosed}
                  disabled={busy}
                  className="w-full py-2.5 rounded-xl text-[13px] font-extrabold text-white disabled:opacity-50 mb-2"
                  style={{ background: selClosed ? "#2f7d57" : "#c0563c" }}
                >
                  {busy ? "..." : selClosed ? "開催に戻す" : "この日を休催にする"}
                </button>
              ) : (
                <p className="text-[11px] text-[#231714]/40 mb-2">過去の開催日のため休催切替はできません（閲覧のみ）。</p>
              )}

              {warn && (
                <div className="rounded-lg bg-[#fff4ec] border border-[#f0c9b0] px-3 py-2 text-xs font-bold text-[#a1502c] mb-3">
                  ⚠️ {warn}
                </div>
              )}

              <div className="flex items-center justify-between mt-4 mb-2">
                <h3 className="text-sm font-bold text-[#231714]">参加者（{entries.length}名）</h3>
                {entries.length > 0 && <span className="text-[11px] text-[#231714]/50">支払済 {paidCount}名</span>}
              </div>

              {loadingEntries ? (
                <div className="py-6 text-center text-sm text-[#231714]/40">読み込み中…</div>
              ) : selClosed && entries.length === 0 ? (
                <div className="py-6 text-center text-sm text-[#231714]/40">休催日・参加者なし</div>
              ) : entries.length === 0 ? (
                <div className="py-6 text-center text-sm text-[#231714]/40">まだ参加者はいません</div>
              ) : (
                <div className="flex flex-col divide-y divide-[#231714]/5">
                  {entries.map((e) => {
                    const p = payLabel(e);
                    return (
                      <div key={e.entryId} className="flex items-center justify-between gap-2 py-2">
                        <span className="text-[13px] font-bold text-[#1c1f21] min-w-0 truncate">{e.displayName}</span>
                        <span className="shrink-0 text-[10.5px] font-extrabold px-2 py-0.5 rounded-full" style={{ color: p.c, background: p.bg }}>
                          {p.t}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
