"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import type { Season } from "@/types";
import GameRefundsPanel from "@/components/admin/GameRefundsPanel";
import GameUnconfirmedPaymentsPanel from "@/components/admin/GameUnconfirmedPaymentsPanel";

/**
 * 参加費・返金タブ（種目で分岐・全シーズン横断表示）。4種目で共通パネルを使う。
 * 上段=入金確認待ち（課金済みなのに未払いのまま残ったものを支払い済みに戻す）、
 * 下段=返金対応（キャンセル依頼の処理）。
 */
export default function SeasonRefundsPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [category, setCategory] = useState<"mahjong" | "darts" | "billiards" | "poker" | null>(null);

  useEffect(() => {
    fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        const found = (d.seasons ?? []).find((s: Season) => s.seasonId === seasonId);
        const c = found?.gameCategory;
        setCategory(c === "darts" || c === "billiards" || c === "poker" ? c : "mahjong");
      })
      .catch(() => setCategory("mahjong"));
  }, [seasonId]);

  if (category === null) {
    return <div className="p-8 flex justify-center"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }
  return (
    <div>
      <GameUnconfirmedPaymentsPanel gameCategory={category} />
      <GameRefundsPanel gameCategory={category} />
    </div>
  );
}
