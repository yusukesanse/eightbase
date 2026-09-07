"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { DayTabPlaceholder } from "@/components/games/DayTabPlaceholder";
import { todayJst, fmtChips } from "@/components/poker/pokerShared";
import { POKER_INITIAL_CHIPS } from "@/types/poker";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";

/**
 * ポーカー 当日タブ（ディーラー主導の複数試合）。麻雀/ダーツの当日フローの読み替え。
 * 参加者の誰かが「ディーラーをやる」→ ディーラーがゲーム開始（30分タイマー）→ 終了 →
 * 各プレイヤーがチップ残高を申告 → ディーラーが全員を確認して確定 → 次の試合。対象日は当日。
 */

interface PlayerDto {
  lineUserId?: string;
  displayName: string;
  isMe: boolean;
  reported: boolean;
  chips?: number | null;
}
interface CurrentGame {
  gameIndex: number;
  status: "ready" | "playing" | "reporting";
  dealerName: string | null;
  iAmDealer: boolean;
  iAmPlayer: boolean;
  startedAt: string | null;
  durationMin: number;
  players: PlayerDto[];
  reportedCount: number;
  total: number;
  myReported: boolean;
  myChips: number | null;
  maxChips: number;
}
interface DayDto {
  started: boolean;
  finished: boolean;
  phase: "dealerSelect" | "ready" | "playing" | "reporting" | "finished";
  eventDate: string;
  minParticipants: number;
  paidCount: number; // 支払い済み（＝進行に参加できる人数）
  entryCount: number; // 名簿の人数（未払い含む）
  iAmPaid: boolean;
  iAmParticipant: boolean;
  participants: { displayName: string; pictureUrl?: string; isMe: boolean; paid: boolean }[];
  gamesPlayed: number;
  currentGame: CurrentGame | null;
}

async function postDay(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/poker/day/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error };
}

function useCountdown(startedAt: string | null, durationMin: number): { text: string; over: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return { text: "--:--", over: false };
  const end = new Date(startedAt).getTime() + durationMin * 60_000;
  const ms = end - now;
  if (ms <= 0) return { text: "00:00", over: true };
  const s = Math.floor(ms / 1000);
  return { text: `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`, over: false };
}

export function PokerGameTab({ onChanged }: { onChanged: () => void }) {
  const eventDate = todayJst();
  const [day, setDay] = useState<DayDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/poker/day?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else { setDay(d); setError(null); } })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 8000);

  const refresh = useCallback(async () => { await load(); onChanged(); }, [load, onChanged]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[color:var(--eb-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  // 参加者以外（シーズン未作成・APIエラーで day が無い場合も含む）には出さない。
  if (!day || !day.iAmParticipant) return <DayTabPlaceholder />;
  if (day.finished) return <InfoCard text="本日の対局はすべて終了しました。結果は「リーグ」タブに反映されます。" />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <GlassCard tone="coral" padding="md">
          <p className="text-[15px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>
        </GlassCard>
      )}

      {/* 進行状況ヘッダ */}
      <GlassCard padding="md" className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-bold text-[color:var(--eb-ink)]">
            {day.started ? `第${(day.currentGame?.gameIndex ?? day.gamesPlayed) || day.gamesPlayed}試合` : "開始前"}
          </div>
          <div className="text-[12px] text-[color:var(--eb-ink-muted)] mt-0.5">これまでに {day.gamesPlayed} 試合終了 ・ 参加 {day.paidCount}名</div>
        </div>
        {day.currentGame && (
          <StatusPill tone="green">
            {day.currentGame.status === "ready" ? "開始待ち" : day.currentGame.status === "playing" ? "プレイ中" : "チップ申告中"}
          </StatusPill>
        )}
      </GlassCard>

      {day.phase === "dealerSelect" && <DealerSelect day={day} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {day.phase === "ready" && day.currentGame && <ReadyPhase game={day.currentGame} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {day.phase === "playing" && day.currentGame && <PlayingPhase game={day.currentGame} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {day.phase === "reporting" && day.currentGame && <ReportingPhase game={day.currentGame} eventDate={eventDate} onDone={refresh} setError={setError} />}
    </div>
  );
}

function InfoCard({ text }: { text: string }) {
  return (
    <GlassCard className="py-8 text-center">
      <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink-muted)]">{text}</p>
    </GlassCard>
  );
}

