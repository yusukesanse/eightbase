"use client";

import { GamesHub } from "@/components/games/GamesHub";

/**
 * /games ゲームハブ（E-1 でボトムバーの独立導線に）。
 * 麻雀/ダーツ/ビリヤード/ポーカーのリーグ・参加・当日・ルールを集約。
 * 参加費決済の戻り（?mjpay= 等）でも対象ゲームを初期選択して確定処理を走らせる。
 */
export default function GamesPage() {
  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white pt-12 pb-3 px-5">
        <h1 className="text-[17px] font-medium text-[#231714]">ゲーム</h1>
      </header>
      <div className="p-4">
        <GamesHub />
      </div>
    </div>
  );
}
