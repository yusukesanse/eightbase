"use client";

import type { MahjongStanding, MahjongLeagueTier } from "@/types";

/**
 * 麻雀リーグ ピラミッド（Jリーグ式の三角形）＋順位リスト
 * - 麻雀ブランド色: M1=ピンク / M2=シアン / M3=アンバー
 * - currentUserId が指定されると、その人を三角形の所属リーグ帯に動的にピン表示
 * - standings から動的描画（人数・順位が変われば表示も変わる）
 */

const TIER_META: Record<
  MahjongLeagueTier,
  { label: string; color: string; soft: string }
> = {
  M1: { label: "M1.LEAGUE", color: "#E4007F", soft: "#FBE6F1" },
  M2: { label: "M2.LEAGUE", color: "#00A0E9", soft: "#E1F4FC" },
  M3: { label: "M3.LEAGUE", color: "#F5A800", soft: "#FCF1DA" },
};

const TIER_ORDER: MahjongLeagueTier[] = ["M1", "M2", "M3"];

/** 三角形ジオメトリ（viewBox 0 0 360 280） */
const APEX_X = 180;
const TOP_Y = 8;
const BASE_Y = 248;
const HALF_BASE = 164;
const BAND_Y = [8, 88, 168, 248]; // M1: 8-88, M2: 88-168, M3: 168-248

function halfWidth(y: number) {
  return ((y - TOP_Y) / (BASE_Y - TOP_Y)) * HALF_BASE;
}
function bandPolygon(i: number): string {
  const yTop = BAND_Y[i];
  const yBot = BAND_Y[i + 1];
  const lt = APEX_X - halfWidth(yTop);
  const rt = APEX_X + halfWidth(yTop);
  const lb = APEX_X - halfWidth(yBot);
  const rb = APEX_X + halfWidth(yBot);
  if (i === 0) {
    // 最上段は三角形
    return `${APEX_X},${TOP_Y} ${lb},${yBot} ${rb},${yBot}`;
  }
  return `${lt},${yTop} ${rt},${yTop} ${rb},${yBot} ${lb},${yBot}`;
}

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
  TIER_ORDER.forEach((t) =>
    byTier[t].sort((a, b) => a.rank - b.rank)
  );

  const me = currentUserId
    ? standings.find((s) => s.lineUserId === currentUserId)
    : undefined;
  const myTierIndex = me ? TIER_ORDER.indexOf(me.tier) : -1;

  return (
    <div className="space-y-5">
      {/* ピラミッド */}
      <div className="relative">
        <svg viewBox="0 0 360 280" className="w-full" role="img" aria-label="麻雀リーグのピラミッド図">
          {TIER_ORDER.map((t, i) => (
            <polygon key={t} points={bandPolygon(i)} fill={TIER_META[t].color} />
          ))}

          {/* 各帯のラベル（リーグ名＋人数） */}
          {TIER_ORDER.map((t, i) => {
            const midY = (BAND_Y[i] + BAND_Y[i + 1]) / 2;
            const labelY = i === 0 ? BAND_Y[i + 1] - 24 : midY - (myTierIndex === i ? 14 : 4);
            return (
              <g key={`label-${t}`}>
                <text
                  x={APEX_X}
                  y={labelY}
                  textAnchor="middle"
                  fill="#fff"
                  style={{ fontSize: 13, fontWeight: 500 }}
                >
                  {t}
                </text>
                <text
                  x={APEX_X}
                  y={labelY + 15}
                  textAnchor="middle"
                  fill="#fff"
                  style={{ fontSize: 11 }}
                >
                  {byTier[t].length}名
                </text>
              </g>
            );
          })}

          {/* 自分のピン（所属リーグ帯に動的表示） */}
          {me && myTierIndex >= 0 && (
            <MeMarker
              x={APEX_X}
              y={(BAND_Y[myTierIndex] + BAND_Y[myTierIndex + 1]) / 2 + 20}
              name={me.displayName}
              color={TIER_META[me.tier].color}
            />
          )}

          {/* 右側の引き出しラベル */}
          <line x1="248" y1="50" x2="316" y2="36" stroke={TIER_META.M1.color} strokeWidth="1.5" />
          <text x="320" y="40" fill={TIER_META.M1.color} style={{ fontSize: 11, fontWeight: 500 }}>
            M1
          </text>
        </svg>
      </div>

      {/* 順位リスト */}
      <div className="space-y-3">
        {TIER_ORDER.map((t) => (
          <div
            key={`list-${t}`}
            className="bg-white rounded-2xl border border-[#231714]/10 overflow-hidden"
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
                    className="flex items-center gap-3 px-4 py-2.5 border-t border-[#231714]/5"
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

/** 三角形上の「あなたはここ」マーカー */
function MeMarker({
  x,
  y,
  name,
  color,
}: {
  x: number;
  y: number;
  name: string;
  color: string;
}) {
  return (
    <g>
      {/* 吹き出し */}
      <rect x={x - 30} y={y - 38} width="60" height="18" rx="9" fill="#231714" />
      <text x={x} y={y - 25} textAnchor="middle" fill="#fff" style={{ fontSize: 10, fontWeight: 500 }}>
        あなた
      </text>
      <polygon points={`${x - 4},${y - 21} ${x + 4},${y - 21} ${x},${y - 15}`} fill="#231714" />
      {/* アバター */}
      <circle cx={x} cy={y} r="14" fill="#fff" stroke={color} strokeWidth="2.5" />
      <text x={x} y={y + 4} textAnchor="middle" fill={color} style={{ fontSize: 12, fontWeight: 700 }}>
        {initial(name)}
      </text>
    </g>
  );
}
