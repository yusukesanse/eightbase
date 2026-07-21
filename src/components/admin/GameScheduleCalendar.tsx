"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import MonthCalendar from "@/components/ui/MonthCalendar";
import DatePicker from "@/components/ui/DatePicker";

/**
 * 全ゲーム共通の日程カレンダー（管理）。開催日をカレンダーのクリックで選択し、右パネルで追加/削除/休催を行う。
 * さらに「繰り返し設定」（Google カレンダーのような、曜日×間隔×期間）で一括投入できる。
 *
 * 日付をタップすると右側にその日の参加者と操作が出る:
 *  - 開催日: 参加者一覧 ＋ 赤「この日を休催日にする」（＝流会。支払い済みは返金対象へ）＋「開催日から外す」
 *  - 未登録日: 「この日を開催日にする」
 * 休催（中止）は {game}CancelledDates に記録され、以後の参加を止める（返金は Square で管理者が手動）。
 */

type Game = "mahjong" | "darts" | "billiards";
const GAME_NAME: Record<Game, string> = { mahjong: "麻雀", darts: "ダーツ", billiards: "ビリヤード" };
const DEFAULT_WEEKDAY: Record<Game, number> = { mahjong: 6, darts: 4, billiards: 6 }; // 土/木/土
const ACCENT = "#2f7d57";
const RED = "#d8533a";
const WD = ["日", "月", "火", "水", "木", "金", "土"];
const wd = (d: string) => WD[new Date(`${d}T12:00:00Z`).getUTCDay()];
const INTERVALS = [
  { v: 1, label: "毎週" },
  { v: 2, label: "2週に1回（隔週）" },
  { v: 3, label: "3週に1回" },
  { v: 4, label: "4週に1回" },
];

type Participant = { displayName: string; pictureUrl: string; status: string; paid: boolean; refundable: boolean };
type DayInfo = { closed: boolean; participants: Participant[]; counts: { total: number; paid: number; refundable: number } };
const STATUS_LABEL: Record<string, { text: string; color: string; bg: string }> = {
  paid: { text: "支払い済み", color: "#2f7d57", bg: "#eef6f0" },
  reserved: { text: "未払い", color: "#5f6266", bg: "#f1f2f3" },
  cancelRequested: { text: "返金対応中", color: "#a1502c", bg: "#fbeee6" },
  refunded: { text: "返金済み", color: "#5f6266", bg: "#f1f2f3" },
};

