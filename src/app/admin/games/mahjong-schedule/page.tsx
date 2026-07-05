"use client";

import { useEffect, useState } from "react";
import MonthCalendar from "@/components/ui/MonthCalendar";

/**
 * 麻雀 開催日（休催日設定）。毎週土曜が既定の開催日。
 * 休みにする土曜をクリックで「休催」にトグルする（利用者カレンダーで選択不可になる）。
 */
export default function MahjongScheduleAdminPage() {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const isSat = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6;

  const load = () =>
    fetch("/api/admin/mahjong/closed-dates", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setClosed(new Set<string>(d.dates ?? [])))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function toggle(date: string) {
    if (!isSat(date) || busy) return;
    setBusy(true);
    const isClosed = closed.has(date);
    await fetch(`/api/admin/mahjong/closed-dates${isClosed ? `?date=${date}` : ""}`, {
      method: isClosed ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: isClosed ? undefined : JSON.stringify({ date }),
    }).catch(() => {});
    await load();
    setBusy(false);
  }

  return (
    <div className="p-5 max-w-md">
      <h1 className="text-lg font-bold text-[#231714] mb-1">麻雀 開催日（休催日設定）</h1>
      <p className="text-sm text-[#231714]/60 mb-4">
        毎週土曜が開催日です。イベント等で休みにする土曜を<b>クリック</b>して「休催」に切り替えます
        （利用者は選択できなくなります）。もう一度クリックで開催に戻ります。
      </p>
      <div className="bg-white rounded-xl border border-[#231714]/10 p-4">
        <MonthCalendar
          value={null}
          onSelect={toggle}
          isSelectable={(d) => isSat(d) && d >= today}
          marked={(d) => closed.has(d)}
          accent="#c0563c"
        />
      </div>
      <div className="mt-3 text-xs text-[#231714]/50 flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#c0563c" }} />
        赤印＝休催（この土曜は開催しない）
      </div>
    </div>
  );
}
