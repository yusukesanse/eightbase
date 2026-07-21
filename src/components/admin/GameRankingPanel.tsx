"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

/**
 * ゲームの通算ランキング（管理・読み取り専用）。ダーツ/ビリヤードのランキングタブで使用。
 * /api/admin/games/standings?gameCategory=&seasonId= を tier 別に表示。
 * （麻雀はリーグ確定など専用UIがあるため別ページ）
 */

interface Standing {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  games: number;
  firsts: number;
  tier: string; // D1/D2/D3 or B1/B2/B3
}

type GameCategory = "darts" | "billiards";
const GAME_NAME: Record<GameCategory, string> = { darts: "ダーツ", billiards: "ビリヤード" };
const TIER_COLOR: Record<string, string> = { "1": "#a2125a", "2": "#1172a5", "3": "#b48f13" };
const TIER_RANGE: Record<string, string> = { "1": "通算 1〜4位", "2": "通算 5〜8位", "3": "通算 9位以下" };

export default function GameRankingPanel({ gameCategory }: { gameCategory: GameCategory }) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [items, setItems] = useState<Standing[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/games/standings?gameCategory=${gameCategory}&seasonId=${seasonId}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setItems(d.standings ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [gameCategory, seasonId]);
  useEffect(() => { load(); }, [load]);

  const tiers = ["1", "2", "3"];

  return (
    <div className="p-5 max-w-3xl">
      <h1 className="text-lg font-bold text-[#231714] mb-1">{GAME_NAME[gameCategory]} ランキング</h1>
      <p className="text-sm text-[#231714]/80 mb-4">
        このシーズンの通算順位（各開催日の獲得ptを合算）。同ptは 1位回数 → 出場数 → 名前順。
        利用者アプリの「リーグ」タブと同じ集計です。
      </p>

      {loading ? (
        <div className="py-10 text-center text-sm text-[#231714]/80">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/80">
          まだ成績データがありません（本日終了で確定した分から反映されます）
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {tiers.map((t) => {
            const rows = items.filter((s) => s.tier.endsWith(t));
            if (rows.length === 0) return null;
            const prefix = rows[0].tier.charAt(0);
            const color = TIER_COLOR[t];
            return (
              <div key={t}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[13px] font-black" style={{ color }}>{prefix}{t} リーグ</span>
                  <span className="text-[11px] text-[#231714]/70">{TIER_RANGE[t]}</span>
                  <span className="text-[11px] text-[#231714]/60">・{rows.length}名</span>
                </div>
                <table className="w-full text-sm bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
                  <thead>
                    <tr className="text-left text-[11px] text-[#231714]/85 border-b border-[#231714]/10">
                      <th className="px-3 py-2 w-[44px]">順位</th>
                      <th className="px-3 py-2">ユーザー</th>
                      <th className="px-3 py-2 text-right">出場</th>
                      <th className="px-3 py-2 text-right">1位</th>
                      <th className="px-3 py-2 text-right">通算pt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s.lineUserId} className="border-b border-[#231714]/5 last:border-0">
                        <td className="px-3 py-2 font-black tabular-nums" style={{ color: s.rank <= 3 ? color : "#5f6266" }}>{s.rank}</td>
                        <td className="px-3 py-2 font-bold text-[#1c1f21]">{s.displayName}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#231714]/80">{s.games}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-[#231714]/80">{s.firsts}</td>
                        <td className="px-3 py-2 text-right font-black tabular-nums">{s.totalPt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
