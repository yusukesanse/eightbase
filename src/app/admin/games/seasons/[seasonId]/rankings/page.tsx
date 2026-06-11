"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { ScoreboardGameId, RankingEntry } from "@/types";

/* ───────── 定数 ───────── */

const GAME_TABS: { id: ScoreboardGameId; label: string }[] = [
  { id: "mahjong", label: "麻雀" },
  { id: "poker", label: "ポーカー" },
  { id: "billiards", label: "ビリヤード" },
  { id: "darts", label: "ダーツ" },
];

const PERIOD_TABS = [
  { id: "monthly" as const, label: "月間" },
  { id: "annual" as const, label: "年間" },
];

/* ───────── メインコンポーネント ───────── */

export default function SeasonRankingsPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [gameCategory, setGameCategory] = useState<ScoreboardGameId>("mahjong");
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [yearMonth, setYearMonth] = useState(new Date().toISOString().slice(0, 7));
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(false);

  /* ───────── ランキング取得 ───────── */

  const fetchRanking = useCallback(async () => {
    if (!seasonId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        gameCategory,
        seasonId,
        period,
        yearMonth,
      });
      const res = await fetch(`/api/admin/scoreboard/rankings?${params}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      setRanking(data.ranking ?? []);
    } catch {
      setRanking([]);
    } finally {
      setLoading(false);
    }
  }, [seasonId, gameCategory, period, yearMonth]);

  useEffect(() => {
    fetchRanking();
  }, [fetchRanking]);

  /* ───────── 月送り ───────── */

  function shiftMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  /* ───────── UI ───────── */

  return (
    <div className="p-4 sm:p-8">
      {/* フィルター */}
      <div className="bg-white rounded-xl border border-[#231714]/10 p-4 mb-5 space-y-3">
        {/* 種目タブ */}
        <div className="flex gap-1 bg-[#231714]/5 rounded-xl p-1">
          {GAME_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setGameCategory(tab.id)}
              className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                gameCategory === tab.id
                  ? "bg-white text-[#231714] shadow-sm"
                  : "text-[#231714]/40 hover:text-[#231714]/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 期間切替 + 月ナビ */}
        <div className="flex items-center gap-3">
          <div className="flex gap-1 bg-[#231714]/5 rounded-lg p-0.5">
            {PERIOD_TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setPeriod(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  period === tab.id
                    ? "bg-white text-[#231714] shadow-sm"
                    : "text-[#231714]/40 hover:text-[#231714]/60"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {period === "monthly" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => shiftMonth(-1)}
                className="px-2 py-1 text-xs text-[#231714]/50 hover:text-[#231714] rounded hover:bg-gray-100"
              >
                ←
              </button>
              <span className="text-sm font-medium text-[#231714] min-w-[80px] text-center">
                {yearMonth.replace("-", "年") + "月"}
              </span>
              <button
                onClick={() => shiftMonth(1)}
                className="px-2 py-1 text-xs text-[#231714]/50 hover:text-[#231714] rounded hover:bg-gray-100"
              >
                →
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ランキング表 */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : ranking.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
          データがありません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-[#231714]/5">
                <th className="text-center px-4 py-2.5 text-xs font-medium text-[#231714]/60 w-14">順位</th>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">プレイヤー</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-[#231714]/60">スコア</th>
                <th className="text-right px-4 py-2.5 text-xs font-medium text-[#231714]/60 w-20">参加回数</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((entry) => (
                <tr key={entry.lineUserId} className="border-b border-[#231714]/5 hover:bg-[#231714]/[0.02]">
                  <td className="px-4 py-3 text-center">
                    {entry.rank <= 3 ? (
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                        entry.rank === 1 ? "bg-yellow-100 text-yellow-700" :
                        entry.rank === 2 ? "bg-gray-100 text-gray-600" :
                        "bg-orange-100 text-orange-700"
                      }`}>
                        {entry.rank}
                      </span>
                    ) : (
                      <span className="text-sm text-[#231714]/50">{entry.rank}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {entry.pictureUrl ? (
                        <img src={entry.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#A5C1C8]">
                          {entry.displayName.charAt(0)}
                        </div>
                      )}
                      <span className="text-sm font-medium text-[#231714]">{entry.displayName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-bold text-[#231714]">{entry.totalScore.toLocaleString()}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-[#231714]/50">{entry.playedCount}回</span>
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
