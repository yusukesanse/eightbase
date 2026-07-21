"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import GameScheduleCalendar from "@/components/admin/GameScheduleCalendar";

/**
 * 日程タブ（全ゲーム共通）。カレンダーで開催日を追加/削除する（任意日に変更可）。
 * 種目別の既定日（麻雀=毎週土曜 / ダーツ=隔週木曜 / ビリヤード=第2第4土曜）は一括投入できる。
 */
export default function SeasonSchedulePage() {
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
    return (
      <div className="p-8 flex justify-center">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <GameScheduleCalendar gameCategory={category} />;
}