/* ───────── ディーラー選択 ───────── */
function DealerSelect({ day, eventDate, onDone, setError }: { day: DayDto; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const become = async () => {
    setBusy(true); setError(null);
    const r = await postDay("dealer", { eventDate });
    if (!r.ok) setError(r.error ?? "ディーラー登録に失敗しました");
    else await onDone();
    setBusy(false);
  };
  const enoughPeople = day.paidCount >= day.minParticipants;
  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-bold text-[color:var(--eb-ink)]">
          {day.gamesPlayed > 0 ? "次の試合のディーラーを決めます" : "ディーラーを決めます"}
        </div>
        <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
          ディーラーは進行役です（プレイには参加しません）。誰か1人が「ディーラーをやる」を押してください。
          {day.gamesPlayed === 0 && "受付は開催日の開始時刻で締め切られ、その後に最初の試合を始められます。"}
        </p>
        <div className="rounded-2xl p-3" style={{ background: "var(--eb-tint)" }}>
          <div className="mb-1.5 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
            参加者（支払い済み {day.paidCount}名{day.entryCount > day.paidCount ? ` ・ 未払い ${day.entryCount - day.paidCount}名` : ""}）
          </div>
          <div className="flex flex-wrap gap-1.5">
            {day.participants.map((p, i) => (
              <span
                key={i}
                className="inline-flex min-h-[36px] items-center rounded-2xl border bg-white px-3 text-[13px] font-bold text-[color:var(--eb-ink)]"
                style={{ borderColor: p.isMe ? "var(--eb-green)" : "var(--eb-line)" }}
              >
                {p.displayName}{p.isMe && "（あなた）"}
                {!p.paid && <span className="ml-1 text-[11px] font-bold text-[color:var(--eb-gold-text)]">未払い</span>}
              </span>
            ))}
          </div>
        </div>
        {!day.iAmPaid ? (
          <InfoCard text="参加費が未払いです。お支払いいただくと参加・ディーラーができます（「参加」タブからお支払いください）。" />
        ) : (
          <Button variant="primary" loading={busy} disabled={!enoughPeople} onClick={become}>
            ディーラーをやる
          </Button>
        )}
        {!enoughPeople && (
          <p className="text-center text-[13px] text-[color:var(--eb-ink-muted)]">
            支払い済みが{day.minParticipants}名以上になると始められます（未払いの方はその場でお支払いください）。
          </p>
        )}
      </div>
    </GlassCard>
  );
}

/* ───────── 開始待ち（ready） ───────── */
function ReadyPhase({ game, eventDate, onDone, setError }: { game: CurrentGame; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true); setError(null);
    const r = await postDay("start", { eventDate });
    if (!r.ok) setError(r.error ?? "開始に失敗しました");
    else await onDone();
    setBusy(false);
  };
  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-bold text-[color:var(--eb-ink)]">ディーラー: {game.dealerName}</div>
        {game.iAmDealer ? (
          <>
            <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
              あなたがディーラーです。準備ができたら「ゲーム開始」を押してください（30分タイマーが始まります）。
              受付は開催日の開始時刻で締め切られます。
            </p>
            <Button variant="primary" loading={busy} onClick={start}>
              ゲーム開始（30分）
            </Button>
          </>
        ) : (
          <InfoCard text={`ディーラー（${game.dealerName}）の開始を待っています。`} />
        )}
      </div>
    </GlassCard>
  );
}

/* ───────── プレイ中（タイマー） ───────── */
function PlayingPhase({ game, eventDate, onDone, setError }: { game: CurrentGame; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const { text, over } = useCountdown(game.startedAt, game.durationMin);
  const end = async () => {
    setBusy(true); setError(null);
    const r = await postDay("end", { eventDate });
    if (!r.ok) setError(r.error ?? "終了に失敗しました");
    else await onDone();
    setBusy(false);
  };
  return (
    <GlassCard>
      <div className="flex flex-col items-center gap-3">
        <div className="text-[13px] font-bold text-[color:var(--eb-ink-muted)]">ディーラー: {game.dealerName}</div>
        <div
          className="text-[52px] font-bold tabular-nums leading-none"
          style={{ color: over ? "var(--eb-coral-text)" : "var(--eb-green-text)" }}
        >
          {text}
        </div>
        <p className="text-center text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
          {over ? "時間切れです。ディーラーがゲームを終了してください。" : "プレイ中です。誰か1人のチップが0になるか、30分でゲーム終了です。"}
        </p>
        {game.iAmDealer ? (
          <Button variant={over ? "danger" : "primary"} loading={busy} onClick={end}>
            ゲーム終了（チップ申告へ）
          </Button>
        ) : (
          <p className="text-[13px] text-[color:var(--eb-ink-muted)]">ディーラーがゲームを終了すると、チップの申告に進みます。</p>
        )}
      </div>
    </GlassCard>
  );
}

/* ───────── チップ申告（プレイヤー自己申告／ディーラー確認・確定） ───────── */
function ReportingPhase({ game, eventDate, onDone, setError }: { game: CurrentGame; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const allReported = game.total > 0 && game.reportedCount >= game.total;

  if (game.iAmDealer) return <DealerReview game={game} eventDate={eventDate} onDone={onDone} setError={setError} allReported={allReported} />;
  if (game.iAmPlayer) return <PlayerReport game={game} eventDate={eventDate} onDone={onDone} setError={setError} allReported={allReported} />;
  return <InfoCard text="この試合の申告状況を待っています。" />;
}

function PlayerReport({ game, eventDate, onDone, setError, allReported }: { game: CurrentGame; eventDate: string; onDone: () => void; setError: (s: string | null) => void; allReported: boolean }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (value === "") return;
    setBusy(true); setError(null);
    const r = await postDay("report", { eventDate, chips: Number(value) });
    if (!r.ok) setError(r.error ?? "申告に失敗しました");
    else { setValue(""); await onDone(); }
    setBusy(false);
  };
  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">終了時チップを申告</span>
          <span className="text-[12px] font-bold text-[color:var(--eb-ink-muted)] tabular-nums">申告 {game.reportedCount}/{game.total}</span>
        </div>
        {game.myReported ? (
          <div className="flex flex-col gap-1.5">
            <StatusPill tone="green" className="self-start">申告済み: {fmtChips(game.myChips ?? 0)}</StatusPill>
            <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
              {allReported ? "全員の申告が揃いました。ディーラーの確定を待っています。" : "他のプレイヤーの申告を待っています。"}
            </p>
          </div>
        ) : (
          <>
            <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
              初期チップは1人 {fmtChips(POKER_INITIAL_CHIPS)}。手元の残高（点）を入力してください（0〜{fmtChips(game.maxChips)}）。
            </p>
            <div className="flex items-center h-14 rounded-2xl bg-white px-4 border border-[color:var(--eb-line)]">
              <input
                type="text" inputMode="numeric" autoFocus placeholder="0" value={value}
                onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
                className="flex-1 w-full min-w-0 border-0 outline-none bg-transparent font-bold text-right text-[color:var(--eb-ink)] tabular-nums text-[26px]"
              />
              <span className="ml-2 shrink-0 text-[14px] font-bold text-[color:var(--eb-ink-muted)]">点</span>
            </div>
            <Button variant="primary" loading={busy} disabled={!value} onClick={submit}>
              申告する
            </Button>
          </>
        )}
      </div>
    </GlassCard>
  );
}

