"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { LeaguePyramid } from "@/components/LeaguePyramid";
import {
  MAHJONG_MAX_ENTRIES_PER_DATE,
  type MahjongStanding,
  type PublicMahjongTable,
  type MahjongScheduleEntry,
  type MahjongCsEvent,
} from "@/types";

type Tab = "league" | "entry" | "cs";

const TABS: { id: Tab; label: string }[] = [
  { id: "league", label: "リーグ順位" },
  { id: "entry", label: "参加・申告" },
  { id: "cs", label: "チャンピオンシップ" },
];

export default function MahjongLeaguePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("league");

  function goBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/info");
    }
  }
  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [rankingMetric, setRankingMetric] = useState<"average" | "total">("average");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/mahjong/standings", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setStandings(d.standings ?? []);
        setCurrentUserId(d.currentUserId);
        setRankingMetric(d.rankingMetric === "total" ? "total" : "average");
      })
      .catch(() => setStandings([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white px-5 pt-12 pb-3">
        <div className="flex items-center gap-2">
          <button onClick={goBack} aria-label="戻る" className="text-[#231714]/50 hover:text-[#231714]/80">
            ←
          </button>
          <div>
            <h1 className="text-[17px] font-medium text-[#231714]">麻雀リーグ</h1>
            <p className="text-[11px] text-[#231714]/40 mt-0.5">M.LEAGUE</p>
          </div>
        </div>
        {/* タブ */}
        <nav className="flex mt-3 -mb-px">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`relative flex-1 pb-2.5 text-[13px] font-medium transition-colors ${
                tab === t.id ? "text-[#231714]" : "text-[#231714]/40"
              }`}
            >
              {t.label}
              {tab === t.id && (
                <span className="absolute bottom-0 left-[15%] right-[15%] h-[2px] bg-[#A5C1C8] rounded-full" />
              )}
            </button>
          ))}
        </nav>
      </header>

      <div className="px-4 pt-4">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tab === "league" ? (
          <LeaguePyramid standings={standings} currentUserId={currentUserId} rankingMetric={rankingMetric} />
        ) : tab === "entry" ? (
          <EntryScoreTab />
        ) : (
          <CsTab currentUserId={currentUserId} />
        )}
      </div>
    </div>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
      {text}
    </div>
  );
}

/* ───────── 参加・スコア申告タブ ───────── */

