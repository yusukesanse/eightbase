"use client";

import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import type { MahjongCsEvent, MahjongCsMatchPlayer } from "@/types";

/**
 * CS > 麻雀（TILES 案）
 * - 王者の表彰台（金銀銅・王冠）：決勝卓の確定結果から上位3名を表示
 * - 今季トーナメント表（予選→準決→決勝、M1はシード／勝ち上がりを強調）
 */

const MEDAL: Record<number, string> = { 1: "#d8a526", 2: "#b9c0c6", 3: "#c97b3c" };
const SUCCESS = "#8aab36";
const SUCCESS_INK = "#6f9023";
const M1 = "#a2125a";

function fmtPts(p: number | null): string {
  return p == null ? "—" : p.toLocaleString();
}

export function MahjongCsView() {
  const [event, setEvent] = useState<MahjongCsEvent | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/mahjong/cs", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/mahjong/standings", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([cs, st]) => {
        setEvent(cs.event ?? null);
        setCurrentUserId(st.currentUserId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!event) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        チャンピオンシップはまだ開催されていません
      </div>
    );
  }

  // シード（M1）判定セット
  const seedSet = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));

  // 表彰台：決勝卓の確定結果から上位3名
  const finalRound =
    event.rounds.find((r) => r.label.includes("決勝")) ?? event.rounds[event.rounds.length - 1];
  const finalMatch = finalRound?.matches.find((m) => m.status === "completed");
  const podium = finalMatch
    ? [...finalMatch.players]
        .filter((p) => p.rank != null)
        .sort((a, b) => (a.rank! - b.rank!))
        .slice(0, 3)
        .map((p) => ({ place: p.rank!, name: p.displayName, pictureUrl: p.pictureUrl, points: p.points }))
    : [];
  const champ = event.championId ? event.entrants.find((e) => e.lineUserId === event.championId) : null;

  return (
    <div className="flex flex-col gap-[18px]">
      {/* ── 王者・表彰台 ── */}
      <div
        className="rounded-[22px] px-[18px] pt-5 relative overflow-hidden"
        style={{ background: "radial-gradient(120% 80% at 50% 0%, #2b2f31, #16191b)" }}
      >
        <div className="absolute inset-0 pointer-events-none" style={{ background: "radial-gradient(60% 40% at 50% 6%, rgba(216,165,38,.28), transparent 70%)" }} />
        <div className="relative text-center mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d8a526" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="mx-auto">
            <path d="M6 4h12v3a6 6 0 01-12 0V4z" />
            <path d="M6 5H3v2a3 3 0 003 3M18 5h3v2a3 3 0 01-3 3M9 16h6M8 20h8M12 16v4" />
          </svg>
          <div className="text-[13px] font-black text-white tracking-[0.06em] mt-1">{event.name}</div>
          <div className="text-[11px] text-white/60 mt-0.5">{event.eventDate}</div>
        </div>

        {podium.length > 0 ? (
          <div className="relative flex items-end justify-center gap-3 pb-0">
            {[podium.find((p) => p.place === 2), podium.find((p) => p.place === 1), podium.find((p) => p.place === 3)]
              .filter((p): p is NonNullable<typeof p> => !!p)
              .map((p) => {
                const h = p.place === 1 ? 92 : p.place === 2 ? 66 : 52;
                const col = MEDAL[p.place];
                return (
                  <div key={p.place} className="flex flex-col items-center flex-1 max-w-[100px]">
                    <div className="relative">
                      <Avatar src={p.pictureUrl} name={p.name} size={p.place === 1 ? 58 : 46} style={{ boxShadow: `0 0 0 3px ${col}` }} />
                      {p.place === 1 && <div className="absolute left-1/2 -translate-x-1/2 text-[18px]" style={{ top: -16 }}>👑</div>}
                    </div>
                    <div className="text-[12.5px] font-extrabold text-white mt-1.5 text-center whitespace-nowrap">{p.name}</div>
                    <div className="text-[11px] font-extrabold tabular-nums" style={{ color: col }}>{fmtPts(p.points)}</div>
                    <div
                      className="w-full mt-1.5 flex items-start justify-center pt-2"
                      style={{ height: h, borderRadius: "8px 8px 0 0", background: `linear-gradient(180deg, ${col}, color-mix(in srgb, ${col} 55%, #16191b))`, boxShadow: "inset 0 2px 0 rgba(255,255,255,.3)" }}
                    >
                      <span className="font-black text-white/90" style={{ fontSize: p.place === 1 ? 22 : 17 }}>{p.place}</span>
                    </div>
                  </div>
                );
              })}
          </div>
        ) : champ ? (
          <div className="relative flex flex-col items-center pb-5">
            <div className="relative">
              <Avatar src={champ.pictureUrl} name={champ.displayName} size={64} style={{ boxShadow: `0 0 0 3px ${MEDAL[1]}` }} />
              <div className="absolute left-1/2 -translate-x-1/2 text-[20px]" style={{ top: -18 }}>👑</div>
            </div>
            <div className="text-[15px] font-black text-white mt-2">{champ.displayName}</div>
            <div className="text-[11px] font-extrabold" style={{ color: MEDAL[1] }}>WINNER</div>
          </div>
        ) : (
          <div className="relative text-center text-white/60 text-[12px] pb-5">結果が確定するとここに王者が表示されます</div>
        )}
      </div>

      {/* ── トーナメント表 ── */}
      <div>
        <p className="text-[11.5px] text-[#231714]/60 leading-relaxed px-0.5 mb-3">
          {event.eventDate} 開催。M1リーグ所属者は<b style={{ color: M1 }}>準決勝シード</b>。予選は各卓上位通過、勝ち上がりで決勝へ。
        </p>

        {event.rounds.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
            トーナメント表はまだ公開されていません
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {event.rounds.map((round, ri) => {
              const gold = round.label.includes("決勝");
              return (
                <div
                  key={ri}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5"
                  style={gold ? { borderLeft: `4px solid ${MEDAL[1]}` } : undefined}
                >
                  <div className="flex items-baseline gap-2 mb-2.5">
                    <span className="text-[12.5px] font-black" style={{ color: gold ? MEDAL[1] : "#1c1f21" }}>{round.label}</span>
                    <span className="text-[10.5px] text-[#97999d]">各卓 上位{round.advanceCount}名通過</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {round.matches.map((m) => (
                      <div key={m.matchId}>
                        <div className="text-[11px] font-bold text-[#40434a] mb-1.5">{m.label}</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {[...m.players]
                            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                            .map((p) => (
                              <Slot
                                key={p.lineUserId}
                                p={p}
                                me={p.lineUserId === currentUserId}
                                seed={seedSet.has(p.lineUserId)}
                                advanced={m.status === "completed" && p.rank != null && p.rank <= round.advanceCount}
                                pending={m.status !== "completed"}
                              />
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Slot({
  p,
  me,
  seed,
  advanced,
  pending,
}: {
  p: MahjongCsMatchPlayer;
  me: boolean;
  seed: boolean;
  advanced: boolean;
  pending: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-2 rounded-[10px]"
      style={
        advanced
          ? { background: `color-mix(in srgb, ${SUCCESS} 12%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${SUCCESS}` }
          : me
            ? { background: "#eef4f5", boxShadow: "inset 0 0 0 1px #dde9eb" }
            : { background: "#f6f8f9", boxShadow: "inset 0 0 0 1px #f1f3f4" }
      }
    >
      <span className="flex-1 min-w-0 text-[12.5px] font-bold text-[#1c1f21] truncate">
        {p.displayName}
        {me && <span className="ml-1 text-[10px] font-extrabold text-[#5f7a80]">あなた</span>}
      </span>
      {seed && (
        <span className="text-[9px] font-black px-1 py-0.5 rounded" style={{ color: M1, background: `color-mix(in srgb, ${M1} 12%, #fff)` }}>
          SEED
        </span>
      )}
      {advanced ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={SUCCESS_INK} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : pending ? (
        <span className="text-[10px] text-[#97999d]">—</span>
      ) : (
        <span className="text-[10px] text-[#97999d] tabular-nums">{p.rank != null ? `${p.rank}着` : "—"}</span>
      )}
    </div>
  );
}
