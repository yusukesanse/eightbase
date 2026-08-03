"use client";

import { useEffect, useState } from "react";
import { GAME_CATEGORIES, type ScoreboardGameId } from "@/types";
import { findPaymentReturn } from "@/lib/gamePaymentReturn";
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


/** 決済戻りの URL パラメータから初期表示ゲームを決める（無ければ麻雀）。 */
function initialGameFromUrl(): ScoreboardGameId {
  if (typeof window === "undefined") return "mahjong";
  return findPaymentReturn(window.location.search)?.game ?? "mahjong";
}

export function GamesHub() {
  const [gameCategory, setGameCategory] = useState<ScoreboardGameId>("mahjong");
  useEffect(() => {
    setGameCategory(initialGameFromUrl());
  }, []);

  // 麻雀以外の読み取り専用ランキング（専用ビューを持たない種目のフォールバック＝現状ポーカー以外は全て専用ビュー）。



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
      ) : (
        <PokerLeagueView />
      )}
    </div>
  );
}
