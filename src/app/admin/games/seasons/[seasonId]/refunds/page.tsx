"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import GameRefundsPanel from "@/components/admin/GameRefundsPanel";

/**
 * 返金対応タブ（種目で分岐・全シーズン横断表示）。麻雀/ダーツ/ビリヤードで共通パネルを使う。
 */
export default function SeasonRefundsPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [category, setCategory] = useState<"mahjong" | "darts" | "billiards" | null>(null);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        const found = (d.seasons ?? []).find((s: Season) => s.seasonId === seasonId);
        const c = found?.gameCategory;
        setCategory(c === "darts" || c === "billiards" ? c : "mahjong");
      })
      .catch(() => setCategory("mahjong"));
  }, [seasonId]);

  if (category === null) {
    return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }
  return <GameRefundsPanel gameCategory={category} />;
}