function EntryScoreTab() {
  const [schedule, setSchedule] = useState<MahjongScheduleEntry[]>([]);
  const [eventDate, setEventDate] = useState<string>("");
  const [entered, setEntered] = useState(false);
  const [entryCount, setEntryCount] = useState(0);
  const [tables, setTables] = useState<PublicMahjongTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reportTable, setReportTable] = useState<PublicMahjongTable | null>(null);

  // 開催日（リーグ戦のみ・今日以降の直近、なければ最新）
  useEffect(() => {
    fetch("/api/mahjong/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const league = (d.schedule ?? []).filter(
          (s: MahjongScheduleEntry) => s.type === "league"
        );
        setSchedule(league);
        const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
        const upcoming = league.find((s: MahjongScheduleEntry) => s.date >= today);
        setEventDate(upcoming?.date ?? league[league.length - 1]?.date ?? "");
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    if (!eventDate) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [eRes, tRes] = await Promise.all([
        fetch(`/api/mahjong/entries?eventDate=${eventDate}`, { credentials: "include" }),
        fetch(`/api/mahjong/tables?mine=1`, { credentials: "include" }),
      ]);
      const eData = await eRes.json();
      const tData = await tRes.json();
      setEntered(!!eData.entered);
      setEntryCount((eData.entries ?? []).length);
      setTables(
        (tData.tables ?? []).filter((t: PublicMahjongTable) => t.eventDate === eventDate)
      );
    } catch {
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [eventDate]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function toggleEntry() {
    if (!eventDate) return;
    setBusy(true);
    try {
      await fetch(`/api/mahjong/entries${entered ? `?eventDate=${eventDate}` : ""}`, {
        method: entered ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: entered ? undefined : JSON.stringify({ eventDate }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!eventDate) {
    return <EmptyCard text="開催予定がまだ登録されていません" />;
  }

  const dateLabel = formatJpDate(eventDate);
  const full = !entered && entryCount >= MAHJONG_MAX_ENTRIES_PER_DATE;

  return (
    <div className="space-y-4">
      {/* 開催日切替（複数ある場合） */}
      {schedule.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {schedule.map((s) => (
            <button
              key={s.scheduleId}
              onClick={() => setEventDate(s.date)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                eventDate === s.date
                  ? "bg-[#231714] text-white"
                  : "bg-white text-[#231714]/60 border border-gray-100"
              }`}
            >
              {s.date.slice(5).replace("-", "/")}
            </button>
          ))}
        </div>
      )}

      {/* 参加表明カード */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-bold text-[#231714]">{dateLabel} のリーグ戦</span>
          <span className={`text-xs ${full ? "text-[#d8533a] font-bold" : "text-[#231714]/40"}`}>
            参加 {entryCount}/{MAHJONG_MAX_ENTRIES_PER_DATE}名{full ? "・満員" : ""}
          </span>
        </div>
        <p className="text-[11px] text-[#231714]/40 mb-3 leading-relaxed">
          卓は参加表明者をもとに運営が自動で組みます。先着{MAHJONG_MAX_ENTRIES_PER_DATE}名まで。
        </p>
        <button
          onClick={toggleEntry}
          disabled={busy || full}
          className={`w-full py-3 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
            entered
              ? "bg-gray-100 text-[#231714]/60"
              : "bg-[#B0E401] text-[#231714] shadow-sm"
          }`}
        >
          {busy ? "処理中..." : entered ? "参加表明済み（取り消す）" : full ? "満員（先着8名）" : "このリーグ戦に参加する"}
        </button>
      </div>

      {/* 自分の卓 */}
      <div>
        <p className="text-xs font-bold text-[#231714]/40 mb-2 px-1">あなたの卓</p>
        {tables.length === 0 ? (
          <EmptyCard text="まだ卓が組まれていません" />
        ) : (
          <div className="space-y-3">
            {tables
              .slice()
              .sort((a, b) => (a.round ?? 0) - (b.round ?? 0))
              .map((t) => {
                const me = t.members.find((m) => m.isCurrentUser);
                const needReport = me && me.points === null && t.status !== "completed";
                return (
                  <div key={t.tableId} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-sm font-bold text-[#231714]">
                        {t.round ? `第${t.round}回戦` : "卓"}
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
                      {t.members.map((m, i) => (
                        <div
                          key={i}
                          className={`rounded-xl p-2.5 ${
                            m.isCurrentUser ? "bg-[#A5C1C8]/10" : "bg-gray-50"
                          }`}
                        >
                          <div className="text-[11px] font-medium text-[#231714] truncate">
                            {m.displayName}
                            {m.isCurrentUser && (
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
                          needReport
                            ? "bg-[#231714] text-white"
                            : "bg-gray-100 text-[#231714]/60"
                        }`}
                      >
                        {needReport ? "スコアを申告する" : "申告をやり直す"}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {reportTable && (
        <ReportModal
          table={reportTable}
          onClose={() => setReportTable(null)}
          onDone={() => {
            setReportTable(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ───────── スコア申告モーダル ───────── */

function ReportModal({
  table,
  onClose,
  onDone,
}: {
  table: PublicMahjongTable;
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

/* ───────── チャンピオンシップ タブ ───────── */

function CsTab({ currentUserId }: { currentUserId?: string }) {
  const [event, setEvent] = useState<MahjongCsEvent | null>(null);
  const [entered, setEntered] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/mahjong/cs", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        setEvent(d.event ?? null);
        setEntered(!!d.entered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!event) {
    return <EmptyCard text="チャンピオンシップはまだ開催されていません" />;
  }

  const champion = event.championId
    ? event.entrants.find((e) => e.lineUserId === event.championId)
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-[#231714]">{event.name}</span>
          <span className="text-[11px] text-[#231714]/40">{formatJpDate(event.eventDate)}</span>
        </div>
        <p className="text-[11px] text-[#231714]/50 mt-1">
          {entered ? "あなたはエントリー済みです" : "CSは誰でも参加できます（リーグ上位はシード権で有利）"}
        </p>
      </div>

      {champion && (
        <div className="bg-gradient-to-r from-yellow-50 to-white border border-yellow-200 rounded-2xl p-4 text-center">
          <div className="text-xs text-yellow-700 font-bold">優勝</div>
          <div className="text-lg font-bold text-[#231714] mt-1">{champion.displayName}</div>
        </div>
      )}

      {event.rounds.length === 0 ? (
        <EmptyCard text="トーナメント表はまだ公開されていません" />
      ) : (
        event.rounds.map((round, ri) => (
          <div key={ri}>
            <p className="text-xs font-bold text-[#231714]/40 mb-2 px-1">
              {round.label}（各卓 上位{round.advanceCount}名通過）
            </p>
            <div className="space-y-2">
              {round.matches.map((m) => (
                <div key={m.matchId} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-[#231714]">{m.label}</span>
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        m.status === "completed"
                          ? "bg-[#B0E401]/20 text-[#231714]"
                          : "bg-orange-50 text-orange-600"
                      }`}
                    >
                      {m.status === "completed" ? "確定" : "対戦前"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {[...m.players]
                      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                      .map((p) => (
                        <div
                          key={p.lineUserId}
                          className={`flex items-center justify-between text-sm rounded-lg px-2 py-1 ${
                            p.lineUserId === currentUserId ? "bg-[#A5C1C8]/10" : ""
                          }`}
                        >
                          <span className="text-[#231714]">
                            {p.displayName}
                            {p.lineUserId === currentUserId && (
                              <span className="ml-1 text-[11px] text-[#A5C1C8]">（自分）</span>
                            )}
                          </span>
                          <span className="text-xs text-[#231714]/50">
                            {p.rank !== null ? `${p.rank}位` : "—"}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function formatJpDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(y, m - 1, day);
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return `${m}月${day}日(${w})`;
}
