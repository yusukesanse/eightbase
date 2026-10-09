"use client";

import { useEffect, useState, useCallback } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { BottomSheet } from "@/components/ui/Sheet";
import { isDevLoginEnabled } from "@/lib/env";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { PointsSignToggle } from "@/components/mahjong/leagueShared";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";

/** 公開DTO（サーバーで lineUserId を除去し isMe/seed を付与）。 */
interface PubCsPlayer {
  displayName: string;
  pictureUrl?: string;
  points: number | null;
  rank: number | null;
  seed: boolean;
  isMe: boolean;
}
interface PubCsMatch {
  matchId: string;
  label: string;
  status: "reporting" | "completed";
  players: PubCsPlayer[];
  pendingSeats: string[];
}
interface PubCsRound { type: string; label: string; advanceCount: number; matches: PubCsMatch[] }
interface PubCsEvent {
  csEventId: string;
  name: string;
  eventDate: string;
  status: "setup" | "entry" | "closed" | "running" | "finished";
  capacity: number | null;
  entryOpensAt: string | null;
  entryClosesAt: string | null;
  confirmedCount: number;
  waitlistCount: number;
  myEntry: { state: "confirmed" | "waitlisted"; waitlistPosition: number | null } | null;
  demoDummy: boolean;
  champion: { displayName: string; pictureUrl?: string } | null;
  entrants: { displayName: string; seed: boolean; isMe: boolean }[];
  rounds: PubCsRound[];
}

/**
 * CS > 麻雀（TILES 案）— 縦トーナメント表
 * - 最上部に王冠（優勝者 / 未定）、下へ 決勝→準決→予選 と枝分かれする木構造で表示。
 * - 勝ち上がりは緑で強調、M1シードは S バッジ。
 * - デモ時のみ各卓に「結果入力」。自分の卓は着順、他卓は勝者タップ（手動）。
 */

const MEDAL: Record<number, string> = { 1: "#d8a526", 2: "#b9c0c6", 3: "#c97b3c" };
const LINE = "#d5dadd";
const CARD_W = 158;
const GAP = 12;