export default function GameScheduleCalendar({ gameCategory }: { gameCategory: Game }) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [dates, setDates] = useState<Set<string>>(new Set());
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 繰り返し設定。
  const [weekday, setWeekday] = useState<number>(DEFAULT_WEEKDAY[gameCategory]);
  const [intervalWeeks, setIntervalWeeks] = useState<number>(gameCategory === "darts" ? 2 : 1);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  // 選択日と右パネル。
  const [selected, setSelected] = useState<string | null>(null);
  const [dayInfo, setDayInfo] = useState<DayInfo | null>(null);
  const [dayLoading, setDayLoading] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/admin/games/schedule?gameCategory=${gameCategory}&seasonId=${seasonId}`, { credentials: "same-origin" }).then((r) => r.json()),
      fetch(`/api/admin/games/day?gameCategory=${gameCategory}&seasonId=${seasonId}&list=1`, { credentials: "same-origin" }).then((r) => r.json()),
    ])
      .then(([sched, closed]) => {
        setDates(new Set<string>(sched.dates ?? []));
        setClosedDates(new Set<string>(closed.closedDates ?? []));
      })
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

  // 選択日が開催日ならその日の参加者・休催状態を取得。
  const fetchDay = useCallback((date: string) => {
    setDayLoading(true);
    fetch(`/api/admin/games/day?gameCategory=${gameCategory}&seasonId=${seasonId}&eventDate=${date}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setDayInfo(d && Array.isArray(d.participants) ? d : null))
      .catch(() => setDayInfo(null))
      .finally(() => setDayLoading(false));
  }, [gameCategory, seasonId]);

  function select(date: string) {
    setSelected(date);
    setConfirmClose(false);
    setMsg(null);
    if (dates.has(date)) fetchDay(date);
    else setDayInfo(null);
  }

  async function addDate(date: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/games/schedule", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ gameCategory, seasonId, date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? "追加に失敗しました" }); return; }
      setDates((prev) => new Set(prev).add(date));
      setClosedDates((prev) => { const n = new Set(prev); n.delete(date); return n; });
      setMsg({ ok: true, text: `${date} を開催日に追加しました` });
      fetchDay(date);
    } finally { setBusy(false); }
  }

  async function removeDate(date: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/games/schedule?gameCategory=${gameCategory}&seasonId=${seasonId}&date=${date}`, { method: "DELETE", credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? "削除に失敗しました" }); return; }
      setDates((prev) => { const n = new Set(prev); n.delete(date); return n; });
      setDayInfo(null);
      setMsg({ ok: true, text: `${date} を開催日から外しました` });
    } finally { setBusy(false); }
  }

  async function closeDay(date: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/games/day", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
        body: JSON.stringify({ gameCategory, seasonId, eventDate: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? "休催の設定に失敗しました" }); return; }
      setClosedDates((prev) => new Set(prev).add(date));
      setConfirmClose(false);
      setMsg({
        ok: true,
        text: data.already ? `${date} は既に休催です` : `${date} を休催にしました（返金対象 ${data.refundCount ?? 0}名は返金対応へ）`,
      });
      fetchDay(date);
    } finally { setBusy(false); }
  }

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
    } finally { setBusy(false); }
  }

  async function clearAll() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/admin/games/schedule?gameCategory=${gameCategory}&seasonId=${seasonId}&all=1`, { method: "DELETE", credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: data.error ?? "一括削除に失敗しました" }); return; }
      const skipped: string[] = data.skipped ?? [];
      setMsg({ ok: true, text: `${data.deleted ?? 0}件を削除しました${skipped.length ? `（参加者ありの${skipped.length}件は残しました）` : ""}` });
      setConfirmClear(false);
      setSelected(null); setDayInfo(null);
      load();
    } finally { setBusy(false); }
  }

  const sorted = Array.from(dates).sort();
  const selScheduled = selected ? dates.has(selected) : false;
  const selClosed = selected ? closedDates.has(selected) : false;
  const selPast = selected ? selected < today : false;

  return (
    <div className="p-4 flex flex-col gap-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold text-[#231714]">{GAME_NAME[gameCategory]} 日程</h1>
        <p className="text-sm text-[#231714]/80 mt-1 leading-relaxed">
          カレンダーの日付をタップして<b>参加者の確認・開催日の追加/削除・休催</b>ができます（仮の日程なので任意に変更可）。
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

      {/* カレンダー ＋ 右パネル */}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3 w-full lg:flex-1">
          {loading ? (
            <div className="py-10 flex justify-center"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <MonthCalendar
              value={selected}
              onSelect={select}
              isSelectable={(dateStr) => dateStr >= today}
              marked={(dateStr) => dates.has(dateStr)}
            />
          )}
          <p className="text-[11px] text-[#231714]/70 mt-2 px-1">● が開催日。日付をタップで右に詳細。過去日は選べません。</p>
        </div>

        {/* 右パネル: 選択日の詳細 */}
        <div className="w-full lg:w-96 shrink-0 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 min-h-[220px]">
          {!selected ? (
            <div className="h-full flex items-center justify-center py-10 text-center text-sm text-[#231714]/60">
              日付をタップすると、その日の参加者と<br />休催の操作が表示されます。
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="text-base font-black text-[#231714]">{selected}（{wd(selected)}）</div>
                {selClosed ? (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#fdece8", color: RED }}>休催（中止）</span>
                ) : selScheduled ? (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef6f0", color: ACCENT }}>開催日</span>
                ) : (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-[#5f6266]">未登録</span>
                )}
              </div>

              {/* 未登録日: 追加のみ */}
              {!selScheduled && (
                <>
                  <p className="text-sm text-[#231714]/70">この日はまだ開催日ではありません。</p>
                  {!selPast && (
                    <button onClick={() => addDate(selected)} disabled={busy} className="rounded-xl text-white text-sm font-bold px-4 py-2.5 disabled:opacity-40" style={{ background: ACCENT }}>
                      この日を開催日にする
                    </button>
                  )}
                </>
              )}

              {/* 開催日: 参加者 ＋ 休催/削除 */}
              {selScheduled && (
                <>
                  <div>
                    <div className="text-xs font-bold text-[#231714]/70 mb-1.5">
                      参加者{dayInfo ? `（${dayInfo.counts.total}名 / 支払い済み ${dayInfo.counts.paid}名）` : ""}
                    </div>
                    {dayLoading ? (
                      <div className="py-6 flex justify-center"><div className="w-5 h-5 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
                    ) : !dayInfo || dayInfo.participants.length === 0 ? (
                      <div className="py-4 text-center text-sm text-[#231714]/60">参加者はいません。</div>
                    ) : (
                      <ul className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                        {dayInfo.participants.map((p, i) => {
                          const s = STATUS_LABEL[p.status] ?? { text: p.status, color: "#5f6266", bg: "#f1f2f3" };
                          return (
                            <li key={i} className="flex items-center gap-2">
                              {p.pictureUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={p.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover bg-gray-100" />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-gray-200" />
                              )}
                              <span className="text-sm font-bold text-[#231714] flex-1 truncate">{p.displayName}</span>
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: s.bg, color: s.color }}>{s.text}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {selClosed ? (
                    <div className="rounded-xl px-3 py-2.5 text-[12px] font-bold leading-relaxed" style={{ background: "#fdece8", color: "#c0563c" }}>
                      この日は休催（中止）済みです。利用者は参加できません。支払い済みの方は返金対応（Squareで手動返金）へ回っています。
                    </div>
                  ) : confirmClose ? (
                    <div className="rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: "#e9b7ab", background: "#fdece8" }}>
                      <p className="text-[12px] font-bold leading-relaxed" style={{ color: "#c0563c" }}>
                        {selected} を休催（中止）にします。
                        {dayInfo && dayInfo.counts.refundable > 0
                          ? `支払い済み ${dayInfo.counts.refundable}名は返金対象（Square手動返金）になります。`
                          : "この日は開催されなくなり、参加できなくなります。"}
                        取り消せません。
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => setConfirmClose(false)} disabled={busy} className="flex-1 py-2 rounded-lg text-[13px] font-bold bg-white disabled:opacity-40" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}>やめる</button>
                        <button onClick={() => closeDay(selected)} disabled={busy} className="flex-1 py-2 rounded-lg text-[13px] font-black text-white disabled:opacity-40" style={{ background: RED }}>休催にする</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmClose(true)} disabled={busy} className="rounded-xl text-white text-sm font-black px-4 py-2.5 disabled:opacity-40" style={{ background: RED }}>
                      この日を休催日にする
                    </button>
                  )}

                  {!selClosed && (
                    <button onClick={() => removeDate(selected)} disabled={busy} className="text-xs font-bold text-[#5f6266] hover:underline disabled:opacity-40 self-start">
                      開催日から外す（削除）
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 登録済み一覧 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-bold text-[#231714]">登録済みの開催日（{sorted.length}件）</div>
          {sorted.length > 0 && !confirmClear && (
            <button onClick={() => setConfirmClear(true)} disabled={busy} className="text-xs font-bold text-[#d8533a] hover:underline disabled:opacity-40">
              すべて削除
            </button>
          )}
        </div>
        {confirmClear && (
          <div className="mb-3 rounded-xl border p-3 flex flex-col gap-2" style={{ borderColor: "#e9b7ab", background: "#fdece8" }}>
            <p className="text-[12px] font-bold text-[#c0563c] leading-relaxed">
              このシーズンの開催日をすべて削除します（<b>参加者がいる日は残します</b>）。取り消せません。
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmClear(false)} disabled={busy} className="flex-1 py-2 rounded-lg text-[13px] font-bold bg-white disabled:opacity-40" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}>やめる</button>
              <button onClick={clearAll} disabled={busy} className="flex-1 py-2 rounded-lg text-[13px] font-black text-white disabled:opacity-40" style={{ background: "#c0563c" }}>すべて削除する</button>
            </div>
          </div>
        )}
        {sorted.length === 0 ? (
          <div className="py-6 text-center text-sm text-[#231714]/70">まだ開催日がありません。</div>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {sorted.map((d) => (
              <li key={d} className="flex items-center justify-between py-2.5">
                <button onClick={() => select(d)} className="flex items-center gap-2 text-left">
                  <span className="text-sm font-bold text-[#231714]">{d}（{wd(d)}）</span>
                  {closedDates.has(d) && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: "#fdece8", color: RED }}>休催</span>}
                </button>
                <button onClick={() => removeDate(d)} disabled={busy} className="text-xs font-bold text-[#d8533a] hover:underline disabled:opacity-40">
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
