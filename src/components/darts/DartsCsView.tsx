"use client";

import { useEffect, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";

/**
 * CS > ダーツ（§5・GMなし完全自動進行）— 縦トーナメント表。麻雀 MahjongCsView の読み替え。
 * 種目=カウントアップ（合計点のみ申告・順位は score 降順で派生）。上位4名は予選免除シード（S）。
 * 各組1位が勝ち上がり、1位同点は追加スロー。決勝は 1位=金/2位=銀/3位=銅。色は全ゲーム統一（緑）。
 */

interface PubPlayer { displayName: string; pictureUrl?: string; score: number | null; rank: number | null; seed: boolean; isMe: boolean }
interface PubMatch { matchId: string; label: string; status: "reporting" | "tiebreak" | "completed"; players: PubPlayer[] }
interface PubRound { type: string; label: string; matches: PubMatch[] }
interface PodiumName { displayName: string; pictureUrl?: string }
interface PubEvent {
  csEventId: string;
  name: string;
  eventDate: string;
  status: string;
  champion: PodiumName | null;
  podium: { gold: PodiumName | null; silver: PodiumName | null; bronze: PodiumName | null } | null;
  entrants: { displayName: string; seed: boolean; isMe: boolean }[];
  rounds: PubRound[];
}

const MEDAL: Record<number, string> = { 1: "#d8a526", 2: "#b9c0c6", 3: "#c97b3c" };
const LINE = "#d5dadd";
const CARD_W = 158;
const GAP = 12;

export function DartsCsView() {
  const [event, setEvent] = useState<PubEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputMatch, setInputMatch] = useState<PubMatch | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/darts/cs", { credentials: "include" })
      .then((r) => r.json())
      .then((cs) => setEvent(cs.event ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 15000);

  const report = useCallback(
    async (csEventId: string, matchId: string, score: number) => {
      setBusy(true); setInputError(null);
      try {
        const res = await fetch("/api/darts/cs/report", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ csEventId, matchId, score }),
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
        const res = await fetch("/api/darts/cs/entry", { method: join ? "POST" : "DELETE", credentials: "include" });
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
        <div
          className="w-6 h-6 rounded-full animate-spin border-2 border-t-transparent"
          style={{ borderColor: "rgba(35,147,94,.3)", borderTopColor: "transparent" }}
        />
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
          カウントアップで対戦。リーグ上位4名は<b className="text-[color:var(--eb-ink)]">予選免除シード</b>（S）。各組1位が勝ち上がり、決勝1位が優勝（金/銀/銅）。
        </p>
      </GlassCard>

      {event.status === "setup" && (
        <CsEntryPanel entered={event.entrants.some((e) => e.isMe)} count={event.entrants.length} busy={busy} error={entryError} onToggle={toggleEntry} />
      )}

      {/* 金銀銅表彰台（決勝確定後） */}
      {event.status === "finished" && event.podium && <Podium podium={event.podium} />}

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
                    <span className="text-[17px] max-[400px]:text-[16px] max-[360px]:text-[15px] font-bold whitespace-nowrap" style={{ color: gold ? "var(--eb-gold-text)" : "var(--eb-ink)" }}>{round.label}</span>
                    <StatusPill tone="muted">{gold ? "金銀銅" : "1位通過"}</StatusPill>
                  </div>
                  <div className="flex justify-center" style={{ gap: GAP }}>
                    {round.matches.map((m) => (
                      <div key={m.matchId} style={{ width: CARD_W }}>
                        <MatchCard match={m} onInput={() => setInputMatch(m)} />
                      </div>
                    ))}
                  </div>
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
          onReport={(score) => report(event.csEventId, inputMatch.matchId, score)}
        />
      )}
    </div>
  );
}

