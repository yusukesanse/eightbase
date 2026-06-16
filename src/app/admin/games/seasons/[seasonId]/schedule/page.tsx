"use client";

import { useEffect, useState, useCallback } from "react";
import type { MahjongScheduleEntry } from "@/types";

function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export default function SeasonSchedulePage() {
  const [schedule, setSchedule] = useState<MahjongScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [date, setDate] = useState(todayJst());
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("18:00");
  const [type, setType] = useState<"league" | "championship">("league");

  const fetchSchedule = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/mahjong/schedule`, { credentials: "same-origin" });
      const data = await res.json();
      setSchedule(data.schedule ?? []);
    } catch {
      setSchedule([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSchedule();
  }, [fetchSchedule]);

  async function addEntry() {
    const res = await fetch(`/api/admin/mahjong/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ date, startTime, endTime, type }),
    });
    if (res.ok) fetchSchedule();
    else alert((await res.json()).error ?? "追加に失敗しました");
  }

  async function loadTemplate() {
    if (!confirm("資料の年間日程（2026/07〜2027/06）を一括登録しますか？\n既存と重複する日付はスキップされます。")) return;
    const res = await fetch(`/api/admin/mahjong/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ template: true }),
    });
    const data = await res.json();
    if (res.ok) {
      alert(`${data.added}件を登録しました`);
      fetchSchedule();
    } else alert(data.error ?? "登録に失敗しました");
  }

  async function deleteEntry(scheduleId: string) {
    if (!confirm("この日程を削除しますか？")) return;
    const res = await fetch(`/api/admin/mahjong/schedule?scheduleId=${scheduleId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) fetchSchedule();
  }

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* 追加フォーム */}
      <section className="bg-white rounded-xl border border-[#231714]/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#231714]">日程を追加</h2>
          <button
            onClick={loadTemplate}
            className="px-3 py-1.5 text-xs font-medium text-[#231714]/70 border border-[#231714]/10 rounded-lg hover:bg-gray-50"
          >
            資料の年間日程を一括登録
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-[#231714]/60 mb-1">日付</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs text-[#231714]/60 mb-1">開始</label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs text-[#231714]/60 mb-1">終了</label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg"
            />
          </div>
          <div>
            <label className="block text-xs text-[#231714]/60 mb-1">種別</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as "league" | "championship")}
              className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg bg-white"
            >
              <option value="league">リーグ戦</option>
              <option value="championship">チャンピオンシップ</option>
            </select>
          </div>
          <button
            onClick={addEntry}
            className="px-4 py-2 text-xs font-bold text-[#231714] bg-[#B0E401] rounded-lg hover:opacity-90"
          >
            追加
          </button>
        </div>
      </section>

      {/* 一覧 */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : schedule.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
          まだ日程が登録されていません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-[#231714]/5">
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">日付</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">時間</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">種別</th>
                <th className="px-4 py-2.5 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((s) => (
                <tr key={s.scheduleId} className="border-b border-[#231714]/5">
                  <td className="px-4 py-3 text-[#231714]">{s.date}</td>
                  <td className="px-4 py-3 text-[#231714]/70">{s.startTime}〜{s.endTime}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.type === "championship"
                          ? "bg-red-50 text-red-600"
                          : "bg-sky-50 text-sky-700"
                      }`}
                    >
                      {s.type === "championship" ? "CS" : "リーグ戦"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteEntry(s.scheduleId)}
                      className="text-xs text-red-500 hover:text-red-600"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
