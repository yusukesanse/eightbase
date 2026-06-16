"use client";

import { useEffect, useState, useCallback } from "react";
import { LeaguePyramid } from "@/components/LeaguePyramid";
import type {
  MahjongStanding,
  MahjongTable,
  MahjongScheduleEntry,
} from "@/types";

/**
 * ランキング > 麻雀 のビュー
 * タブ: リーグ（ピラミッド＋順位） / 参加（開催予定表＋参加ボタン） / 申告（フォーム・参加中のみ活性）
 */

type SubTab = "league" | "join" | "report";

function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function formatJpDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  void y;
  const dt = new Date(d + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return `${m}/${day}(${w})`;
}

export function MahjongLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [schedule, setSchedule] = useState<MahjongScheduleEntry[]>([]);
  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [tables, setTables] = useState<MahjongTable[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, schRes, tRes] = await Promise.all([
        fetch("/api/mahjong/standings", { credentials: "include" }),
        fetch("/api/mahjong/schedule", { credentials: "include" }),
        fetch("/api/mahjong/tables?mine=1", { credentials: "include" }),
      ]);
      const sData = await sRes.json();
      const schData = await schRes.json();
      const tData = await tRes.json();
      setStandings(sData.standings ?? []);
      setCurrentUserId(sData.currentUserId);
      const league = (schData.schedule ?? []).filter(
        (x: MahjongScheduleEntry) => x.type === "league"
      );
      setSchedule(league);
      setTables(tData.tables ?? []);

      // 参加表明状況を各開催日ぶん取得
      const entered = new Set<string>();
      await Promise.all(
        league.map(async (s: MahjongScheduleEntry) => {
          try {
            const r = await fetch(`/api/mahjong/entries?eventDate=${s.date}`, {
              credentials: "include",
            });
            const d = await r.json();
            if (d.entered) entered.add(s.date);
          } catch {
            /* noop */
          }
        })
      );
      setEnteredDates(entered);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  const isParticipating = enteredDates.size > 0 || tables.length > 0;

  return (
    <div>
      {/* サブタブ */}
      <div className="flex gap-1 mb-4 bg-[#231714]/5 rounded-xl p-1">
        {(
          [
            { id: "league", label: "リーグ", enabled: true },
            { id: "join", label: "参加", enabled: true },
            { id: "report", label: "申告", enabled: isParticipating },
          ] as { id: SubTab; label: string; enabled: boolean }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => t.enabled && setSubTab(t.id)}
            disabled={!t.enabled}
            className={`flex-1 py-2 rounded-lg text-xs font-medium text-center transition-all ${
              subTab === t.id
                ? "bg-white text-[#231714] shadow-sm"
                : t.enabled
                  ? "text-[#231714]/40"
                  : "text-[#231714]/20"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : subTab === "league" ? (
        <LeaguePyramid standings={standings} currentUserId={currentUserId} />
      ) : subTab === "join" ? (
        <JoinTab
          schedule={schedule}
          enteredDates={enteredDates}
          onChanged={loadCore}
        />
      ) : (
        <ReportTab
          tables={tables}
          currentUserId={currentUserId}
          onChanged={loadCore}
        />
      )}
    </div>
  );
}

/* ───────── 参加タブ ───────── */

function JoinTab({
  schedule,
  enteredDates,
  onChanged,
}: {
  schedule: MahjongScheduleEntry[];
  enteredDates: Set<string>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const today = todayJst();

  async function toggle(date: string, entered: boolean) {
    setBusy(date);
    try {
      await fetch(`/api/mahjong/entries${entered ? `?eventDate=${date}` : ""}`, {
        method: entered ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: entered ? undefined : JSON.stringify({ eventDate: date }),
      });
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  if (schedule.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        開催予定がまだ登録されていません
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            <th className="text-left px-4 py-2.5 text-[11px] font-medium text-[#231714]/50">開催日</th>
            <th className="text-left px-2 py-2.5 text-[11px] font-medium text-[#231714]/50">時間</th>
            <th className="px-3 py-2.5 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {schedule.map((s) => {
            const entered = enteredDates.has(s.date);
            const past = s.date < today;
            return (
              <tr key={s.scheduleId} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-3 text-[#231714] font-medium">{formatJpDate(s.date)}</td>
                <td className="px-2 py-3 text-[11px] text-[#231714]/50">
                  {s.startTime}〜{s.endTime}
                </td>
                <td className="px-3 py-3 text-right">
                  {past ? (
                    <span className="text-[11px] text-[#231714]/30">終了</span>
                  ) : (
                    <button
                      onClick={() => toggle(s.date, entered)}
                      disabled={busy === s.date}
                      className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50 ${
                        entered
                          ? "bg-gray-100 text-[#231714]/60"
                          : "bg-[#B0E401] text-[#231714]"
                      }`}
                    >
                      {busy === s.date ? "..." : entered ? "参加中" : "参加する"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ───────── 申告タブ ───────── */

function ReportTab({
  tables,
  currentUserId,
  onChanged,
}: {
  tables: MahjongTable[];
  currentUserId?: string;
  onChanged: () => void;
}) {
  const [reportTable, setReportTable] = useState<MahjongTable | null>(null);

  if (tables.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        まだ卓が組まれていません。<br />
        卓が組まれるとここで申告できます。
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {tables
        .slice()
        .sort((a, b) => (b.eventDate.localeCompare(a.eventDate)) || (a.round ?? 0) - (b.round ?? 0))
        .map((t) => {
          const me = t.members.find((m) => m.lineUserId === currentUserId);
          const needReport = me && me.points === null && t.status !== "completed";
          return (
            <div key={t.tableId} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-sm font-bold text-[#231714]">
                  {formatJpDate(t.eventDate)}
                  {t.round ? ` ・ 第${t.round}回戦` : ""}
                  {t.tableLabel ? ` ・ ${t.tableLabel}卓` : ""}
                </span>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    t.status === "completed"
                      ? "bg-[#B0E401]/20 text-[#231714]"
                      : "bg-orange-50 text-orange-600"
                  }`}
                >
                  {t.status === "completed" ? "確定" : "申告待ち"}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {t.members.map((m) => (
                  <div
                    key={m.lineUserId}
                    className={`rounded-xl p-2.5 ${
                      m.lineUserId === currentUserId ? "bg-[#A5C1C8]/10" : "bg-gray-50"
                    }`}
                  >
                    <div className="text-[11px] font-medium text-[#231714] truncate">
                      {m.displayName}
                      {m.lineUserId === currentUserId && (
                        <span className="ml-1 text-[#A5C1C8]">（自分）</span>
                      )}
                    </div>
                    {m.points !== null ? (
                      <div className="text-[11px] text-[#231714]/60 mt-0.5">
                        {m.rank}位 / {m.points.toLocaleString()}点
                      </div>
                    ) : (
                      <div className="text-[11px] text-orange-500 mt-0.5">未申告</div>
                    )}
                  </div>
                ))}
              </div>
              {me && t.status !== "completed" && (
                <button
                  onClick={() => setReportTable(t)}
                  className={`mt-3 w-full py-2.5 rounded-2xl text-sm font-bold active:scale-[0.98] transition-all ${
                    needReport ? "bg-[#231714] text-white" : "bg-gray-100 text-[#231714]/60"
                  }`}
                >
                  {needReport ? "スコアを申告する" : "申告をやり直す"}
                </button>
              )}
            </div>
          );
        })}

      {reportTable && (
        <ReportModal
          table={reportTable}
          onClose={() => setReportTable(null)}
          onDone={() => {
            setReportTable(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ReportModal({
  table,
  onClose,
  onDone,
}: {
  table: MahjongTable;
  onClose: () => void;
  onDone: () => void;
}) {
  const [points, setPoints] = useState("");
  const [rank, setRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    const p = Number(points);
    if (points === "" || !Number.isInteger(p) || p % 100 !== 0) {
      setError("点数は100点単位の整数で入力してください");
      return;
    }
    if (rank === null) {
      setError("順位を選択してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/mahjong/tables/${table.tableId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ points: p, rank }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "申告に失敗しました");
      else onDone();
    } catch {
      setError("申告に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 safe-area-pb"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#231714]">スコアを申告</h3>
        <p className="text-[11px] text-[#231714]/50 mt-1 mb-4">
          同卓4人の合計が100,000点になると自動で確定します。
        </p>

        <label className="block text-xs font-medium text-[#231714]/60 mb-1">最終持ち点</label>
        <input
          type="number"
          inputMode="numeric"
          step={100}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="例: 32000"
          className="w-full px-4 py-3 text-base border border-gray-200 rounded-xl text-right focus:outline-none focus:border-[#A5C1C8]"
        />

        <label className="block text-xs font-medium text-[#231714]/60 mt-4 mb-1">卓内順位</label>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setRank(n)}
              className={`py-3 rounded-xl text-sm font-bold border transition-colors ${
                rank === n
                  ? "bg-[#231714] text-white border-[#231714]"
                  : "bg-white text-[#231714]/60 border-gray-200"
              }`}
            >
              {n}位
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-medium text-[#231714]/60 border border-gray-200 rounded-2xl"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 py-3 text-sm font-bold text-[#231714] bg-[#B0E401] rounded-2xl active:scale-[0.98] disabled:opacity-50"
          >
            {busy ? "送信中..." : "申告する"}
          </button>
        </div>
      </div>
    </div>
  );
}