function CsEntryPanel({ entered, count, busy, error, onToggle }: { entered: boolean; count: number; busy: boolean; error: string | null; onToggle: (join: boolean) => void }) {
  return (
    <GlassCard className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] max-[400px]:text-[17px] max-[360px]:text-[16px] font-bold text-[color:var(--eb-ink)] truncate">チャンピオンシップに参加</div>
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

/** 金銀銅の表彰台（決勝確定後）。 */
function Podium({ podium }: { podium: { gold: PodiumName | null; silver: PodiumName | null; bronze: PodiumName | null } }) {
  const slots: { medal: number; label: string; who: PodiumName | null }[] = [
    { medal: 2, label: "2位", who: podium.silver },
    { medal: 1, label: "優勝", who: podium.gold },
    { medal: 3, label: "3位", who: podium.bronze },
  ];
  return (
    <GlassCard>
      <div className="text-[15px] font-bold text-[color:var(--eb-ink)] text-center mb-3">表彰台</div>
      <div className="flex items-end justify-center gap-3">
        {slots.map(({ medal, label, who }) => (
          <div key={medal} className="flex flex-col items-center" style={{ opacity: who ? 1 : 0.35 }}>
            <div className="text-[16px] leading-none mb-1">{medal === 1 ? "🥇" : medal === 2 ? "🥈" : "🥉"}</div>
            <Avatar src={who?.pictureUrl} name={who?.displayName ?? "—"} size={medal === 1 ? 48 : 38} style={{ boxShadow: `0 0 0 3px ${MEDAL[medal]}` }} />
            <div className="text-[13px] font-bold text-[color:var(--eb-ink)] mt-1 max-w-[90px] truncate">{who?.displayName ?? "—"}</div>
            <div className="text-[11px] font-bold" style={{ color: MEDAL[medal] }}>{label}</div>
          </div>
        ))}
      </div>
    </GlassCard>
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

function MatchCard({ match, onInput }: { match: PubMatch; onInput: () => void }) {
  const done = match.status === "completed";
  const tiebreak = match.status === "tiebreak";
  const me = match.players.find((p) => p.isMe);
  const iAmIn = !!me;
  const topScore = Math.max(...match.players.map((p) => p.score ?? -Infinity));
  const iAmTied = tiebreak && me?.score === topScore;
  return (
    <GlassCard tone={iAmIn ? "green" : "default"} padding="md">
      <div className="flex items-center justify-between gap-1 mb-1.5">
        <span className="flex-1 min-w-0 truncate text-[12px] font-bold text-[color:var(--eb-ink-muted)]">{match.label}</span>
        {done ? (
          <StatusPill tone="green">確定</StatusPill>
        ) : tiebreak ? (
          <StatusPill tone="gold">追加スロー</StatusPill>
        ) : (
          <StatusPill tone="coral">結果待ち</StatusPill>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {[...match.players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).map((p, i) => (
          <BracketSlot key={i} p={p} me={p.isMe} seed={p.seed} advanced={done && p.rank === 1} done={done} />
        ))}
      </div>
      {!done && iAmIn && (tiebreak ? iAmTied : true) && (
        <Button variant="primary" onClick={onInput} className="mt-1.5 h-10 text-[13px]">
          {tiebreak ? "追加スローを申告" : me?.score != null ? "申告を修正" : "スコアを申告"}
        </Button>
      )}
    </GlassCard>
  );
}

function BracketSlot({ p, me, seed, advanced, done }: { p: PubPlayer; me: boolean; seed: boolean; advanced: boolean; done: boolean }) {
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
      <span className="flex-1 min-w-0 text-[13px] font-bold text-[color:var(--eb-ink)] truncate">
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
        <span className="text-[11px] text-[color:var(--eb-ink-muted)] tabular-nums shrink-0">{p.score != null ? p.score.toLocaleString() : done ? "—" : "—"}</span>
      )}
    </div>
  );
}

/** 結果申告シート（カウントアップ合計 or 追加スロー）。順位はサーバーが score から派生。 */
function CsInputSheet({ match, busy, error, onClose, onReport }: { match: PubMatch; busy: boolean; error: string | null; onClose: () => void; onReport: (score: number) => void }) {
  const tiebreak = match.status === "tiebreak";
  const [value, setValue] = useState("");
  const n = Number(value);
  const valid = value !== "" && Number.isInteger(n) && n >= 0;

  return (
    <BottomSheet open title={`${match.label} の${tiebreak ? "追加スロー" : "結果"}`} onClose={onClose}>
      <p className="text-[14px] text-[color:var(--eb-ink-muted)] mb-3">
        {tiebreak
          ? "1位が同点のため追加スローで決着します。追加スローの得点を申告してください（高い方が通過）。"
          : "カウントアップの合計点だけを申告します（順位は自動判定・各自が申告）。1位が次のラウンドへ進出。"}
      </p>

      <label className="block text-[14px] font-bold text-[color:var(--eb-ink)] mb-2">{tiebreak ? "追加スローの得点" : "カウントアップ合計点"}</label>
      <div className="flex items-baseline gap-2 h-14 rounded-2xl bg-white px-4 border border-[color:var(--eb-line)]">
        <input
          type="text" inputMode="numeric" autoFocus value={value}
          onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="0"
          className="flex-1 w-full min-w-0 border-0 outline-none bg-transparent font-bold text-right text-[color:var(--eb-ink)] tabular-nums text-[26px]"
        />
        <span className="shrink-0 text-[14px] font-bold text-[color:var(--eb-ink-muted)]">点</span>
      </div>

      {error && <p className="mt-3 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>}

      <div className="mt-6 flex gap-2">
        <Button variant="ghost" onClick={onClose}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={() => onReport(n)} disabled={!valid} loading={busy}>
          申告する
        </Button>
      </div>
    </BottomSheet>
  );
}
