"use client";

import { useEffect, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";
import { isDevLoginEnabled } from "@/lib/env";
import type { MahjongCsEvent, MahjongCsMatch, MahjongCsMatchPlayer } from "@/types";

/**
 * CS > 麻雀（TILES 案）— 縦トーナメント表
 * - 最上部に王冠（優勝者 / 未定）、下へ 決勝→準決→予選 と枝分かれする木構造で表示。
 * - 勝ち上がりは緑で強調、M1シードは S バッジ。
 * - デモ時のみ各卓に「結果入力」。自分の卓は着順、他卓は勝者タップ（手動）。
 */

const MEDAL: Record<number, string> = { 1: "#d8a526", 2: "#b9c0c6", 3: "#c97b3c" };
const SUCCESS = "#8aab36";
const SUCCESS_INK = "#6f9023";
const M1 = "#a2125a";
const LINE = "#d5dadd";
const CARD_W = 158;
const GAP = 12;

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

  const demo = isDevLoginEnabled() && !!(event as { demoDummy?: boolean } | null)?.demoDummy;

  const reportMatch = useCallback(
    async (csEventId: string, matchId: string, body: { meRank?: number; winnerId?: string }) => {
      setBusy(true);
      try {
        await fetch("/api/mahjong/cs/match", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ csEventId, matchId, ...body }),
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
  const champ = event.championId ? event.entrants.find((e) => e.lineUserId === event.championId) : null;
  // 木は上から 決勝→準決→予選。rounds は予選→決勝の順なので反転。
  const roundsTopDown = [...event.rounds].reverse();

  return (
    <div className="flex flex-col gap-4">
      {/* イベントヘッダー */}
      <div className="rounded-2xl px-4 py-3 text-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #2b2f31, #16191b)" }}>
        <div className="text-[13px] font-black text-white tracking-[0.06em]">{event.name}</div>
        <div className="text-[11px] text-white/55 mt-0.5">{event.eventDate}</div>
      </div>

      <p className="text-[11px] text-[#231714]/50 leading-relaxed px-0.5">
        M1リーグ所属者は<b style={{ color: M1 }}>準決勝シード</b>（S）。各卓の上位が勝ち上がり、決勝1位が優勝。
      </p>

      {event.rounds.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
          トーナメント表はまだ公開されていません
        </div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="flex flex-col items-center mx-auto" style={{ width: "max-content", minWidth: "100%" }}>
            {/* 王冠（優勝者） */}
            <ChampCrown champ={champ} />
            <Stem />

            {roundsTopDown.map((round, i) => {
              const gold = round.type === "final";
              return (
                <div key={i} className="flex flex-col items-center">
                  <div className="flex items-baseline gap-1.5 mb-1.5">
                    <span className="text-[11.5px] font-black" style={{ color: gold ? MEDAL[1] : "#5f6266" }}>{round.label}</span>
                    <span className="text-[9.5px] text-[#97999d]">上位{round.advanceCount}通過</span>
                  </div>
                  <div className="flex justify-center" style={{ gap: GAP }}>
                    {round.matches.map((m) => (
                      <div key={m.matchId} style={{ width: CARD_W }}>
                        <MatchCard
                          match={m}
                          advanceCount={round.advanceCount}
                          gold={gold}
                          currentUserId={currentUserId}
                          seedSet={seedSet}
                          demo={demo}
                          onInput={() => setInputMatch(m)}
                        />
                      </div>
                    ))}
                  </div>
                  {/* 次ラウンド（下）への接続線 */}
                  {i < roundsTopDown.length - 1 && (
                    <Connector lowerCount={roundsTopDown[i + 1].matches.length} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {inputMatch && event && (
        <CsInputSheet
          match={inputMatch}
          meId={currentUserId}
          advanceCount={roundsTopDown.flatMap((r) => r.matches.map((m) => ({ id: m.matchId, a: r.advanceCount }))).find((x) => x.id === inputMatch.matchId)?.a ?? 1}
          busy={busy}
          onClose={() => setInputMatch(null)}
          onReport={(body) => reportMatch(event.csEventId, inputMatch.matchId, body)}
        />
      )}
    </div>
  );
}

/** 木の頂点：王冠＋優勝者（未定なら🏆）。 */
function ChampCrown({ champ }: { champ?: { displayName: string; pictureUrl?: string } | null }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[22px] leading-none">👑</div>
      {champ ? (
        <div className="mt-1 flex flex-col items-center rounded-2xl px-3 py-2" style={{ background: "radial-gradient(120% 90% at 50% 0%, #2b2f31, #16191b)" }}>
          <Avatar src={champ.pictureUrl} name={champ.displayName} size={40} style={{ boxShadow: `0 0 0 3px ${MEDAL[1]}` }} />
          <div className="text-[12px] font-black text-white mt-1">{champ.displayName}</div>
          <div className="text-[9px] font-extrabold tracking-wide" style={{ color: MEDAL[1] }}>WINNER</div>
        </div>
      ) : (
        <div className="mt-0.5 text-[10.5px] text-[#97999d]">優勝者 未定</div>
      )}
    </div>
  );
}

/** 縦の線（1本）。 */
function Stem() {
  return <div style={{ width: 2, height: 16, background: LINE }} />;
}

/** ラウンド間の接続線：上の1本 → 横バー → 下の各卓へ分岐。 */
function Connector({ lowerCount }: { lowerCount: number }) {
  if (lowerCount <= 1) {
    return <div style={{ width: 2, height: 20, background: LINE }} />;
  }
  const barW = (lowerCount - 1) * (CARD_W + GAP);
  return (
    <div className="flex flex-col items-center">
      <div style={{ width: 2, height: 10, background: LINE }} />
      <div style={{ width: barW, height: 2, background: LINE }} />
      <div className="flex justify-center" style={{ gap: GAP }}>
        {Array.from({ length: lowerCount }).map((_, i) => (
          <div key={i} className="flex justify-center" style={{ width: CARD_W }}>
            <div style={{ width: 2, height: 10, background: LINE }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 1試合カード。 */
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

/** デモ用: 選んだ試合の結果を手動入力。自分の卓は着順、他卓は勝者タップ。 */
function CsInputSheet({
  match,
  meId,
  advanceCount,
  busy,
  onClose,
  onReport,
}: {
  match: MahjongCsMatch;
  meId?: string;
  advanceCount: number;
  busy: boolean;
  onClose: () => void;
  onReport: (body: { meRank?: number; winnerId?: string }) => void;
}) {
  const n = match.players.length;
  const iAmIn = !!meId && match.players.some((p) => p.lineUserId === meId);
  return (
    <BottomSheet open title={`${match.label} の結果（デモ）`} onClose={onClose}>
      {iAmIn ? (
        <>
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
          <div className="text-[11px] font-extrabold text-[#97999d] mb-2">あなたの順位を選ぶ</div>
          <div className="flex gap-2">
            {Array.from({ length: n }, (_, i) => i + 1).map((r) => (
              <button
                key={r}
                disabled={busy}
                onClick={() => onReport({ meRank: r })}
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
          <p className="text-[11px] text-[#97999d] mt-2.5">
            上位{advanceCount}名が次へ勝ち上がります。{advanceCount + 1}着以下だと敗退（次へ進めません）。
          </p>
        </>
      ) : (
        <>
          <div className="text-[11px] font-extrabold text-[#97999d] mb-2">勝者（1着）を選ぶ</div>
          <div className="flex flex-col gap-1.5">
            {match.players.map((p) => (
              <button
                key={p.lineUserId}
                disabled={busy}
                onClick={() => onReport({ winnerId: p.lineUserId })}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-left active:scale-[0.99] transition-transform disabled:opacity-50"
                style={{ background: "#f6f8f9", boxShadow: "inset 0 0 0 1px #e4e7e9" }}
              >
                <Avatar src={p.pictureUrl} name={p.displayName} size={30} />
                <span className="flex-1 text-[13px] font-bold text-[#1c1f21]">{p.displayName}</span>
                <span className="text-[10px] font-extrabold text-[#2f7d57]">この人を1着に →</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-[#97999d] mt-2.5">選んだ人が1着、残りは並び順で順位付けされ、上位{advanceCount}名が勝ち上がります。</p>
        </>
      )}
    </BottomSheet>
  );
}
