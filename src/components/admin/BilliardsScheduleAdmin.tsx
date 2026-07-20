"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import DatePicker from "@/components/ui/DatePicker";
import { BILLIARDS_DEFAULT_START_TIME, BILLIARDS_DEFAULT_END_TIME, type BilliardsScheduleEntry } from "@/types/billiards";

/**
 * ビリヤード 開催日（日程）管理。既定は第2/第4土曜 13:00〜18:00。
 * 開催日を明示登録する（`/api/admin/billiards/schedule`）。POST はアクティブなビリヤードシーズンに登録する。
 */
export default function BilliardsScheduleAdmin() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [schedule, setSchedule] = useState<BilliardsScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const [singleDate, setSingleDate] = useState("");
  const [bulkStart, setBulkStart] = useState("");
  const [bulkCount, setBulkCount] = useState(12);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/billiards/schedule?seasonId=${seasonId}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setSchedule(d.schedule ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);

  async function addSingle() {
    if (!singleDate) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/billiards/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ date: singleDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: data.error ?? "登録に失敗しました" });
      else {
        setMsg({ ok: true, text: data.warning ? `登録しました（${data.warning}）` : "開催日を登録しました" });
        setSingleDate("");
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function addBulk() {
    if (!bulkStart) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/billiards/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ biweekly: { startDate: bulkStart, count: bulkCount } }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: data.error ?? "一括登録に失敗しました" });
      else {
        setMsg({ ok: true, text: `第2/第4土曜を${data.added}件登録しました` });
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(date: string) {
    if (!confirm(`${date} の開催日を削除しますか？`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/billiards/schedule?seasonId=${seasonId}&date=${date}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: data.error ?? "削除に失敗しました" });
      else { setMsg({ ok: true, text: "開催日を削除しました" }); load(); }
    } finally {
      setBusy(false);
    }
  }

  const wd = (d: string) => ["日", "月", "火", "水", "木", "金", "土"][new Date(`${d}T12:00:00Z`).getUTCDay()];

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[#231714]/80 leading-relaxed">
        ビリヤードの開催日を登録します（既定は第2/第4土曜 {BILLIARDS_DEFAULT_START_TIME}〜{BILLIARDS_DEFAULT_END_TIME}）。
        ここに登録された日だけが利用者アプリで参加可能になります。祝日等はスキップして個別登録してください。
      </p>

      {msg && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${msg.ok ? "bg-[#eef6f0] text-[#2f7d57]" : "bg-[#fdece8] text-[#d8533a]"}`}>
          {msg.text}
        </div>
      )}

      {/* 第2/第4土曜 一括登録 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="text-sm font-bold text-[#231714]">第2/第4土曜を一括登録</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">起点日（以降の第2/第4土曜から）</label>
            <DatePicker value={bulkStart} onChange={setBulkStart} placeholder="起点日を選択" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">件数</label>
            <input
              type="number" min={1} max={60} value={bulkCount}
              onChange={(e) => setBulkCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
              className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </div>
          <button onClick={addBulk} disabled={busy || !bulkStart} className="rounded-xl bg-[#2f7d57] text-white text-sm font-bold px-4 py-2 disabled:opacity-40">
            一括登録
          </button>
        </div>
      </div>

      {/* 単一追加 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="text-sm font-bold text-[#231714]">開催日を1件追加</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">開催日</label>
            <DatePicker value={singleDate} onChange={setSingleDate} placeholder="開催日を選択" />
          </div>
          <button onClick={addSingle} disabled={busy || !singleDate} className="rounded-xl bg-[#2f7d57] text-white text-sm font-bold px-4 py-2 disabled:opacity-40">
            追加
          </button>
        </div>
      </div>

      {/* 一覧 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-bold text-[#231714] mb-2">登録済みの開催日（{schedule.length}件）</div>
        {loading ? (
          <div className="py-6 flex justify-center"><div className="w-5 h-5 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
        ) : schedule.length === 0 ? (
          <div className="py-6 text-center text-sm text-[#231714]/70">まだ開催日がありません。</div>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {schedule.map((s) => (
              <li key={s.scheduleId} className="flex items-center justify-between py-2.5">
                <div>
                  <span className="text-sm font-bold text-[#231714]">
                    {s.date}（{wd(s.date)}）
                    {wd(s.date) !== "土" && <span className="ml-1 text-[11px] font-bold text-[#b48f13]">土曜以外</span>}
                  </span>
                  <span className="ml-2 text-xs text-[#231714]/70">{s.startTime}〜{s.endTime}</span>
                </div>
                <button onClick={() => remove(s.date)} disabled={busy} className="text-xs font-bold text-[#d8533a] hover:underline disabled:opacity-40">
                  削除
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
