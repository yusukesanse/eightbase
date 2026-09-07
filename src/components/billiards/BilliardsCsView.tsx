"use client";

import { useEffect, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";

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
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 rounded-full animate-spin border-2 border-t-transparent" style={{ borderColor: "rgba(35,147,94,.3)", borderTopColor: "transparent" }} />
      </div>
    );
  }
  if (!event) {
    return (
      <GlassCard className="text-center py-10">
        <p className="text-[15px] text-[color:var(--eb-ink-muted)]">チャンピオンシップはまだ開催されていません</p>
      </GlassCard>
    );
  }

  const roundsTopDown = [...event.rounds].reverse();

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="text-center">
        <div className="text-[20px] font-bold text-[color:var(--eb-ink)]">{event.name}</div>
        <div className="text-[14px] text-[color:var(--eb-ink-muted)] mt-0.5">{event.eventDate}</div>
        <p className="text-[14px] text-[color:var(--eb-ink-muted)] leading-relaxed mt-3">
          8ボール1対1のシングルエリミネーション。リーグ<b className="text-[color:var(--eb-ink)]">上位者はシード</b>（S・端数の回は不戦勝）。勝者が勝ち上がり、決勝で優勝（金/銀/銅）。
        </p>
      </GlassCard>

      {event.status === "setup" && (
        <CsEntryPanel entered={event.entrants.some((e) => e.isMe)} count={event.entrants.length} busy={busy} error={entryError} onToggle={toggleEntry} />
      )}

      {event.status === "finished" && <Podium champion={event.champion} runnerUp={event.runnerUp} third={event.third} />}

      {event.rounds.length === 0 ? (
        <GlassCard className="text-center py-10">
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">トーナメント表はまだ公開されていません</p>
        </GlassCard>
      ) : (
        <div className="overflow-x-auto -mx-4 px-4 pb-1">
          <div className="flex flex-col items-center mx-auto" style={{ width: "max-content", minWidth: "100%" }}>
            <ChampCrown champ={event.champion} />
            <Stem />
            {roundsTopDown.map((round, i) => {
              const gold = round.type === "final";
              return (
                <div key={i} className="flex flex-col items-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="whitespace-nowrap text-[17px] font-bold" style={{ color: gold ? "var(--eb-gold-text)" : "var(--eb-ink)" }}>{round.label}</span>
                    <StatusPill tone="muted">{gold ? "金銀銅" : "勝ち抜き"}</StatusPill>
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
                        <span
                          key={bi}
                          className="inline-block max-w-[160px] truncate whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{ color: "var(--eb-green-text)", background: "rgba(35,147,94,.10)" }}
                        >
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

/** CS 自己エントリーパネル（受付中のみ表示）。参加/取消と現在の参加者数。 */
function CsEntryPanel({ entered, count, busy, error, onToggle }: { entered: boolean; count: number; busy: boolean; error: string | null; onToggle: (join: boolean) => void }) {
  return (
    <GlassCard className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[18px] font-bold text-[color:var(--eb-ink)]">チャンピオンシップに参加</div>
          <div className="text-[15px] text-[color:var(--eb-ink-muted)] mt-0.5">どなたでも参加できます（現在 {count} 名エントリー中）</div>
        </div>
        {entered && <StatusPill tone="green" className="shrink-0">参加中</StatusPill>}
      </div>
      {error && <div className="text-[13px] font-bold text-[color:var(--eb-coral-text)]">{error}</div>}
      {entered ? (
        <Button variant="secondary" onClick={() => onToggle(false)} disabled={busy}>
          エントリーを取り消す
        </Button>
      ) : (
        <Button variant="primary" onClick={() => onToggle(true)} disabled={busy}>
          CSに参加する
        </Button>
      )}
    </GlassCard>
  );
}

/** 表彰台（決勝ラウンド完了後）。 */
function Podium({ champion, runnerUp, third }: { champion: PodiumName | null; runnerUp: PodiumName | null; third: PodiumName | null }) {
  const slots: { medal: number; label: string; who: PodiumName | null }[] = [
    { medal: 2, label: "2位", who: runnerUp },
    { medal: 1, label: "優勝", who: champion },
    { medal: 3, label: "3位", who: third },
  ];
  return (
    <GlassCard>
      <div className="mb-3 text-center text-[15px] font-bold text-[color:var(--eb-ink)]">表彰台</div>
      <div className="flex items-end justify-center gap-4">
        {slots.map(({ medal, label, who }) => (
          <div key={medal} className="flex flex-col items-center" style={{ opacity: who ? 1 : 0.35 }}>
            <div className="mb-1 text-[16px] leading-none">{medal === 1 ? "🥇" : medal === 2 ? "🥈" : "🥉"}</div>
            <Avatar src={who?.pictureUrl} name={who?.displayName ?? "—"} size={medal === 1 ? 48 : 38} style={{ boxShadow: `0 0 0 3px ${MEDAL[medal]}` }} />
            <div className="mt-1 max-w-[90px] truncate text-[13px] font-bold text-[color:var(--eb-ink)]">{who?.displayName ?? "—"}</div>
            <div className="text-[11px] font-bold" style={{ color: MEDAL[medal] }}>{label}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

/** 木の頂点：王冠＋優勝者（未定なら未定表示）。 */
function ChampCrown({ champ }: { champ: PodiumName | null }) {
  return (
    <div className="flex flex-col items-center">
      <div className="text-[22px] leading-none">👑</div>
      {champ ? (
        <div className="mt-1 flex flex-col items-center rounded-2xl px-3 py-2" style={{ background: "radial-gradient(120% 90% at 50% 0%, #2b2f31, #16191b)" }}>
          <Avatar src={champ.pictureUrl} name={champ.displayName} size={40} style={{ boxShadow: `0 0 0 3px ${MEDAL[1]}` }} />
          <div className="max-w-[120px] truncate whitespace-nowrap text-[12px] font-black text-white mt-1">{champ.displayName}</div>
          <div className="text-[9px] font-extrabold tracking-wide" style={{ color: MEDAL[1] }}>WINNER</div>
        </div>
      ) : (
        <div className="mt-0.5 text-[16px]" style={{ color: "rgba(26,29,27,.7)" }}>優勝者 未定</div>
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
    <GlassCard tone={iAmIn ? "green" : "default"} padding="md">
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="min-w-0 flex-1 truncate whitespace-nowrap text-[12px] font-bold text-[color:var(--eb-ink-muted)]">{match.label}</span>
        {done ? (
          <StatusPill tone="green">確定</StatusPill>
        ) : (
          <StatusPill tone="gold">結果待ち</StatusPill>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {match.players.map((p, i) => (
          <BracketSlot key={i} p={p} me={p.isMe} seed={p.seed} advanced={done && p.won === true} loser={done && p.won === false} />
        ))}
      </div>
      {!done && iAmIn && (
        <Button variant="primary" onClick={onInput} className="mt-1.5 h-10 text-[13px]">
          勝敗を申告
        </Button>
      )}
    </GlassCard>
  );
}

function BracketSlot({ p, me, seed, advanced, loser }: { p: PubPlayer; me: boolean; seed: boolean; advanced: boolean; loser: boolean }) {
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg"
      style={
        advanced
          ? { background: "rgba(35,147,94,.12)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
          : me
            ? { background: "var(--eb-tint)", boxShadow: "inset 0 0 0 1px var(--eb-line)" }
            : { background: "transparent" }
      }
    >
      <span className="flex-1 min-w-0 text-[13px] font-bold text-[color:var(--eb-ink)] truncate" style={loser ? { opacity: 0.5 } : undefined}>
        {p.displayName}
        {me && <span className="ml-0.5 text-[11px] font-bold text-[color:var(--eb-ink-muted)]">(あなた)</span>}
      </span>
      {seed && (
        <StatusPill tone="gold" className="shrink-0 px-1.5 py-0.5 text-[10px]">S</StatusPill>
      )}
      {advanced ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : (
        <span className="text-[11px] text-[color:var(--eb-ink-muted)] shrink-0">{loser ? "敗" : "—"}</span>
      )}
    </div>
  );
}

/** 勝者選択シート（1対1）。自分が参加する試合で、勝ったのはどちらかを選ぶ。 */
function CsInputSheet({ match, busy, error, onClose, onReport }: { match: PubMatch; busy: boolean; error: string | null; onClose: () => void; onReport: (winnerIndex: 0 | 1) => void }) {
  const [pick, setPick] = useState<0 | 1 | null>(null);
  return (
    <BottomSheet open title={`${match.label} の結果`} onClose={onClose}>
      <p className="text-[14px] text-[color:var(--eb-ink-muted)] mb-3">勝った方を選んで申告してください（対戦者どちらでも申告できます）。確定後は変更できません。</p>

      <div className="flex flex-col gap-2">
        {match.players.map((p, i) => {
          const selected = pick === i;
          return (
            <button
              key={i}
              onClick={() => setPick(i as 0 | 1)}
              className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left active:scale-[0.99] transition-transform"
              style={
                selected
                  ? { background: "rgba(35,147,94,.10)", boxShadow: "inset 0 0 0 2px var(--eb-green)" }
                  : { background: "var(--eb-tint)", boxShadow: "inset 0 0 0 1px var(--eb-line)" }
              }
            >
              <Avatar src={p.pictureUrl} name={p.displayName} size={34} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-bold text-[color:var(--eb-ink)]">
                {p.displayName}{p.isMe && <span className="ml-1 text-[11px] font-bold text-[color:var(--eb-ink-muted)]">(あなた)</span>}
              </span>
              {selected && <span className="shrink-0 whitespace-nowrap text-[13px] font-bold text-[color:var(--eb-green-text)]">勝者</span>}
            </button>
          );
        })}
      </div>

      {error && <p className="mt-3 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>}

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={() => pick != null && onReport(pick)} disabled={pick == null} loading={busy}>
          勝者を申告
        </Button>
      </div>
    </BottomSheet>
  );
}
