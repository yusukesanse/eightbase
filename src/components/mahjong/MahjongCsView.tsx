"use client";

import { useEffect, useState, useCallback, useRef } from "react";
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
  advanceCount?: number;
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
 * CS > 麻雀 — ラウンドごとの縦一覧
 * - 表彰台（終了後）→ あなたの卓（未確定のとき）→ ラウンド切替タブ → 選んだラウンドの卓カード。
 * - 木構造・接続線は廃止（横にはみ出して読めなかった）。通過者は緑、自分は金で強調。
 * - デモ時のみ他卓に「この卓を進める（デモ）」。
 */

const MEDAL: Record<number, string> = { 1: "#d8a526", 2: "#b9c0c6", 3: "#c97b3c" };
const GREEN_TINT = "rgba(35,147,94,.12)";
const GOLD_TINT = "rgba(216,165,38,.12)";

const fmtPoints = (n: number) => n.toLocaleString("en-US");
const isDone = (m: PubCsMatch) => m.status === "completed";
const byRank = (players: PubCsPlayer[]) => [...players].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

/** 通過人数。旧方式と決勝は 1。 */
function passCountOf(match: PubCsMatch, round: PubCsRound, manual: boolean) {
  return manual && round.type !== "final" ? match.advanceCount ?? round.advanceCount : 1;
}
/** 「1位が決勝へ」「上位2名が準決勝へ」「1位が優勝」。 */
function advanceText(count: number, next: PubCsRound | undefined, final: boolean) {
  if (final || !next) return "1位が優勝";
  return count > 1 ? `上位${count}名が${next.label}へ` : `1位が${next.label}へ`;
}
/** 最初に開くラウンド: 自分の未確定の卓 → 未確定の卓がある最初 → 最後。 */
function defaultRoundIndex(rounds: PubCsRound[]) {
  const mine = rounds.findIndex((r) => r.matches.some((m) => !isDone(m) && m.players.some((p) => p.isMe)));
  if (mine >= 0) return mine;
  const open = rounds.findIndex((r) => r.matches.some((m) => !isDone(m)));
  return open >= 0 ? open : rounds.length - 1;
}

