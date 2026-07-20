"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import MahjongScheduleCalendar from "@/components/admin/MahjongScheduleCalendar";
import DartsScheduleAdmin from "@/components/admin/DartsScheduleAdmin";
import BilliardsScheduleAdmin from "@/components/admin/BilliardsScheduleAdmin";

/**
 * 日程タブ。種目で分岐する:
 * - 麻雀: 月別カレンダー起点（毎週土曜が開催日・クリックで休催トグル）。
 * - ダーツ: 開催日を明示登録（隔週木曜が既定）。
 * - ビリヤード: 開催日を明示登録（第2/第4土曜が既定）。
 */
export default function SeasonSchedulePage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [category, setCategory] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        const found = (d.seasons ?? []).find((s: Season) => s.seasonId === seasonId);
        setCategory(found?.gameCategory ?? "mahjong");
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

  return category === "darts" ? <DartsScheduleAdmin /> : category === "billiards" ? <BilliardsScheduleAdmin /> : <MahjongScheduleCalendar />;
}
