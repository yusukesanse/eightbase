"use client";

import { useEffect, useState } from "react";
import { GAME_CATEGORIES, type ScoreboardGameId } from "@/types";
import { MahjongLeagueView } from "@/components/mahjong/MahjongLeagueView";
import { DartsLeagueView } from "@/components/darts/DartsLeagueView";
import { BilliardsLeagueView } from "@/components/billiards/BilliardsLeagueView";
import { PokerLeagueView } from "@/components/poker/PokerLeagueView";
import clsx from "clsx";

/**
 * ゲームハブ（麻雀/ダーツ/ビリヤード/ポーカーのリーグ・参加・当日・ルール）。
 * 以前は Info の「ゲーム」タブだったが、E-1 でボトムバーの独立導線 `/games` に移設した。
 * 参加費 Square 決済の戻り（?mjpay= / ?dartspay= / ?billiardspay= / ?pokerpay=）では、
 * 対象のゲームを初期選択して該当 LeagueView をマウントし、決済確定を確実に走らせる。
 */

interface RankingUser {
  rank: number;
  displayName: string;
  pictureUrl?: string;
  totalScore: number;
  playedCount: number;
}

const PAY_PARAM_TO_GAME: Record<string, ScoreboardGameId> = {
  mjpay: "mahjong",
  dartspay: "darts",
  billiardspay: "billiards",
  pokerpay: "poker",
};

/** 決済戻りの URL パラメータから初期表示ゲームを決める（無ければ麻雀）。 */
function initialGameFromUrl(): ScoreboardGameId {
  if (typeof window === "undefined") return "mahjong";
  const params = new URL(window.location.href).searchParams;
  for (const [param, game] of Object.entries(PAY_PARAM_TO_GAME)) {
    if (params.has(param)) return game;
  }
  return "mahjong";
}

export function GamesHub() {
  const [gameCategory, setGameCategory] = useState<ScoreboardGameId>("mahjong");
  useEffect(() => {
    setGameCategory(initialGameFromUrl());
  }, []);

  // 麻雀以外の読み取り専用ランキング（専用ビューを持たない種目のフォールバック＝現状ポーカー以外は全て専用ビュー）。
  const [ranking, setRanking] = useState<RankingUser[]>([]);
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");
  const [yearMonth, setYearMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [rankingLoading, setRankingLoading] = useState(false);

  function shiftMonth(delta: number) {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYearMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  useEffect(() => {
    if (gameCategory === "mahjong" || gameCategory === "darts" || gameCategory === "billiards" || gameCategory === "poker") return;
    setRankingLoading(true);
    const params = new URLSearchParams({ gameCategory, period, yearMonth });
    fetch(`/api/games/ranking?${params}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setRanking(d.ranking ?? []))
      .catch(() => setRanking([]))
      .finally(() => setRankingLoading(false));
  }, [gameCategory, period, yearMonth]);

  return (
    <div>
      {/* ゲーム選択（選択中は白ピル＋アクセント文字＋太字＋リングで明示） */}
      <div className="flex gap-1 mb-4 bg-[#231714]/[0.08] rounded-xl p-1 overflow-x-auto">
        {GAME_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setGameCategory(cat.id as ScoreboardGameId)}
            className={clsx(
              "flex-1 px-2.5 py-2 rounded-lg text-xs whitespace-nowrap transition-all",
              gameCategory === cat.id
                ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25"
                : "text-[#231714]/80 font-medium"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {gameCategory === "mahjong" ? (
        <MahjongLeagueView />
      ) : gameCategory === "darts" ? (
        <DartsLeagueView />
      ) : gameCategory === "billiards" ? (
        <BilliardsLeagueView />
      ) : gameCategory === "poker" ? (
        <PokerLeagueView />
      ) : (
        <>
          {/* 期間切替 + 月ナビ（未使用のフォールバック。全種目とも専用ビューを持つ） */}
          <div className="flex items-center gap-2 mb-4">
            <div className="flex gap-0.5 bg-[#231714]/[0.08] rounded-lg p-0.5">
              <button
                onClick={() => setPeriod("monthly")}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-[11px] transition-all",
                  period === "monthly" ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25" : "text-[#231714]/80 font-medium"
                )}
              >
                月間
              </button>
              <button
                onClick={() => setPeriod("annual")}
                className={clsx(
                  "px-2.5 py-1 rounded-md text-[11px] transition-all",
                  period === "annual" ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25" : "text-[#231714]/80 font-medium"
                )}
              >
                年間
              </button>
            </div>
            {period === "monthly" && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button onClick={() => shiftMonth(-1)} className="px-1.5 py-0.5 text-xs text-[#231714]/80 hover:text-[#231714] rounded">←</button>
                <span className="text-xs font-medium text-[#231714] min-w-[70px] text-center">{yearMonth.replace("-", "年") + "月"}</span>
                <button onClick={() => shiftMonth(1)} className="px-1.5 py-0.5 text-xs text-[#231714]/80 hover:text-[#231714] rounded">→</button>
              </div>
            )}
          </div>

          {rankingLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : ranking.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mb-3 text-gray-400">
                <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="2" />
                <path d="M20 14v8M20 26v0" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
              <p className="text-sm text-gray-700">まだランキングデータがありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {ranking.map((user) => {
                const maxScore = ranking[0]?.totalScore || 1;
                const pct = Math.round((user.totalScore / maxScore) * 100);
                return (
                  <div key={user.rank} className="bg-white rounded-xl p-3 shadow-sm border border-gray-100">
                    <div className="flex items-center gap-3">
                      <span
                        className={clsx(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          user.rank === 1 ? "bg-yellow-100 text-yellow-700" : user.rank === 2 ? "bg-gray-100 text-gray-700" : user.rank === 3 ? "bg-orange-100 text-orange-600" : "bg-gray-50 text-gray-700"
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
                          <div className="h-full rounded-full bg-[#A5C1C8] transition-all" style={{ width: `${pct}%` }} />
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
        </>
      )}
    </div>
  );
}
