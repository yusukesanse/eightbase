"use client";

import dynamic from "next/dynamic";
import type { MahjongStanding, MahjongLeagueTier } from "@/types";

/**
 * 麻雀リーグ ピラミッド表示
 * - 上部: 正面向き 3D ピラミッド（深色ジュエル調・自分を浮遊アバター表示）
 * - 下部: リーグ別の順位リスト（自分をハイライト）
 * standings から動的描画。
 */

// 3D は WebGL のためクライアント専用（SSR 無効）
const LeaguePyramid3D = dynamic(
  () => import("./LeaguePyramid3D").then((m) => m.LeaguePyramid3D),
  { ssr: false }
);

const TIER_META: Record<
  MahjongLeagueTier,
  { label: string; color: string; soft: string }
> = {
  M1: { label: "M1.LEAGUE", color: "#7C4A63", soft: "#F3EAEF" }, // プラム
  M2: { label: "M2.LEAGUE", color: "#3E6B7A", soft: "#E8F0F2" }, // ティール
  M3: { label: "M3.LEAGUE", color: "#9C7B3C", soft: "#F5EEDF" }, // ブロンズ
};

const TIER_ORDER: MahjongLeagueTier[] = ["M1", "M2", "M3"];

function initial(name: string) {
  return name.trim().charAt(0) || "?";
}

export function LeaguePyramid({
  standings,
  currentUserId,
}: {
  standings: MahjongStanding[];
  currentUserId?: string;
}) {
  const byTier: Record<MahjongLeagueTier, MahjongStanding[]> = {
    M1: [],
    M2: [],
    M3: [],
  };
  standings.forEach((s) => byTier[s.tier].push(s));
  TIER_ORDER.forEach((t) => byTier[t].sort((a, b) => a.rank - b.rank));

  return (
    <div className="space-y-5">
      {/* 3D ピラミッド */}
      <LeaguePyramid3D standings={standings} currentUserId={currentUserId} />

      {/* 順位リスト */}
      <div className="space-y-3">
        {TIER_ORDER.map((t) => (
          <div
            key={`list-${t}`}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
          >
            <div
              className="flex items-center gap-2 px-4 py-2.5"
              style={{ borderLeft: `4px solid ${TIER_META[t].color}` }}
            >
              <span className="text-sm font-bold text-[#231714]">{TIER_META[t].label}</span>
              <span className="text-xs text-[#231714]/50">{byTier[t].length}名</span>
            </div>
            {byTier[t].length === 0 ? (
              <div className="px-4 py-4 text-xs text-[#231714]/40">該当者なし</div>
            ) : (
              byTier[t].map((s) => {
                const isMe = s.lineUserId === currentUserId;
                return (
                  <div
                    key={s.lineUserId}
                    className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50"
                    style={isMe ? { background: TIER_META[t].soft } : undefined}
                  >
                    <span className="w-6 text-center text-xs text-[#231714]/50">{s.rank}</span>
                    {s.pictureUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                    ) : (
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white"
                        style={{ background: TIER_META[t].color }}
                      >
                        {initial(s.displayName)}
                      </div>
                    )}
                    <span className="flex-1 text-sm text-[#231714] truncate">
                      {s.displayName}
                      {isMe && (
                        <span className="ml-1 text-[11px]" style={{ color: TIER_META[t].color }}>
                          （あなた）
                        </span>
                      )}
                    </span>
                    <span className="text-sm font-bold text-[#231714]">
                      {s.average.toLocaleString()}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[#231714]/40 leading-relaxed">
        順位はシーズン通算アベレージ順。毎月のリーグ戦後にリーグの入れ替えがあります。
      </p>
    </div>
  );
}