/** 参加受付と公開トーナメントを表示する。 */
export function MahjongCsView() {
  const [event, setEvent] = useState<PubCsEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [inputMatch, setInputMatch] = useState<PubCsMatch | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // null = 自動選択。利用者が切り替えたら自動更新後もその選択を保つ（CSが変わる・組み直されて見つからなければ自動へ戻す）。
  const [pickedRound, setPickedRound] = useState<{ csEventId: string; label: string } | null>(null);
  const tabListRef = useRef<HTMLDivElement>(null);

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

  // 選んだタブが横スクロールの外に出ないよう寄せる（jsdom には scrollTo が無い）。
  const selectedLabel = (() => {
    if (!event?.rounds.length) return null;
    const picked = pickedRound?.csEventId === event.csEventId
      ? event.rounds.find((r) => r.label === pickedRound.label) : undefined;
    return (picked ?? event.rounds[defaultRoundIndex(event.rounds)]).label;
  })();
  useEffect(() => {
    // scrollIntoView はページ全体も縦に動かすので使わない。タブ列の横位置だけを動かす。
    const list = tabListRef.current;
    const tab = list?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (list && tab) list.scrollTo?.({ left: tab.offsetLeft - (list.clientWidth - tab.offsetWidth) / 2 });
  }, [selectedLabel]);

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
  const rounds = event.rounds;
  const roundIdx = Math.max(0, rounds.findIndex((r) => r.label === selectedLabel));
  const round = rounds[roundIdx];
  const nextRound = rounds[roundIdx + 1];
  const finalRound = rounds.find((r) => r.type === "final") ?? rounds[rounds.length - 1];
  const finalMatch = finalRound?.matches[0];
  // 表彰台は決勝卓の確定だけで出す（status だけでは仮の着順が出てしまう）。
  const finished = finalMatch != null && isDone(finalMatch);
  const myMatch = rounds.flatMap((r, i) => r.matches.map((m) => ({ m, r, next: rounds[i + 1] })))
    .find(({ m }) => !isDone(m) && m.players.some((p) => p.isMe));
  const passCounts = round ? round.matches.map((m) => passCountOf(m, round, manual)) : [];
  const uniformPass = passCounts.every((c) => c === passCounts[0]);

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
          <p className="mt-1 text-[15px] text-[color:var(--eb-ink-muted)]">S＝シード（予選免除）</p>
        )}
      </GlassCard>

      {!manual && event.status === "setup" && (
        <GlassCard>このCSは旧形式のため参加受付をしていません</GlassCard>
      )}

      {manual && (event.status === "entry" || event.status === "closed" || event.status === "setup"
        || event.myEntry?.state === "waitlisted") && (
        <CapacityEntryPanel event={event} busy={busy} error={entryError} onToggle={toggleEntry} />
      )}

      {rounds.length === 0 ? (
        <GlassCard className="text-center py-10">
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">トーナメント表はまだ公開されていません</p>
        </GlassCard>
      ) : (
        <>
          {finished && finalMatch && <Podium champ={champ} players={byRank(finalMatch.players)} />}

          {myMatch && (
            <section aria-label="あなたの卓">
              <MatchCard
                match={myMatch.m}
                round={myMatch.r}
                next={myMatch.next}
                mine
                demo={demo}
                manual={manual}
                running={event.status === "running"}
                onInput={() => setInputMatch(myMatch.m)}
              />
            </section>
          )}

          <div ref={tabListRef} role="tablist" aria-label="ラウンド" className="relative -mx-4 flex gap-2 overflow-x-auto px-4">
            {rounds.map((r, i) => {
              const done = r.matches.length > 0 && r.matches.every(isDone);
              const selected = i === roundIdx;
              return (
                <button
                  key={i}
                  id={`cs-round-tab-${i}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="cs-round-panel"
                  onClick={() => setPickedRound({ csEventId: event.csEventId, label: r.label })}
                  className="h-11 min-w-fit flex-1 whitespace-nowrap rounded-xl px-3 text-[14px] max-[360px]:text-[13px] font-bold transition-colors"
                  style={selected
                    ? { background: "var(--eb-ink)", color: "#fff" }
                    : done
                      ? { background: GREEN_TINT, color: "var(--eb-green-text)" }
                      : { background: "var(--eb-tint)", color: "var(--eb-ink-muted)" }}
                >
                  {done ? "✓ " : ""}{r.label}
                </button>
              );
            })}
          </div>

          <div id="cs-round-panel" role="tabpanel" aria-labelledby={`cs-round-tab-${roundIdx}`} className="flex flex-col gap-3">
            <div>
              <div className="text-[22px] font-bold text-[color:var(--eb-ink)]">{round.label}</div>
              <div className="text-[14px] text-[color:var(--eb-ink-muted)]">
                {round.matches.length}卓
                {uniformPass && passCounts.length > 0
                  && `・${passCounts.length > 1 ? "各卓" : ""}${advanceText(passCounts[0], nextRound, round.type === "final")}`}
              </div>
            </div>
            {round.matches.map((m) => (
              <MatchCard
                key={m.matchId}
                match={m}
                round={round}
                next={nextRound}
                hideReport={m.matchId === myMatch?.m.matchId}
                demo={demo}
                manual={manual}
                running={event.status === "running"}
                onInput={() => setInputMatch(m)}
              />
            ))}
          </div>
        </>
      )}

      {inputMatch && event && (
        <CsInputSheet
          match={inputMatch}
          manual={manual}
          round={event.rounds.find((round) => round.matches.some((match) => match.matchId === inputMatch.matchId))}
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
  const closed = ["closed", "running", "finished"].includes(event.status)
    || (event.entryClosesAt != null && now >= Date.parse(event.entryClosesAt));
  const beforeOpen = event.entryOpensAt != null && now < Date.parse(event.entryOpensAt);
  const formatTime = (value: string) => new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  });

  if (closed) {
    return (
      <GlassCard className="text-[15px] text-[color:var(--eb-ink)]">
        {mine?.state === "confirmed"
          ? "参加確定。対戦表を準備中です"
          : waiting ? "キャンセル待ちのまま締め切られました" : "参加受付は終了しました"}
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

/** 表彰台（大会終了後）。1位は champion を優先し、点数は決勝卓の持ち点。 */
function Podium({ champ, players }: { champ: PubCsEvent["champion"]; players: PubCsPlayer[] }) {
  const first = players.find((p) => p.rank === 1);
  const winner = champ ?? first;
  if (!winner) return null;
  const minor = [2, 3].map((rank) => players.find((p) => p.rank === rank));
  return (
    <section aria-label="表彰台" className="flex flex-col gap-3">
      <GlassCard tone="gold" className="flex flex-col items-center text-center">
        <StatusPill tone="gold">優勝</StatusPill>
        <Avatar src={winner.pictureUrl} name={winner.displayName} size={72} className="mt-3" style={{ boxShadow: `0 0 0 3px ${MEDAL[1]}` }} />
        <div className="mt-2 text-[20px] font-bold text-[color:var(--eb-ink)]">{winner.displayName}</div>
        {first?.points != null && first.displayName === winner.displayName && (
          <div className="text-[14px] text-[color:var(--eb-ink-muted)] tabular-nums">決勝 {fmtPoints(first.points)}点</div>
        )}
      </GlassCard>
      {minor.some(Boolean) && (
        <div className="grid grid-cols-2 gap-3">
          {minor.map((p, i) => p && (
            <div key={i} className="eb-glass flex flex-col items-center rounded-[20px] p-4 text-center" style={{ borderColor: MEDAL[i + 2], borderWidth: 2 }}>
              <div className="text-[13px] font-bold" style={{ color: MEDAL[i + 2] }}>{i + 2}位</div>
              <Avatar src={p.pictureUrl} name={p.displayName} size={44} className="mt-1" />
              <div className="mt-1 w-full truncate text-[15px] font-bold text-[color:var(--eb-ink)]">{p.displayName}</div>
              {p.points != null && <div className="text-[13px] text-[color:var(--eb-ink-muted)] tabular-nums">{fmtPoints(p.points)}点</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 1卓カード。mine＝「あなたの卓」セクション（金枠）。hideReport＝同じ卓が「あなたの卓」に出ているので一覧側のボタンを省く。 */
function MatchCard({
  match,
  round,
  next,
  mine = false,
  hideReport = false,
  demo,
  manual,
  running,
  onInput,
}: {
  match: PubCsMatch;
  round: PubCsRound;
  next: PubCsRound | undefined;
  mine?: boolean;
  hideReport?: boolean;
  demo: boolean;
  manual: boolean;
  running: boolean;
  onInput: () => void;
}) {
  const done = isDone(match);
  const pendingSeats = manual ? match.pendingSeats ?? [] : [];
  const canReport = !manual || (running && match.players.length === 4 && pendingSeats.length === 0);
  const iAmIn = match.players.some((p) => p.isMe);
  const final = round.type === "final" || !next;
  const passCount = passCountOf(match, round, manual);
  const advance = advanceText(passCount, next, final);
  const players = done ? byRank(match.players) : match.players;
  return (
    <GlassCard tone={mine ? "gold" : iAmIn ? "green" : "default"} padding="md">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[17px] font-bold text-[color:var(--eb-ink)]">{match.label}</div>
          <div className="text-[13px] text-[color:var(--eb-ink-muted)]">{mine ? `あなたの卓・${advance}` : advance}</div>
        </div>
        {done ? (
          <StatusPill tone="green">確定</StatusPill>
        ) : pendingSeats.length > 0 ? (
          <StatusPill tone="muted">勝ち上がり待ち</StatusPill>
        ) : (
          <StatusPill tone="gold">結果待ち</StatusPill>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {players.map((p, i) => (
          <PlayerRow key={i} p={p} done={done} advanced={done && p.rank != null && p.rank <= passCount} final={final} />
        ))}
        {pendingSeats.map((label, i) => (
          <div key={i} className="flex h-10 items-center rounded-xl border border-dashed border-[color:var(--eb-line)] px-3 text-[13px] text-[color:var(--eb-ink-muted)]">
            {label.replace(/\s+(\d+位)$/, "の$1")}を待っています
          </div>
        ))}
      </div>
      {/* 自分の卓は本番でも申告可。デモは他卓を自動で進められる。 */}
      {!hideReport && !done && iAmIn && canReport && (
        <Button variant="primary" onClick={onInput} className="mt-3">
          {match.players.find((p) => p.isMe)?.points != null ? "申告を修正" : "結果を申告"}
        </Button>
      )}
      {!mine && !done && !iAmIn && demo && canReport && (
        <button type="button" onClick={onInput} className="mt-2 self-start text-[13px] text-[color:var(--eb-ink-muted)] underline">
          この卓を進める（デモ）
        </button>
      )}
    </GlassCard>
  );
}

/** 選手の行: [着順] [アバター] [名前＋補足] [点数]。確定した卓だけ着順と点数を出す。 */
function PlayerRow({ p, done, advanced, final }: { p: PubCsPlayer; done: boolean; advanced: boolean; final: boolean }) {
  const sub = done
    ? advanced ? (final && p.rank === 1 ? "優勝" : "次のラウンドへ進出") : null
    : p.points != null ? "申告済み" : "まだ申告していません";
  return (
    <div
      data-cs-row
      data-advanced={advanced ? "true" : "false"}
      className="flex h-12 items-center gap-3 rounded-xl px-2"
      style={{ background: advanced ? GREEN_TINT : p.isMe ? GOLD_TINT : "transparent" }}
    >
      {done && (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-bold tabular-nums"
          style={advanced ? { background: "var(--eb-green)", color: "#fff" } : { background: "var(--eb-tint)", color: "var(--eb-ink)" }}
        >
          {p.rank ?? "—"}
        </span>
      )}
      <Avatar src={p.pictureUrl} name={p.displayName} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-bold text-[color:var(--eb-ink)]">{p.displayName}</span>
          {p.isMe && <span className="shrink-0 text-[11px] font-bold text-[color:var(--eb-gold-text)]">あなた</span>}
          {p.seed && <span className="shrink-0 text-[11px] font-bold text-[color:var(--eb-ink-muted)]">シード</span>}
        </div>
        {sub && (
          <div className={`text-[12px] ${!done && p.points != null ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-ink-muted)]"}`}>{sub}</div>
        )}
      </div>
      {done && (
        <span className="shrink-0 text-[15px] font-bold tabular-nums text-[color:var(--eb-ink)]">
          {p.points != null ? fmtPoints(p.points) : "—"}
        </span>
      )}
    </div>
  );
}

/**
 * 結果申告シート。リーグ申告と同じ「自己申告」: 自分の点数＋順位だけを送る。
 * 自分が居ない卓（全ダミー）はデモ用に自動で進める。
 */
function CsInputSheet({
  match,
  manual,
  round,
  busy,
  error,
  onClose,
  onReport,
}: {
  match: PubCsMatch;
  manual: boolean;
  round: PubCsEvent["rounds"][number] | undefined;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onReport: (body: { points?: number; rank?: number; auto?: boolean }) => void;
}) {
  const advancement = manual
    ? round?.type === "final" ? "決勝です。1位が優勝です。" : `上位${match.advanceCount ?? round?.advanceCount ?? 1}名が次へ進出。`
    : null;
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
          <p className="text-[14px] text-[color:var(--eb-ink-muted)] mb-3">
            自分の点数と順位だけを申告します（他の人の分は各自が申告）。
            {advancement ?? "1着のみ次へ進出。"}
          </p>

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
          <p className="text-[12px] text-[color:var(--eb-ink-muted)] mt-2.5">
            {advancement ?? "1着のみ次のラウンドへ進出します。"}
          </p>

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
