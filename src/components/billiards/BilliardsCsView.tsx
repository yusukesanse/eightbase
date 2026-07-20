"use client";

import { useEffect, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { BILLIARDS_ACCENT } from "@/components/billiards/billiardsShared";

/**
 * CS > ビリヤード（8ボール 1対1・GMなし完全自動進行）— 縦トーナメント表。
 * 各試合の対戦者いずれかが勝者を申告すると確定。端数は上位シードに不戦勝（bye）。
 * 準決勝敗者2名で3位決定戦。決勝ラウンド完了で 金/銀/銅 を確定。色は全ゲーム統一（緑）。
 */

interface PubPlayer { displayName: string; pictureUrl?: string; won: boolean | null; seed: boolean; isMe: boolean }
interface PubBye { displayName: string; pictureUrl?: string; seed: boolean; isMe: boolean }
interface PubMatch { matchId: string; label: string; status: "reporting" | "completed"; players: PubPlayer[] }
interface PubRound { type: string; label: string; matches: PubMatch[]; byes: PubBye[] }
interface PodiumName { displayName: string; pictureUrl?: string }
interface PubEvent {
  csEventId: string;
  name: string;
  eventDate: string;
  status: string;
  champion: PodiumName | null;
  runnerUp: PodiumName | null;
  third: PodiumName | null;
  entrants: { displayName: string; seed: boolean; isMe: boolean }[];
  rounds: PubRound[];
}

const MEDAL: Record<number, string> = { 1: "#d8a526", 2: "#b9c0c6", 3: "#c97b3c" };
const SUCCESS = "#8aab36";
const SUCCESS_INK = "#6f9023";
const LINE = "#d5dadd";
const CARD_W = 158;
const GAP = 12;

export function BilliardsCsView() {
  const [event, setEvent] = useState<PubEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputMatch, setInputMatch] = useState<PubMatch | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/billiards/cs", { credentials: "include" })
      .then((r) => r.json())
      .then((cs) => setEvent(cs.event ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 15000);

  const report = useCallback(
    async (csEventId: string, matchId: string, winnerIndex: 0 | 1) => {
      // 公開DTOに lineUserId は無いため、勝者は試合内の並び順 index で送り、サーバーが解決する。
      setBusy(true); setInputError(null);
      try {
        const res = await fetch("/api/billiards/cs/report", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ csEventId, matchId, winnerIndex }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setInputError(data?.error ?? "反映に失敗しました"); return; }
        setInputMatch(null);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  const toggleEntry = useCallback(
    async (join: boolean) => {
      setBusy(true); setEntryError(null);
      try {
        const res = await fetch("/api/billiards/cs/entry", { method: join ? "POST" : "DELETE", credentials: "include" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { setEntryError(data?.error ?? (join ? "エントリーに失敗しました" : "取消に失敗しました")); return; }
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  if (loading) {
    return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (!event) {
    return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/80">チャンピオンシップはまだ開催されていません</div>;
  }

  const roundsTopDown = [...event.rounds].reverse();

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl px-4 py-3 text-center" style={{ background: "radial-gradient(120% 90% at 50% 0%, #2b2f31, #16191b)" }}>
        <div className="text-[13px] font-black text-white tracking-[0.06em]">{event.name}</div>
        <div className="text-[11px] text-white/55 mt-0.5">{event.eventDate}</div>
      </div>

      <p className="text-[11px] text-[#231714]/85 leading-relaxed px-0.5">
        8ボール1対1のシングルエリミネーション。リーグ<b style={{ color: BILLIARDS_ACCENT }}>上位者はシード</b>（S・端数の回は不戦勝）。勝者が勝ち上がり、決勝で優勝（金/銀/銅）。
      </p>

      {event.status === "setup" && (
        <CsEntryPanel entered={event.entrants.some((e) => e.isMe)} count={event.entrants.length} busy={busy} error={entryError} onToggle={toggleEntry} />
      )}

      {event.status === "finished" && <Podium champion={event.champion} runnerUp={event.runnerUp} third={event.third} />}

      {event.rounds.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/80">トーナメント表はまだ公開されていません</div>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="flex flex-col items-center mx-auto" style={{ width: "max-content", minWidth: "100%" }}>
            <ChampCrown champ={event.champion} />
            <Stem />
            {roundsTopDown.map((round, i) => {
              const gold = round.type === "final";
              return (
                <div key={i} className="flex flex-col items-center">
                  <div className="flex items-baseline gap-1.5 mb-1.5">
                    <span className="text-[11.5px] font-black" style={{ color: gold ? MEDAL[1] : "#5f6266" }}>{round.label}</span>
                    <span className="text-[9.5px] text-[#3f4247]">{gold ? "金銀銅" : "勝ち抜き"}</span>
                  </div>
                  <div className="flex justify-center" style={{ gap: GAP }}>
                    {round.matches.map((m) => (
                      <div key={m.matchId} style={{ width: CARD_W }}>
                        <MatchCard match={m} gold={gold} onInput={() => setInputMatch(m)} />
                      </div>
                    ))}
                  </div>
                  {round.byes.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                      {round.byes.map((b, bi) => (
                        <span key={bi} className="inline-flex items-center gap-1 text-[9.5px] font-bold rounded-full px-2 py-0.5" style={{ color: BILLIARDS_ACCENT, background: `color-mix(in srgb, ${BILLIARDS_ACCENT} 10%, #fff)` }}>
                          不戦勝 {b.displayName}{b.isMe && "（あなた）"}
                        </span>
                      ))}
                    </div>
                  )}
                  {i < roundsTopDown.length - 1 && <Connector lowerCount={roundsTopDown[i + 1].matches.length} />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {inputMatch && (
        <CsInputSheet
          match={inputMatch}
          busy={busy}
          error={inputError}
          onClose={() => { setInputMatch(null); setInputError(null); }}
          onReport={(winnerIndex) => report(event.csEventId, inputMatch.matchId, winnerIndex)}
        />
      )}
    </div>
  );
}

function CsEntryPanel({ entered, count, busy, error, onToggle }: { entered: boolean; count: number; busy: boolean; error: string | null; onToggle: (join: boolean) => void }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-black text-[#231714]">チャンピオンシップに参加</div>
          <div className="text-[11px] text-[#231714]/85 mt-0.5">どなたでも参加できます（現在 {count} 名エントリー中）</div>
        </div>
        {entered && <span className="text-[10px] font-black px-2 py-1 rounded-full" style={{ color: SUCCESS_INK, background: `color-mix(in srgb, ${SUCCESS} 14%, #fff)` }}>参加中</span>}
      </div>
      {error && <div className="text-[11px] font-bold text-[#c0563c]">{error}</div>}
      {entered ? (
        <button onClick={() => onToggle(false)} disabled={busy} className="w-full py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl disabled:opacity-50" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}>エントリーを取り消す</button>
      ) : (
        <button onClick={() => onToggle(true)} disabled={busy} className="w-full py-3 text-sm font-black text-white rounded-2xl disabled:opacity-50" style={{ background: BILLIARDS_ACCENT }}>CSに参加する</button>
      )}
    </div>
  );
}

function Podium({ champion, runnerUp, third }: { champion: PodiumName | null; runnerUp: PodiumName | null; third: PodiumName | null }) {
  const slots: { medal: number; label: string; who: PodiumName | null }[] = [
    { medal: 2, label: "2位", who: runnerUp },
    { medal: 1, label: "優勝", who: champion },
    { medal: 3, label: "3位", who: third },
  ];
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
      <div className="text-[12px] font-black text-[#231714] text-center mb-3">表彰台</div>
      <div className="flex items-end justify-center gap-3">
        {slots.map(({ medal, label, who }) => (
          <div key={medal} className="flex flex-col items-center" style={{ opacity: who ? 1 : 0.35 }}>
            <div className="text-[13px] leading-none mb-1">{medal === 1 ? "🥇" : medal === 2 ? "🥈" : "🥉"}</div>
            <Avatar src={who?.pictureUrl} name={who?.displayName ?? "—"} size={medal === 1 ? 48 : 38} style={{ boxShadow: `0 0 0 3px ${MEDAL[medal]}` }} />
            <div className="text-[11px] font-black text-[#1c1f21] mt-1 max-w-[90px] truncate">{who?.displayName ?? "—"}</div>
            <div className="text-[9px] font-extrabold" style={{ color: MEDAL[medal] }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChampCrown({ champ }: { champ: PodiumName | null }) {
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
        <div className="mt-0.5 text-[10.5px] text-[#3f4247]">優勝者 未定</div>
      )}
    </div>
  );
}

function Stem() {
  return <div style={{ width: 2, height: 16, background: LINE }} />;
}

function Connector({ lowerCount }: { lowerCount: number }) {
  if (lowerCount <= 1) return <div style={{ width: 2, height: 20, background: LINE }} />;
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

function MatchCard({ match, gold, onInput }: { match: PubMatch; gold: boolean; onInput: () => void }) {
  const done = match.status === "completed";
  const iAmIn = match.players.some((p) => p.isMe);
  return (
    <div className="rounded-xl bg-white border border-gray-100 shadow-sm p-2" style={gold ? { borderLeft: `3px solid ${MEDAL[1]}` } : undefined}>
      <div className="flex items-center justify-between mb-1.5 px-0.5">
        <span className="text-[10.5px] font-bold text-[#40434a]">{match.label}</span>
        {done ? (
          <span className="text-[9px] font-black px-1 py-0.5 rounded" style={{ color: SUCCESS_INK, background: `color-mix(in srgb, ${SUCCESS} 14%, #fff)` }}>確定</span>
        ) : (
          <span className="text-[9px] font-bold text-[#c0563c]">結果待ち</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {match.players.map((p, i) => (
          <BracketSlot key={i} p={p} me={p.isMe} seed={p.seed} advanced={done && p.won === true} loser={done && p.won === false} />
        ))}
      </div>
      {!done && iAmIn && (
        <button onClick={onInput} className="mt-1.5 w-full py-1.5 rounded-lg text-[11px] font-extrabold text-white active:scale-[0.98] transition-transform" style={{ background: BILLIARDS_ACCENT }}>
          勝敗を申告
        </button>
      )}
    </div>
  );
}

function BracketSlot({ p, me, seed, advanced, loser }: { p: PubPlayer; me: boolean; seed: boolean; advanced: boolean; loser: boolean }) {
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg"
      style={advanced
        ? { background: `color-mix(in srgb, ${SUCCESS} 12%, #fff)`, boxShadow: `inset 0 0 0 1.5px ${SUCCESS}` }
        : me ? { background: "#eef4f5", boxShadow: "inset 0 0 0 1px #dde9eb" } : { background: "#f6f8f9", boxShadow: "inset 0 0 0 1px #f1f3f4" }}
    >
      <span className="flex-1 min-w-0 text-[11px] font-bold text-[#1c1f21] truncate" style={loser ? { opacity: 0.5 } : undefined}>
        {p.displayName}
        {me && <span className="ml-0.5 text-[9px] font-extrabold text-[#3c4f54]">(あなた)</span>}
      </span>
      {seed && <span className="text-[8px] font-black px-1 py-0.5 rounded shrink-0" style={{ color: BILLIARDS_ACCENT, background: `color-mix(in srgb, ${BILLIARDS_ACCENT} 12%, #fff)` }}>S</span>}
      {advanced ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={SUCCESS_INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      ) : (
        <span className="text-[9px] text-[#3f4247] shrink-0">{loser ? "敗" : "—"}</span>
      )}
    </div>
  );
}

/** 勝者選択シート（1対1）。自分が参加する試合で、勝ったのはどちらかを選ぶ。 */
function CsInputSheet({ match, busy, error, onClose, onReport }: { match: PubMatch; busy: boolean; error: string | null; onClose: () => void; onReport: (winnerIndex: 0 | 1) => void }) {
  const [pick, setPick] = useState<0 | 1 | null>(null);
  return (
    <BottomSheet open title={`${match.label} の結果`} onClose={onClose}>
      <p className="text-[11px] text-[#231714]/85 mb-3">勝った方を選んで申告してください（対戦者どちらでも申告できます）。確定後は変更できません。</p>

      <div className="flex flex-col gap-2">
        {match.players.map((p, i) => {
          const selected = pick === i;
          return (
            <button
              key={i}
              onClick={() => setPick(i as 0 | 1)}
              className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
              style={selected
                ? { background: `color-mix(in srgb, ${BILLIARDS_ACCENT} 10%, #fff)`, boxShadow: `inset 0 0 0 2px ${BILLIARDS_ACCENT}` }
                : { background: "#f6f8f9", boxShadow: "inset 0 0 0 1px #eceff1" }}
            >
              <Avatar src={p.pictureUrl} name={p.displayName} size={34} />
              <span className="flex-1 text-[13.5px] font-bold text-[#1c1f21] truncate">
                {p.displayName}{p.isMe && <span className="ml-1 text-[10px] font-extrabold text-[#3c4f54]">(あなた)</span>}
              </span>
              {selected && <span className="text-[11px] font-black" style={{ color: BILLIARDS_ACCENT }}>勝者</span>}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

      <div className="mt-6 flex gap-2">
        <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}>キャンセル</button>
        <button onClick={() => pick != null && onReport(pick)} disabled={pick == null || busy} className="flex-1 py-3 text-sm font-extrabold text-white rounded-2xl active:scale-[0.98] disabled:opacity-50" style={{ background: BILLIARDS_ACCENT }}>
          {busy ? "送信中..." : "勝者を申告"}
        </button>
      </div>
    </BottomSheet>
  );
}