function DealerReview({ game, eventDate, onDone, setError, allReported }: { game: CurrentGame; eventDate: string; onDone: () => void; setError: (s: string | null) => void; allReported: boolean }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const submit = async (uid: string) => {
    const raw = draft[uid];
    if (raw === undefined || raw === "") return;
    setBusy(uid); setError(null);
    const r = await postDay("report", { eventDate, chips: Number(raw), targetUserId: uid });
    if (!r.ok) setError(r.error ?? "申告に失敗しました");
    else { setDraft((d) => ({ ...d, [uid]: "" })); await onDone(); }
    setBusy(null);
  };
  const confirmGame = async () => {
    setConfirming(true); setError(null);
    const r = await postDay("confirm", { eventDate });
    if (!r.ok) setError(r.error ?? "確定に失敗しました");
    else await onDone();
    setConfirming(false);
  };

  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">チップ申告の確認（ディーラー）</span>
          <span className="text-[12px] font-bold text-[color:var(--eb-ink-muted)] tabular-nums">申告 {game.reportedCount}/{game.total}</span>
        </div>
        <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
          各プレイヤーが自分で申告します。未申告の人はディーラーが代理入力できます。全員そろったら「確定」を押すと次の試合へ進みます。
        </p>
        <div className="flex flex-col gap-1.5">
          {game.players.map((p) => {
            const uid = p.lineUserId ?? "";
            return (
              <div
                key={uid}
                className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={
                  p.reported
                    ? { background: "rgba(35,147,94,.08)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
                    : { background: "var(--eb-tint)" }
                }
              >
                <span className="flex-1 min-w-0 truncate text-[14px] font-bold text-[color:var(--eb-ink)]">{p.displayName}</span>
                {p.reported && <span className="text-[13px] font-bold text-[color:var(--eb-green-text)] tabular-nums">{fmtChips(p.chips ?? 0)}</span>}
                <input
                  type="text" inputMode="numeric" placeholder={p.reported ? "修正" : "入力"}
                  value={draft[uid] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [uid]: e.target.value.replace(/[^\d]/g, "") }))}
                  className="w-20 rounded-xl border border-[color:var(--eb-line)] bg-white py-1.5 text-right text-[14px] font-bold tabular-nums text-[color:var(--eb-ink)] focus:outline-none focus:border-2 focus:border-[color:var(--eb-green)]"
                />
                <button
                  onClick={() => submit(uid)}
                  disabled={busy === uid || !draft[uid]}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-bold text-white disabled:opacity-30"
                  style={{ background: "var(--eb-green)" }}
                >
                  登録
                </button>
              </div>
            );
          })}
        </div>
        <Button variant="primary" loading={confirming} disabled={!allReported} onClick={confirmGame}>
          {allReported ? "全員のチップを確定して次へ" : `あと${game.total - game.reportedCount}名の申告待ち`}
        </Button>
      </div>
    </GlassCard>
  );
}