/** 参加受付と公開トーナメントを表示する。 */
export function MahjongCsView() {
  const [event, setEvent] = useState<PubCsEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputMatch, setInputMatch] = useState<PubCsMatch | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/mahjong/cs", { credentials: "include" })
      .then((r) => r.json())
      .then((cs) => setEvent(cs.event ?? null))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);
  // 他の参加者の申告・ラウンド進行を追従（load は loading を上げないのでちらつかない）
  useAutoRefresh(load, 15000);

  // DEV-ONLY（develop 専用 / main へ入れない）: デモCSのみ結果入力UIを出す。本番は false。
  const demo = isDevLoginEnabled() && !!event?.demoDummy;

  const reportMatch = useCallback(
    async (csEventId: string, matchId: string, body: { points?: number; rank?: number; auto?: boolean }) => {
      setBusy(true);
      setInputError(null);
      try {
        const res = await fetch("/api/mahjong/cs/match", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ csEventId, matchId, ...body }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setInputError(data?.error ?? "反映に失敗しました");
          return;
        }
        // 全員入力済みだが合計が合わない（未確定）→ 再入力を促す。
        if (data.mismatch) {
          setInputError(data.error ?? "同卓の合計点が合っていません。各自の点数を見直してください。");
          await load();
          return;
        }
        setInputMatch(null);
        await load();
      } finally {
        setBusy(false);
      }
    },
    [load]
  );

  // WP6: CS 自己エントリー（受付は status="setup" の間のみ）。
  const [entryError, setEntryError] = useState<string | null>(null);
  const toggleEntry = useCallback(
    async (join: boolean) => {
      setBusy(true);
      setEntryError(null);
      try {
        const res = await fetch("/api/mahjong/cs/entry", {
          method: join ? "POST" : "DELETE",
          credentials: "include",
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setEntryError(data?.error ?? (join ? "エントリーに失敗しました" : "取消に失敗しました"));
        }
        await load();
      } catch {
        setEntryError("通信に失敗しました。もう一度お試しください");
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

  const manual = event.capacity != null;
  const champ = event.champion;
  const hasSeed = event.entrants.some((player) => player.seed)
    || event.rounds.some((round) => round.matches.some((match) => match.players.some((player) => player.seed)));
  // 木は上から 決勝→準決→予選。rounds は予選→決勝の順なので反転。
  const roundsTopDown = [...event.rounds].reverse();

  return (
    <div className={manual ? "flex min-w-0 max-w-full flex-col gap-4" : "flex flex-col gap-4"}>
      {/* イベントヘッダー */}
      <GlassCard className="text-center">
        <div className="truncate text-[20px] font-bold text-[color:var(--eb-ink)]">{event.name}</div>
        <div className="whitespace-nowrap text-[14px] text-[color:var(--eb-ink-muted)] mt-0.5">{event.eventDate}</div>
        <p
          className={`${manual ? "text-[15px]" : "text-[14px]"} text-[color:var(--eb-ink-muted)] leading-relaxed mt-3`}
        >
          {manual ? (
            "各卓の上位が勝ち上がり、決勝1位が優勝。"
          ) : (
            <>
              M1リーグ所属者は<b className="text-[color:var(--eb-ink)]">準決勝シード</b>
              {"（S）。各卓の上位が勝ち上がり、決勝1位が優勝。"}
            </>
          )}
        </p>
        {manual && hasSeed && (
          <p className="mt-1 text-[15px] text-[color:var(--eb-ink-muted)]">SEED＝シード（予選免除）</p>
        )}
      </GlassCard>

      {/* WP6: 受付中（トーナメント未生成）は誰でも自己エントリー可 */}
      {!manual && event.status === "setup" && (
        <CsEntryPanel
          entered={event.entrants.some((e) => e.isMe)}
          count={event.entrants.length}
          busy={busy}
          error={entryError}
          onToggle={toggleEntry}
        />
      )}

      {manual && (event.status === "entry" || event.status === "closed" || event.status === "setup") && (
        <CapacityEntryPanel event={event} busy={busy} error={entryError} onToggle={toggleEntry} />
      )}

      {event.rounds.length === 0 ? (
        <GlassCard className="text-center py-10">
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">トーナメント表はまだ公開されていません</p>
        </GlassCard>
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
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="whitespace-nowrap text-[17px] font-bold" style={{ color: gold ? "var(--eb-gold-text)" : "var(--eb-ink)" }}>{round.label}</span>
                    <StatusPill tone="muted">
                      {manual && round.advanceCount > 1 ? `${round.advanceCount}着まで通過` : "1着通過"}
                    </StatusPill>
                  </div>
                  <div className="flex justify-center" style={{ gap: GAP }}>
                    {round.matches.map((m) => (
                      <div key={m.matchId} style={{ width: CARD_W }}>
                        <MatchCard
                          match={m}
                          gold={gold}
                          demo={demo}
                          manual={manual}
                          advanceCount={round.advanceCount}
                          running={event.status === "running"}
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
          busy={busy}
          error={inputError}
          onClose={() => {
            setInputMatch(null);
            setInputError(null);
          }}
          onReport={(body) => reportMatch(event.csEventId, inputMatch.matchId, body)}
        />
      )}
    </div>
  );
}

/** 定員ありの受付状態とページ内の取消確認を表示する。 */
function CapacityEntryPanel({ event, busy, error, onToggle }: {
  event: PubCsEvent;
  busy: boolean;
  error: string | null;
  onToggle: (join: boolean) => Promise<void>;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const mine = event.myEntry;
  useEffect(() => {
    setConfirmCancel(false);
  }, [mine?.state]);
  const waiting = mine?.state === "waitlisted";
  const now = Date.now();
  const closed = event.status === "closed"
    || (event.entryClosesAt != null && now >= Date.parse(event.entryClosesAt));
  const beforeOpen = event.entryOpensAt != null && now < Date.parse(event.entryOpensAt);
  const formatTime = (value: string) => new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  if (closed) {
    return (
      <GlassCard className="text-[15px] text-[color:var(--eb-ink)]">
        {mine?.state === "confirmed"
          ? "参加確定。対戦表を準備中です" : "参加受付は終了しました"}
      </GlassCard>
    );
  }
  if (beforeOpen || event.status === "setup") {
    return (
      <GlassCard className="text-[15px] text-[color:var(--eb-ink-muted)]">
        {event.entryOpensAt
          ? `参加受付は ${formatTime(event.entryOpensAt)} から` : "参加受付は準備中です"}
      </GlassCard>
    );
  }

  return (
    <GlassCard className="flex min-w-0 flex-col gap-3 text-[15px] text-[color:var(--eb-ink)]">
      <p className="font-bold">定員 {event.capacity}名 / 参加確定 {event.confirmedCount}名</p>
      {event.entryClosesAt && <p>締切：{formatTime(event.entryClosesAt)}</p>}
      <p>参加できるのはリーグ戦に1回以上出た人です</p>
      {mine && (
        <div>
          <StatusPill tone={waiting ? "gold" : "green"}>
            {waiting
              ? `キャンセル待ち${mine.waitlistPosition == null ? "" : ` ${mine.waitlistPosition}番目`}`
              : "参加確定"}
          </StatusPill>
        </div>
      )}
      {waiting && <p>繰り上がるとここが『参加確定』に変わります（通知は届きません）</p>}
      {error && <p role="alert" className="text-[color:var(--eb-coral-text)]">{error}</p>}
      {mine ? (
        confirmCancel ? (
          <div className="flex flex-col gap-3">
            <p>{waiting ? "キャンセル待ちを取り消しますか？" : "参加を取り消しますか？"}</p>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(false)}>戻る</Button>
            <Button variant="danger" disabled={busy} onClick={async () => {
              try {
                await onToggle(false);
              } finally {
                setConfirmCancel(false);
              }
            }}>取り消す</Button>
          </div>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>参加をやめる</Button>
        )
      ) : (
        <Button disabled={busy} onClick={() => onToggle(true)}>参加する</Button>
      )}
    </GlassCard>
  );
}

/** CS 自己エントリーパネル（受付中のみ表示）。参加/取消と現在の参加者数。 */
function CsEntryPanel({
  entered,
  count,
  busy,
  error,
  onToggle,
}: {
  entered: boolean;
  count: number;
  busy: boolean;
  error: string | null;
  onToggle: (join: boolean) => void;
}) {
  return (
    <GlassCard className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="whitespace-nowrap text-[18px] max-[400px]:text-[17px] max-[360px]:text-[16px] font-bold text-[color:var(--eb-ink)]">チャンピオンシップに参加</div>
          <div className="text-[15px] text-[color:var(--eb-ink-muted)] mt-0.5">
            どなたでも参加できます（現在 {count} 名エントリー中）
          </div>
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
        <div className="mt-0.5 text-[16px]" style={{ color: "rgba(26,29,27,.7)" }}>優勝者 未定</div>
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
  gold,
  demo,
  manual,
  advanceCount,
  running,
  onInput,
}: {
  match: PubCsMatch;
  gold: boolean;
  demo: boolean;
  manual: boolean;
  advanceCount: number;
  running: boolean;
  onInput: () => void;
}) {
  const done = match.status === "completed";
  const pendingSeats = manual ? match.pendingSeats ?? [] : [];
  const canReport = !manual || (running && match.players.length === 4 && pendingSeats.length === 0);
  const iAmIn = match.players.some((p) => p.isMe);
  return (
    <GlassCard tone={iAmIn ? "green" : "default"} padding="md">
      <div className={`flex items-center justify-between mb-1.5 gap-1.5 ${manual ? "flex-wrap" : ""}`}>
        <span className="min-w-0 truncate text-[12px] font-bold text-[color:var(--eb-ink-muted)]">{match.label}</span>
        {done ? (
          <StatusPill tone="green">確定</StatusPill>
        ) : pendingSeats.length > 0 ? (
          <StatusPill tone="muted">勝ち上がり待ち</StatusPill>
        ) : (
          <StatusPill tone="gold">結果待ち</StatusPill>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {[...match.players]
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
          .map((p, i) => (
            <BracketSlot
              key={i}
              p={p}
              me={p.isMe}
              seed={p.seed}
              advanced={done && p.rank != null && p.rank <= (manual && !gold ? advanceCount : 1)}
              champion={manual && gold && done && p.rank === 1}
              pending={!done}
            />
          ))}
        {pendingSeats.map((label, i) => (
          <div key={i} className="rounded-lg bg-[color:var(--eb-tint)] px-1.5 py-2">
            <span className="break-words text-[15px] text-[color:var(--eb-ink-muted)]">{label}</span>
          </div>
        ))}
      </div>
      {/* 自分の卓は本番でも申告可。デモは他卓を自動で進められる。 */}
      {!done && iAmIn && canReport && (
        <Button variant="primary" onClick={onInput} className={manual ? "mt-1.5" : "mt-1.5 h-10 text-[13px]"}>
          {match.players.find((p) => p.isMe)?.points != null ? "申告を修正" : "結果を申告"}
        </Button>
      )}
      {!done && !iAmIn && demo && canReport && (
        <Button variant="ghost" onClick={onInput} className="mt-1.5 h-10 text-[13px]">
          この卓を進める（デモ）
        </Button>
      )}
    </GlassCard>
  );
}

function BracketSlot({
  p,
  me,
  seed,
  advanced,
  champion,
  pending,
}: {
  p: PubCsPlayer;
  me: boolean;
  seed: boolean;
  advanced: boolean;
  champion: boolean;
  pending: boolean;
}) {
  return (
    <div
      className="flex items-center gap-1 px-1.5 py-1 rounded-lg"
      style={
        champion
          ? { background: "rgba(216,165,38,.12)", boxShadow: "inset 0 0 0 1.5px var(--eb-gold)" }
          : advanced
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
      {champion ? (
        <span className="shrink-0 text-[11px] text-[color:var(--eb-gold-text)]" aria-label="優勝">👑</span>
      ) : advanced ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green-text)"
          strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : pending ? (
        <span className="text-[11px] text-[color:var(--eb-ink-muted)] shrink-0">—</span>
      ) : (
        <span className="text-[11px] text-[color:var(--eb-ink-muted)] tabular-nums shrink-0">{p.rank != null ? `${p.rank}着` : "—"}</span>
      )}
    </div>
  );
}

/**
 * 結果申告シート。リーグ申告と同じ「自己申告」: 自分の点数＋順位だけを送る。
 * 自分が居ない卓（全ダミー）はデモ用に自動で進める。1着のみ次へ進出。
 */
function CsInputSheet({
  match,
  busy,
  error,
  onClose,
  onReport,
}: {
  match: PubCsMatch;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onReport: (body: { points?: number; rank?: number; auto?: boolean }) => void;
}) {
  const n = match.players.length;
  const iAmIn = match.players.some((p) => p.isMe);
  const [points, setPoints] = useState("");
  // 持ち点欄は絶対値だけを持ち、符号はトグルで持つ。既定は＋。0点は符号に関わらず0。
  const [sign, setSign] = useState<1 | -1>(1);
  const [rank, setRank] = useState<number | null>(null);
  const absPoints = Number(points);
  const pointsValid = points !== "" && Number.isInteger(absPoints) && absPoints % 100 === 0;
  const signedPoints = absPoints === 0 ? 0 : sign * absPoints;
  const canSubmit = iAmIn && pointsValid && rank !== null && !busy;

  return (
    <BottomSheet open title={`${match.label} の結果`} onClose={onClose}>
      {iAmIn ? (
        <>
          <p className="text-[14px] text-[color:var(--eb-ink-muted)] mb-3">自分の点数と順位だけを申告します（他の人の分は各自が申告）。1着のみ次へ進出。</p>

          <label className="block text-[14px] font-bold text-[color:var(--eb-ink)] mb-2">最終持ち点</label>
          <div className="flex items-center gap-2.5">
            <PointsSignToggle sign={sign} onChange={setSign} />
            <div className="flex flex-1 items-center h-14 rounded-2xl bg-white px-4 border border-[color:var(--eb-line)]">
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                value={points}
                onChange={(e) => setPoints(e.target.value.replace(/[^\d]/g, ""))}
                placeholder="25000"
                className="flex-1 w-full min-w-0 border-0 outline-none bg-transparent font-bold text-right text-[color:var(--eb-ink)] tabular-nums text-[26px]"
              />
              <span className="ml-2 shrink-0 text-[14px] font-bold text-[color:var(--eb-ink-muted)]">点</span>
            </div>
          </div>
          {n === 4 && <div className="text-[12px] text-[color:var(--eb-ink-muted)] mt-1.5">100点単位（同卓4人の合計が100,000点）。マイナス（箱下）は左の「−」を選択。</div>}

          <label className="block text-[14px] font-bold text-[color:var(--eb-ink)] mt-5 mb-2">卓内順位</label>
          <div className="flex gap-2">
            {Array.from({ length: n }, (_, i) => i + 1).map((r) => (
              <button
                key={r}
                onClick={() => setRank(r)}
                className="flex-1 h-14 rounded-2xl text-[16px] font-bold transition-all"
                style={
                  rank === r
                    ? { background: "var(--eb-green)", color: "#fff" }
                    : { background: "var(--eb-tint)", color: "var(--eb-ink)" }
                }
              >
                {r}<span className="text-[12px]">着</span>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-[color:var(--eb-ink-muted)] mt-2.5">1着のみ次のラウンドへ進出します。</p>

          {error && <p className="mt-3 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>}

          <div className="mt-6 flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              キャンセル
            </Button>
            <Button
              variant="primary"
              onClick={() => onReport({ points: signedPoints, rank: rank! })}
              disabled={!canSubmit}
              loading={busy}
            >
              申告する
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[14px] text-[color:var(--eb-ink-muted)] mb-3">この卓に自分は居ません。デモ検証のため自動で結果を入れて進めます（本番は各自が申告）。</p>
          <div className="flex flex-col gap-1.5 mb-4">
            {match.players.map((p, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl min-w-0" style={{ background: "var(--eb-tint)" }}>
                <Avatar src={p.pictureUrl} name={p.displayName} size={28} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-[color:var(--eb-ink)]">{p.displayName}</span>
              </div>
            ))}
          </div>
          {error && <p className="mb-3 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>}
          <Button variant="ghost" onClick={() => onReport({ auto: true })} loading={busy}>
            この卓を自動で進める（デモ）
          </Button>
        </>
      )}
    </BottomSheet>
  );
}
