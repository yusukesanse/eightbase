"use client";

import type { MahjongCsEvent } from "@/types/mahjong";

// トーナメント編成の準備状況と参加確定人数を表示する。
export default function CsBracketBuilder({
  event,
}: {
  event: MahjongCsEvent & { csEventId: string };
  onChanged: () => void;
}) {
  return (
    <section className="bg-white rounded-xl border border-[#231714]/10 p-4 text-[#231714]">
      <h2 className="text-sm font-bold">編成画面（準備中）</h2>
      <p className="mt-2 text-xs">
        参加確定 {(event.entries ?? []).filter((entry) => entry.state === "confirmed").length}名
      </p>
    </section>
  );
}
