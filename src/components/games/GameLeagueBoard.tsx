"use client";

import dynamic from "next/dynamic";
import { Avatar } from "@/components/ui/LineContact";
import { cssColor, tierIndexOf, type TierKeys } from "@/components/LeaguePyramid3D";

/**
 * 種目共通のリーグボード（麻雀 `LeaguePyramid` と同じ見た目に統一）。
 * ダーツ / ビリヤード / ポーカーが共有する。
 * - 上部: 3Dピラミッド（`LeaguePyramid3D`）を黒帯ヒーローに配置
 * - 下部: 3階層別の順位リスト（自分を YOU でハイライト・行タップで戦歴）
 *
 * 種目差は **tierKeys（D1/B1/P1…）と unit（pt / Chips）と脚注だけ**。
 * 順位帯（1〜4 / 5〜8 / 9位〜）と配色は全種目共通なので、ここで一元管理する。
 * ※ 種目ごとの独自ヒーロー（ダーツ盤・ビリヤードtier板・ポーカーのカード盤）は
 *   デザイン統一のため廃止した。復活させないこと。
 */

// 3D は WebGL のためクライアント専用（SSR 無効）
const LeaguePyramid3D = dynamic(
  () => import("@/components/LeaguePyramid3D").then((m) => m.LeaguePyramid3D),
  { ssr: false }
);

const KICKER = ["PREMIER", "CHALLENGER", "CONTENDER"] as const;
const RANGE = ["1〜4位", "5〜8位", "9位〜"] as const;

export interface GameLeagueStanding {
  rank: number;
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  isMe?: boolean;
  /** 主指標の値（通算pt / 通算チップ など）。表示は桁区切り。 */
  value: number;
  /** 名前の下の補足行（例: "出場 6回 ・ 1位 3回"）。 */
  subText: string;
  /** 累積推移（2点以上あれば行末にスパークライン）。 */
  trend?: number[];
}

export function GameLeagueBoard({
  standings,
  tierKeys,
  unit,
  footnote,
  onSelectPlayer,
  ariaLabel,
  emptyText = "まだ順位データがありません",
}: {
  standings: GameLeagueStanding[];
  /** 3階層のラベル（上位→下位）。例: ["D1","D2","D3"] */
  tierKeys: TierKeys;
  /** 主指標の単位表記（例: "pt" / "Chips"）。 */
  unit: string;
  /** 順位の決まり方の脚注。 */
  footnote: string;
  /** 行タップ（戦歴シートを開く）。 */
  onSelectPlayer?: (lineUserId: string) => void;
  ariaLabel?: string;
  emptyText?: string;
}) {
  // ⚠️ 成績が無くても**ピラミッドは常に描く**（麻雀 LeaguePyramid と揃える）。
  // ここで early-return すると「シーズン開始直後は他種目だけピラミッドが出ない」ことになる。
  const isEmpty = standings.length === 0;
  const meId = standings.find((s) => s.isMe)?.lineUserId;
  const byTier: GameLeagueStanding[][] = [[], [], []];
  standings.forEach((s) => byTier[tierIndexOf(s.rank)].push(s));
  byTier.forEach((rows) => rows.sort((a, b) => a.rank - b.rank));

  return (
    <div className="space-y-5">
      {/* 3D ピラミッド（黒帯ヒーロー） */}
      <div
        className="rounded-[18px] overflow-hidden"
        style={{ background: "radial-gradient(120% 80% at 50% 12%, #202226, #17191b)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
      >
        <LeaguePyramid3D
          standings={standings}
          currentUserId={meId}
          height={280}
          tierKeys={tierKeys}
          label={ariaLabel}
        />
      </div>

      {/* 順位リスト（成績が無い間はプレースホルダ） */}
      {isEmpty ? (
        <div className="rounded-[14px] border border-[#eceff1] bg-white p-8 text-center text-sm text-[#231714]/70">
          {emptyText}
        </div>
      ) : (
      <div className="space-y-[18px]">
        {tierKeys.map((tier, i) => {
          const members = byTier[i];
          if (members.length === 0) return null;
          const col = cssColor(i);
          return (
            <div key={tier}>
              <div className="flex items-center gap-2 mx-0.5 mb-2">
                <span className="text-[13px] font-black tracking-wide" style={{ color: col }}>{tier}</span>
                <span className="text-[11px] text-[#3f4247]">{KICKER[i]} ・ {RANGE[i]}</span>
                <span className="flex-1 h-px bg-[#eceff1]" />
                <span className="text-[11px] text-[#3f4247]">{members.length}名</span>
              </div>

              <div className="flex flex-col gap-2">
                {members.map((s) => (
                  <button
                    key={s.lineUserId}
                    type="button"
                    onClick={() => onSelectPlayer?.(s.lineUserId)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-[14px] active:scale-[0.99] transition-transform"
                    style={
                      s.isMe
                        ? { background: `color-mix(in srgb, ${col} 8%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${col}` }
                        : { background: "#fff", boxShadow: "0 1px 2px rgba(28,31,33,.05), inset 0 0 0 1px #f1f3f4" }
                    }
                  >
                    <div className="w-[26px] text-center shrink-0">
                      <span
                        className="font-black tabular-nums"
                        style={{ fontSize: s.rank <= 3 ? 19 : 16, color: s.rank <= 3 ? col : "#3f4247", letterSpacing: "-.03em" }}
                      >
                        {s.rank}
                      </span>
                    </div>
                    <Avatar src={s.pictureUrl} name={s.displayName} size={36} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14.5px] font-bold text-[#1c1f21] truncate">
                        {s.displayName}
                        {s.isMe && <span className="ml-1.5 text-[10px] font-extrabold" style={{ color: col }}>YOU</span>}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#3f4247] tabular-nums">{s.subText}</div>
                    </div>
                    <Sparkline data={s.trend} color={col} />
                    <div className="text-right shrink-0 min-w-[58px]">
                      <div className="text-[16.5px] font-black text-[#1c1f21] tabular-nums leading-none">
                        {s.value.toLocaleString()}
                      </div>
                      <div className="text-[9.5px] font-bold text-[#3f4247] mt-0.5">{unit}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      )}

      <p className="text-[11px] text-[#3f4247] leading-relaxed px-1">{footnote}</p>
    </div>
  );
}

/** 累積値の推移スパークライン（開催日順）。データが無ければ何も描かない。 */
function Sparkline({ data, color, w = 52, h = 22 }: { data?: number[]; color: string; w?: number; h?: number }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (data.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={last[0]} cy={last[1]} r={2} fill={color} />
    </svg>
  );
}
