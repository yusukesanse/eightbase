"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import GameRankingPanel from "@/components/admin/GameRankingPanel";

/**
 * ランキングタブ（ダーツ/ビリヤード）。通算順位を tier 別に読み取り専用表示。
 * 麻雀はリーグ確定など専用UI（/mahjong）を使うため、このルートは darts/billiards 用。
 */
export default function SeasonRankingPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [category, setCategory] = useState<"darts" | "billiards" | "poker" | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        const found = (d.seasons ?? []).find((s: Season) => s.seasonId === seasonId);
        const c = found?.gameCategory;
        if (c === "darts" || c === "billiards" || c === "poker") setCategory(c);
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [seasonId]);

  if (!ready) {
    return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!category) {
    return <div className="p-8 text-sm text-[#231714]/70">このシーズンではランキングタブは利用できません。</div>;
  }
  return <GameRankingPanel gameCategory={category} />;
}
