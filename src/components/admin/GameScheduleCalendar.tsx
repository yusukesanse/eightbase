"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import MonthCalendar from "@/components/ui/MonthCalendar";
import DatePicker from "@/components/ui/DatePicker";

/**
 * 全ゲーム共通の日程カレンダー（管理）。開催日をカレンダーのクリックで追加/削除する。
 * さらに「繰り返し設定」（Google カレンダーのような、曜日×間隔×期間）で一括投入できる:
 *  - 毎週〇曜（〇は管理者が選択）/ 2週に1回 / 3週に1回 …
 *  - 期間はシーズン開始日〜指定の終了日（シーズン終了日まで）。
 * 開催日は {game}Schedule の doc（/api/admin/games/schedule）。任意日を追加できる＝土→日への移動も可。
 */

type Game = "mahjong" | "darts" | "billiards";
const GAME_NAME: Record<Game, string> = { mahjong: "麻雀", darts: "ダーツ", billiards: "ビリヤード" };
const DEFAULT_WEEKDAY: Record<Game, number> = { mahjong: 6, darts: 4, billiards: 6 }; // 土/木/土
const ACCENT = "#2f7d57";
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const wd = (d: string) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];
const INTERVALS = [
  { v: 1, label: "毎週" },
  { v: 2, label: "2週に1回（隔週）" },
  { v: 3, label: "3週に1回" },
  { v: 4, label: "4週に1回" },
];

export default function GameScheduleCalendar({ gameCategory }: { gameCategory: Game }) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 繰り返し設定。
  const [weekday, setWeekday] = useState<number>(DEFAULT_WEEKDAY[gameCategory]);
  const [intervalWeeks, setIntervalWeeks] = useState<number>(gameCategory === "darts" ? 2 : 1);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/games/schedule?gameCategory=${gameCategory}&seasonId=${seasonId}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setDates(new Set<string>(d.dates ?? [])))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [gameCategory, seasonId]);
  useEffect(() => { load(); }, [load]);

  // シーズン期間を取得して期間の初期値に。
  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        const s = (d.seasons ?? []).find((x: Season) => x.seasonId === seasonId);
        if (s?.startDate) setRangeStart((v) => v || s.startDate);
        if (s?.endDate) setRangeEnd((v) => v || s.endDate);
      })
      .catch(() => {});
  }, [seasonId]);

  const toggle = useCallback(
    async (date: string) => {
      if (busy) return;
      const has = dates.has(date);
      setBusy(true); setMsg(null);
      try {
        const res = has
          ? await fetch(`/api/admin/games/schedule?gameCategory=${gameCategory}&seasonId=${seasonId}&date=${date}`, { method: "DELETE", credentials: "same-origin" })
          : await fetch("/api/admin/games/schedule", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ gameCategory, seasonId, date }),
            });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setMsg({ ok: false, text: data.error ?? "更新に失敗しました" }); return; }
        setDates((prev) => {
          const next = new Set(prev);
          if (has) next.delete(date); else next.add(date);
          return next;
        });
        setMsg({ ok: true, text: has ? `${date} を開催日から外しました` : `${date} を開催日に追加しました` });
      } finally {
        setBusy(false);
      }
    },
    [busy, dates, gameCategory, seasonId]
  );

  async function generate() {
    if (!rangeStart || !rangeEnd) { setMsg({ ok: false, text: "期間（開始日・終了日）を設定してください" }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/games/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ gameCategory, seasonId, bulk: true, weekday, intervalWeeks, startDate: rangeStart, endDate: rangeEnd }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? "一括投入に失敗しました" }); return; }
      const iv = INTERVALS.find((i) => i.v === intervalWeeks)?.label ?? `${intervalWeeks}週に1回`;
      setMsg({ ok: true, text: `${iv} ${WD[weekday]}曜を${data.added ?? 0}件投入しました` });
      load();
    } finally {
      setBusy(false);
    }
  }

  const sorted = Array.from(dates).sort();

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl">
      <div>
        <h1 className="text-lg font-bold text-[#231714]">{GAME_NAME[gameCategory]} 日程</h1>
        <p className="text-sm text-[#231714]/80 mt-1 leading-relaxed">
          カレンダーの日付をタップして開催日を<b>追加/削除</b>できます（仮の日程なので任意に変更可。土曜を外して日曜に、なども可能）。
          ここに登録された日だけが利用者アプリで参加可能になります。
        </p>
      </div>

      {msg && (
        <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${msg.ok ? "bg-[#eef6f0] text-[#2f7d57]" : "bg-[#fdece8] text-[#d8533a]"}`}>
          {msg.text}
        </div>
      )}

      {/* 繰り返し設定（Google カレンダー風） */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="text-sm font-bold text-[#231714]">繰り返しで一括登録</div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">曜日</label>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className="rounded-lg border border-gray-200 px-2 py-2 text-sm bg-white">
              {WD.map((w, i) => <option key={i} value={i}>{w}曜</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">間隔</label>
            <select value={intervalWeeks} onChange={(e) => setIntervalWeeks(Number(e.target.value))} className="rounded-lg border border-gray-200 px-2 py-2 text-sm bg-white">
              {INTERVALS.map((i) => <option key={i.v} value={i.v}>{i.label}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">開始日（シーズン開始日）</label>
            <DatePicker value={rangeStart} onChange={setRangeStart} placeholder="開始日" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">終了日（シーズン終了日まで）</label>
            <DatePicker value={rangeEnd} onChange={setRangeEnd} placeholder="終了日" />
          </div>
          <button onClick={generate} disabled={busy} className="rounded-xl text-white text-sm font-bold px-4 py-2 disabled:opacity-40" style={{ background: ACCENT }}>
            一括登録
          </button>
        </div>
        <p className="text-[11px] text-[#231714]/70">期間はシーズン終了日でクランプされます。個別の追加/削除はカレンダーから。</p>
      </div>

      {/* カレンダー（クリックでトグル） */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
        {loading ? (
          <div className="py-10 flex justify-center"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
        ) : (
          <MonthCalendar
            value={null}
            onSelect={toggle}
            isSelectable={(dateStr) => dateStr >= today}
            marked={(dateStr) => dates.has(dateStr)}
          />
        )}
        <p className="text-[11px] text-[#231714]/70 mt-2 px-1">● が開催日。過去日は変更できません。</p>
      </div>

      {/* 登録済み一覧 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-bold text-[#231714] mb-2">登録済みの開催日（{sorted.length}件）</div>
        {sorted.length === 0 ? (
          <div className="py-6 text-center text-sm text-[#231714]/70">まだ開催日がありません。</div>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {sorted.map((d) => (
              <li key={d} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-bold text-[#231714]">{d}（{wd(d)}）</span>
                <button onClick={() => toggle(d)} disabled={busy} className="text-xs font-bold text-[#d8533a] hover:underline disabled:opacity-40">
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
