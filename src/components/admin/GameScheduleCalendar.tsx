"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import MonthCalendar from "@/components/ui/MonthCalendar";
import DatePicker from "@/components/ui/DatePicker";

/**
 * 全ゲーム共通の日程カレンダー（管理）。開催日をカレンダーのクリックで追加/削除する。
 * 開催日は {game}Schedule の doc（/api/admin/games/schedule）。任意日を追加できる＝土→日への移動も可。
 * 種目別の既定日（麻雀=毎週土曜 / ダーツ=隔週木曜 / ビリヤード=第2第4土曜）は一括投入できる。
 */

type Game = "mahjong" | "darts" | "billiards";
const GAME_NAME: Record<Game, string> = { mahjong: "麻雀", darts: "ダーツ", billiards: "ビリヤード" };
const DEFAULT_LABEL: Record<Game, string> = {
  mahjong: "シーズン期間の毎週土曜",
  darts: "隔週木曜",
  billiards: "第2・第4土曜",
};
const ACCENT = "#2f7d57";
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const wd = (d: string) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];

export default function GameScheduleCalendar({ gameCategory }: { gameCategory: Game }) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bulkStart, setBulkStart] = useState("");
  const [bulkCount, setBulkCount] = useState(12);
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

  async function bulk() {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = { gameCategory, seasonId, bulk: true };
      if (gameCategory !== "mahjong") {
        if (!bulkStart) { setMsg({ ok: false, text: "起点日を選んでください" }); return; }
        body.startDate = bulkStart; body.count = bulkCount;
      }
      const res = await fetch("/api/admin/games/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? "一括投入に失敗しました" }); return; }
      setMsg({ ok: true, text: `${DEFAULT_LABEL[gameCategory]}を${data.added ?? 0}件投入しました` });
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

      {/* 一括投入（既定日） */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="text-sm font-bold text-[#231714]">{DEFAULT_LABEL[gameCategory]}を一括投入</div>
        <div className="flex flex-wrap items-end gap-3">
          {gameCategory !== "mahjong" && (
            <>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-[#231714]/70">起点日</label>
                <DatePicker value={bulkStart} onChange={setBulkStart} placeholder="起点日を選択" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-[#231714]/70">件数</label>
                <input type="number" min={1} max={60} value={bulkCount}
                  onChange={(e) => setBulkCount(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
                  className="w-20 rounded-lg border border-gray-200 px-3 py-2 text-sm" />
              </div>
            </>
          )}
          <button onClick={bulk} disabled={busy} className="rounded-xl text-white text-sm font-bold px-4 py-2 disabled:opacity-40" style={{ background: ACCENT }}>
            一括投入
          </button>
        </div>
        {gameCategory === "mahjong" && (
          <p className="text-[11px] text-[#231714]/70">シーズンの期間内の毎週土曜を投入します。個別の追加/削除はカレンダーから。</p>
        )}
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
