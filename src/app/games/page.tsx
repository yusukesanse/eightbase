"use client";

import { GamesHub } from "@/components/games/GamesHub";
import { PageBg, PageHeading } from "@/components/ui/eb";

/**
 * /games ゲームハブ（E-1 でボトムバーの独立導線に）。
 * 麻雀/ダーツ/ビリヤード/ポーカーのリーグ・参加・当日・ルールを集約。
 * 参加費決済の戻り（?mjpay= 等）でも対象ゲームを初期選択して確定処理を走らせる。
 * 見出し「GAME」はここが出す（各 LeagueView は出さない＝二重見出しを避ける）。
 */
export default function GamesPage() {
  return (
    <PageBg>
      <header className="px-5 pt-[52px] pb-3">
        <PageHeading title="GAME" />
      </header>
      <div className="px-4 pb-4">
        <GamesHub />
      </div>
    </PageBg>
  );
}
