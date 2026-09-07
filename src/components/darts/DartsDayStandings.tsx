"use client";

import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";
import type { DartsEventKind } from "@/types/darts";

/**
 * ダーツ 当日成績（その開催日だけの総合順位＋3種目内訳）。通算（リーグタブ）とは別物。
 * データは GET /api/darts/standings/day の公開DTO（isMe のみ）。参加タブで過去の開催日を選ぶと表示。
 */

interface DayEvent { kind: DartsEventKind; value: number | null; rank: number | null; points: number; teamId?: string }
export interface DartsDayStanding {
  dayRank: number;
  displayName: string;
  pictureUrl?: string;
  totalPt: number;
  firstCount: number;
  isMe: boolean;
  events: DayEvent[];
}

const SHORT: Record<DartsEventKind, string> = { zeroOne: "01", countUp: "CU", cricket: "CR" };
const ORDER: DartsEventKind[] = ["zeroOne", "countUp", "cricket"];

export function DartsDayStandings({ eventDate, standings }: { eventDate: string; standings: DartsDayStanding[] }) {
  return (
    <GlassCard padding="md">
      <div className="flex items-baseline justify-between">
        <div className="text-[15px] font-bold text-[color:var(--eb-ink)]">この日の成績</div>
        <div className="text-[12px] text-[color:var(--eb-ink-muted)] tabular-nums">{eventDate}</div>
      </div>
      <p className="text-[12px] text-[color:var(--eb-ink-muted)] mt-0.5 mb-2.5">
        ※ この開催日の成績のみ（通算はリーグタブ）。01=ゼロワン / CU=カウントアップ / CR=クリケット
      </p>
      <div className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <div
            key={s.dayRank + s.displayName}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
            style={
              s.isMe
                ? { background: "rgba(35,147,94,.08)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
                : undefined
            }
          >
            <span
              className="w-6 text-center text-[17px] font-bold tabular-nums shrink-0"
              style={{ color: "rgba(26,29,27,.6)" }}
            >
              {s.dayRank}
            </span>
            <Avatar src={s.pictureUrl} name={s.displayName} size={32} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 text-[15px] font-bold text-[color:var(--eb-ink)] truncate">
                {s.displayName}
                {s.isMe && <StatusPill tone="green">YOU</StatusPill>}
              </div>
              {/* 3種目内訳（種目短縮 + 着順） */}
              <div className="flex gap-1.5 mt-1 flex-wrap">
                {ORDER.map((kind) => {
                  const e = s.events.find((x) => x.kind === kind);
                  const rank = e?.rank ?? null;
                  return (
                    <span
                      key={kind}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums"
                      style={{
                        background: "var(--eb-tint)",
                        color: rank === 1 ? "var(--eb-green-text)" : "var(--eb-ink-muted)",
                      }}
                    >
                      <span style={{ color: "var(--eb-ink-muted)" }}>{SHORT[kind]}</span>
                      {rank != null ? `${rank}位` : "—"}
                      <span style={{ color: "var(--eb-ink-muted)" }}>{e ? `${e.points}pt` : ""}</span>
                    </span>
                  );
                })}
              </div>
            </div>
            <div className="text-right shrink-0 min-w-[46px]">
              <div className="text-[15px] font-bold text-[color:var(--eb-ink)] tabular-nums leading-none">{s.totalPt}</div>
              <div className="text-[10px] font-bold text-[color:var(--eb-ink-muted)] mt-0.5">pt</div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
