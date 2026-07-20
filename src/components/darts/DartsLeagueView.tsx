"use client";

import { useEffect, useState, useCallback } from "react";
import clsx from "clsx";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { completeDartsEntryPayment } from "@/lib/dartsPayment";
import { DartsJoinTab } from "@/components/darts/DartsJoinTab";
import { DartsReportTab } from "@/components/darts/DartsReportTab";
import { DartsRulesTab } from "@/components/darts/DartsRulesTab";
import type { DartsPaymentStatus, DartsScheduleEntry } from "@/types/darts";

/**
 * ランキング > ダーツ のビュー（麻雀 MahjongLeagueView の読み替え）。
 * タブ: リーグ（通算ポイント順ランキング）/ 参加（開催日カレンダー＋参加/決済）/ ルール・約款。
 * ※「卓確認/申告」（当日フロー・GMパネル）は次の実装増分で追加する。
 */

type SubTab = "league" | "join" | "report" | "rules";

interface RankingUser {
  rank: number;
  displayName: string;
  pictureUrl?: string;
  totalScore: number;
  playedCount: number;
}

export function DartsLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  // 参加状況（カレンダー・月1回制御・支払い状態）
  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [paymentStatusByDate, setPaymentStatusByDate] = useState<Record<string, DartsPaymentStatus | null>>({});
  const [scheduleDates, setScheduleDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [payBanner, setPayBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // 開催日一覧（初回のみ）。dartsSchedule が「有効な開催日」の唯一の正。
  useEffect(() => {
    fetch("/api/darts/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setScheduleDates(new Set<string>((d.schedule ?? []).map((s: DartsScheduleEntry) => s.date))))
      .catch(() => {});
  }, []);

  const loadCore = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/darts/entries?mine=1", { credentials: "include" });
      const data = await res.json();
      const entered = new Set<string>();
      const payByDate: Record<string, DartsPaymentStatus | null> = {};
      for (const e of data.entries ?? []) {
        entered.add(e.eventDate);
        payByDate[e.eventDate] = e.paymentStatus ?? null;
      }
      setEnteredDates(entered);
      setPaymentRequired(!!data.paymentRequired);
      setPaymentStatusByDate(payByDate);
    } catch {
      /* noop */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);
  useAutoRefresh(() => loadCore(true), 15000);

  // Square 参加費決済の戻り: ?dartspay=<エントリーID> を確定処理する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const rid = url.searchParams.get("dartspay");
    if (!rid) return;
    setSubTab("join");
    completeDartsEntryPayment(rid)
      .then((r) => {
        setPayBanner({
          ok: r.paid,
          text: r.paid ? "参加費のお支払いが完了しました。" : "決済の確認ができませんでした。",
        });
        if (r.paid) loadCore(true);
      })
      .catch((e) => {
        setPayBanner({ ok: false, text: e instanceof Error ? e.message : "決済の確認に失敗しました" });
      })
      .finally(() => {
        url.searchParams.delete("dartspay");
        window.history.replaceState({}, "", url.pathname + url.search);
      });
    // 初回マウント時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {payBanner && (
        <div
          className={`mb-3 rounded-2xl px-4 py-3 text-[13px] font-bold flex items-center justify-between gap-2 ${
            payBanner.ok ? "bg-[#eef4dd] text-[#5f7d1e]" : "bg-[#fdece8] text-[#d8533a]"
          }`}
        >
          <span>{payBanner.text}</span>
          <button onClick={() => setPayBanner(null)} className="shrink-0 font-black opacity-60">
            ×
          </button>
        </div>
      )}

      {/* サブタブ（選択中は白ピル＋アクセント文字＋太字＋リング） */}
      <div className="flex gap-1 mb-4 bg-[#231714]/[0.08] rounded-xl p-1">
        {(
          [
            { id: "league", label: "リーグ" },
            { id: "join", label: "参加" },
            { id: "report", label: "卓確認/申告" },
            { id: "rules", label: "ルール/約款" },
          ] as { id: SubTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-xs text-center transition-all ${
              subTab === t.id
                ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25"
                : "text-[#231714]/80 font-medium"
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
        <DartsRankingTab />
      ) : subTab === "join" ? (
        <DartsJoinTab
          enteredDates={enteredDates}
          scheduleDates={scheduleDates}
          cancelledDates={new Set()}
          paymentRequired={paymentRequired}
          paymentStatusByDate={paymentStatusByDate}
          onChanged={() => loadCore(true)}
        />
      ) : subTab === "report" ? (
        <DartsReportTab onChanged={() => loadCore(true)} />
      ) : (
        <DartsRulesTab />
      )}
    </div>
  );
}

/* ───────── リーグ（通算ポイント順ランキング） ───────── */

function DartsRankingTab() {
  const [ranking, setRanking] = useState<RankingUser[]>([]);
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(false);

  function shiftMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ gameCategory: "darts", period, yearMonth });
    fetch(`/api/games/ranking?${params}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRanking(d.ranking ?? []))
      .catch(() => setRanking([]))
      .finally(() => setLoading(false));
  }, [period, yearMonth]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <div className="flex gap-0.5 bg-[#231714]/[0.08] rounded-lg p-0.5">
          {(["monthly", "annual"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx(
                "px-2.5 py-1 rounded-md text-[11px] transition-all",
                period === p
                  ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25"
                  : "text-[#231714]/80 font-medium"
              )}
            >
              {p === "monthly" ? "月間" : "年間"}
            </button>
          ))}
        </div>
        {period === "monthly" && (
          <div className="flex items-center gap-1.5 ml-auto">
            <button onClick={() => shiftMonth(-1)} className="px-1.5 py-0.5 text-xs text-[#231714]/80 hover:text-[#231714] rounded">
              ←
            </button>
            <span className="text-xs font-medium text-[#231714] min-w-[70px] text-center">
              {yearMonth.replace("-", "年") + "月"}
            </span>
            <button onClick={() => shiftMonth(1)} className="px-1.5 py-0.5 text-xs text-[#231714]/80 hover:text-[#231714] rounded">
              →
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : ranking.length === 0 ? (
        <div className="py-12 text-center text-sm text-[#231714]/70">まだランキングデータがありません</div>
      ) : (
        <div className="space-y-2">
          {ranking.map((user) => {
            const maxScore = ranking[0]?.totalScore || 1;
            const pct = Math.max(4, Math.round((user.totalScore / maxScore) * 100));
            return (
              <div key={user.rank} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                <div className="flex items-center gap-3">
                  <span
                    className={clsx(
                      "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                      user.rank === 1 ? "bg-yellow-100 text-yellow-700" :
                      user.rank === 2 ? "bg-gray-100 text-gray-700" :
                      user.rank === 3 ? "bg-orange-100 text-orange-600" :
                      "bg-gray-50 text-gray-700"
                    )}
                  >
                    {user.rank}
                  </span>
                  {user.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={user.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-xs font-bold text-[#4f757e] shrink-0">
                      {user.displayName.charAt(0)}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-[#231714] truncate">{user.displayName}</span>
                      <span className="text-sm font-bold text-[#231714] shrink-0">{user.totalScore.toLocaleString()}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full bg-[#c0392b]/70 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex gap-3 mt-1 text-[10px] text-[#231714]/80">
                      <span>{user.playedCount}回参加</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
