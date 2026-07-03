"use client";

import { useEffect, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";
import { isDevLoginEnabled } from "@/lib/env";
import type { MahjongCsEvent, MahjongCsMatch, MahjongCsMatchPlayer } from "@/types";

/**
 * CS > 麻雀（TILES 案）
 * - 王者の表彰台（金銀銅・王冠）：決勝卓の確定結果から上位3名
 * - トーナメント ブラケット：予選→準決→決勝→優勝 を列で横スクロール表示。
 *   勝ち上がりを緑で強調。デモ時のみ各卓に「結果入力」（ボトムシート）を出す。
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
  const [inputMatch, setInputMatch] = useState<MahjongCsMatch | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return Promise.all([
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

  useEffect(() => {
    load();
  }, [load]);

  // デモ検証（非本番＋demoDummyイベント）: demoユーザーが勝敗を入力してCSを進められる。
  const demo = isDevLoginEnabled() && !!(event as { demoDummy?: boolean } | null)?.demoDummy;

  const reportMatch = useCallback(
    async (csEventId: string, matchId: string, meRank?: number) => {
      setBusy(true);
      try {
        await fetch("/api/mahjong/cs/match", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ csEventId, matchId, meRank }),
        });
        setInputMatch(null);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

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

  const seedSet = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));

  // 表彰台：決勝卓の確定結果から上位3名
  const finalRound =
    event.rounds.find((r) => r.label.includes("決勝")) ?? event.rounds[event.rounds.length - 1];
  const finalMatch = finalRound?.matches.find((m) => m.status === "completed");
  const podium = finalMatch
    ? [...finalMatch.players]
        .filter((p) => p.rank != null)
        .sort((a, b) => a.rank! - b.rank!)
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
          <div className="relative text-center text-white/60 text-[12px] pb-5">勝ち上がると王者が表示されます</div>
        )}
      </div>

      {/* ── トーナメント ブラケット ── */}
      <div>
        <div className="flex items-baseline justify-between px-0.5 mb-2">
          <p className="text-[12px] font-black text-[#1c1f21]">トーナメント表</p>
          <span className="text-[10.5px] text-[#97999d]">← 横にスクロール →</span>
        </div>
        <p className="text-[11px] text-[#231714]/50 leading-relaxed px-0.5 mb-3">
          M1リーグ所属者は<b style={{ color: M1 }}>準決勝シード</b>。各卓の上位が次へ勝ち上がり、決勝1位が優勝。
        </p>

        {event.rounds.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
            トーナメント表はまだ公開されていません
          </div>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4 pb-2">
            <div className="flex gap-2.5 items-stretch" style={{ width: "max-content" }}>
              {event.rounds.map((round, ri) => {
                const gold = round.label.includes("決勝") && round.type === "final";
                return (
                  <div key={ri} className="shrink-0 w-[172px] flex flex-col">
                    <div className="flex items-baseline gap-1.5 mb-2 px-0.5">
                      <span className="text-[12px] font-black" style={{ color: gold ? MEDAL[1] : "#1c1f21" }}>{round.label}</span>
                      <span className="text-[10px] text-[#97999d]">上位{round.advanceCount}</span>
                    </div>
                    <div className="flex flex-col gap-2 flex-1">
                      {round.matches.map((m) => (
                        <MatchCard
                          key={m.matchId}
                          match={m}
                          advanceCount={round.advanceCount}
                          gold={gold}
                          currentUserId={currentUserId}
                          seedSet={seedSet}
                          demo={demo}
                          onInput={() => setInputMatch(m)}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* 優勝カラム */}
              <div className="shrink-0 w-[132px] flex flex-col">
                <div className="text-[12px] font-black mb-2 px-0.5" style={{ color: MEDAL[1] }}>優勝</div>
                <div
                  className="flex-1 rounded-xl flex flex-col items-center justify-center gap-2 p-3 text-center"
                  style={{ background: champ ? "radial-gradient(120% 90% at 50% 0%, #2b2f31, #16191b)" : "#f6f8f9", boxShadow: champ ? undefined : "inset 0 0 0 1px #eceff1" }}
                >
                  {champ ? (
                    <>
                      <div className="relative">
                        <Avatar src={champ.pictureUrl} name={champ.displayName} size={48} style={{ boxShadow: `0 0 0 3px ${MEDAL[1]}` }} />
                        <div className="absolute left-1/2 -translate-x-1/2 text-[16px]" style={{ top: -13 }}>👑</div>
                      </div>
                      <div className="text-[12px] font-black text-white">{champ.displayName}</div>
                    </>
                  ) : (
                    <>
                      <div className="text-[26px] opacity-30">🏆</div>
                      <div className="text-[11px] text-[#97999d]">未定</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── デモ: 結果入力シート ── */}
      {inputMatch && event && (
        <CsInputSheet
          match={inputMatch}
          meId={currentUserId}
          busy={busy}
          onClose={() => setInputMatch(null)}
          onReport={(meRank) => reportMatch(event.csEventId, inputMatch.matchId, meRank)}
        />
      )}
    </div>
  );
}

/** ブラケット内の1試合カード。 */
function MatchCard({
  match,
  advanceCount,
  gold,
  currentUserId,
  seedSet,
  demo,
  onInput,
}: {
  match: MahjongCsMatch;
  advanceCount: number;
  gold: boolean;
  currentUserId?: string;
  seedSet: Set<string>;
  demo: boolean;
  onInput: () => void;
}) {
  const done = match.status === "completed";
  return (
    <div
      className="rounded-xl bg-white border border-gray-100 shadow-sm p-2"
      style={gold ? { borderLeft: `3px solid ${MEDAL[1]}` } : undefined}
    >
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[10.5px] font-bold text-[#40434a]">{match.label}</span>
        {done ? (
          <span className="text-[9px] font-black px-1 py-0.5 rounded" style={{ color: SUCCESS_INK, background: `color-mix(in srgb, ${SUCCESS} 14%, #fff)` }}>確定</span>
        ) : (
          <span className="text-[9px] font-bold text-[#c0563c]">結果待ち</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {[...match.players]
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
          .map((p) => (
            <BracketSlot
              key={p.lineUserId}
              p={p}
              me={p.lineUserId === currentUserId}
              seed={seedSet.has(p.lineUserId)}
              advanced={done && p.rank != null && p.rank <= advanceCount}
              pending={!done}
            />
          ))}
      </div>
      {demo && !done && (
        <button
          onClick={onInput}
          className="mt-1.5 w-full py-1.5 rounded-lg text-[11px] font-extrabold text-white active:scale-[0.98] transition-transform"
          style={{ background: "#2f7d57" }}
        >
          結果入力
        </button>
      )}
    </div>
  );
}

function BracketSlot({
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
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg"
      style={
        advanced
          ? { background: `color-mix(in srgb, ${SUCCESS} 12%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${SUCCESS}` }
          : me
            ? { background: "#eef4f5", boxShadow: "inset 0 0 0 1px #dde9eb" }
            : { background: "#f6f8f9", boxShadow: "inset 0 0 0 1px #f1f3f4" }
      }
    >
      <span className="flex-1 min-w-0 text-[11px] font-bold text-[#1c1f21] truncate">
        {p.displayName}
        {me && <span className="ml-0.5 text-[9px] font-extrabold text-[#5f7a80]">(あなた)</span>}
      </span>
      {seed && (
        <span className="text-[8px] font-black px-1 py-0.5 rounded shrink-0" style={{ color: M1, background: `color-mix(in srgb, ${M1} 12%, #fff)` }}>
          S
        </span>
      )}
      {advanced ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={SUCCESS_INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : pending ? (
        <span className="text-[9px] text-[#97999d] shrink-0">—</span>
      ) : (
        <span className="text-[9px] text-[#97999d] tabular-nums shrink-0">{p.rank != null ? `${p.rank}着` : "—"}</span>
      )}
    </div>
  );
}

/** デモ用: 選んだ試合の結果を入力（同卓は自分の着順、居ない試合は自動補完）。 */
function CsInputSheet({
  match,
  meId,
  busy,
  onClose,
  onReport,
}: {
  match: MahjongCsMatch;
  meId?: string;
  busy: boolean;
  onClose: () => void;
  onReport: (meRank?: number) => void;
}) {
  const n = match.players.length;
  const iAmIn = !!meId && match.players.some((p) => p.lineUserId === meId);
  return (
    <BottomSheet open title={`${match.label} の結果（デモ）`} onClose={onClose}>
      <div className="flex flex-col gap-1.5 mb-4">
        {match.players.map((p) => (
          <div key={p.lineUserId} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f6f8f9]">
            <Avatar src={p.pictureUrl} name={p.displayName} size={28} />
            <span className="text-[13px] font-bold text-[#1c1f21]">
              {p.displayName}
              {p.lineUserId === meId && <span className="ml-1 text-[10px] font-extrabold text-[#5f7a80]">あなた</span>}
            </span>
          </div>
        ))}
      </div>

      {iAmIn ? (
        <>
          <div className="text-[11px] font-extrabold text-[#97999d] mb-2">あなたの順位を選ぶ</div>
          <div className="flex gap-2">
            {Array.from({ length: n }, (_, i) => i + 1).map((r) => (
              <button
                key={r}
                disabled={busy}
                onClick={() => onReport(r)}
                className="flex-1 py-3 rounded-xl text-[15px] font-black transition-all disabled:opacity-50"
                style={
                  r === 1
                    ? { background: "#2f7d57", color: "#fff", boxShadow: "0 3px 10px color-mix(in srgb, #2f7d57 40%, transparent)" }
                    : { background: "#f6f8f9", color: "#40434a", boxShadow: "inset 0 0 0 1px #e4e7e9" }
                }
              >
                {r}<span className="text-[10px]">着</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#97999d] mt-2.5">1着＝勝ち上がり。上位者が次へ進み、3着以下だと敗退（次へ進めません）。</p>
        </>
      ) : (
        <button
          disabled={busy}
          onClick={() => onReport()}
          className="w-full py-3 rounded-xl text-[14px] font-extrabold text-white disabled:opacity-50"
          style={{ background: "#2f7d57" }}
        >
          {busy ? "反映中..." : "この卓の結果を自動で入れる"}
        </button>
      )}
    </BottomSheet>
  );
}
