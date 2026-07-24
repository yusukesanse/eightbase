"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { POKER_ACCENT, todayJst, CheckIcon, fmtChips } from "@/components/poker/pokerShared";
import { POKER_INITIAL_CHIPS } from "@/types/poker";

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
  paidCount: number;
  iAmParticipant: boolean;
  participants: { displayName: string; pictureUrl?: string; isMe: boolean }[];
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
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!day) return <InfoCard text="読み込みに失敗しました。" />;
  if (day.finished) return <InfoCard text="本日の対局はすべて終了しました。結果は「リーグ」タブに反映されます。" />;

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">{error}</div>}

      {/* 進行状況ヘッダ */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-extrabold text-[#1c1f21]">
            {day.started ? `第${(day.currentGame?.gameIndex ?? day.gamesPlayed) || day.gamesPlayed}試合` : "開始前"}
          </div>
          <div className="text-[10.5px] text-[#3f4247] mt-0.5">これまでに {day.gamesPlayed} 試合終了 ・ 参加 {day.paidCount}名</div>
        </div>
        {day.currentGame && (
          <span className="text-[10.5px] font-bold px-2 py-1 rounded-full" style={{ background: `color-mix(in srgb, ${POKER_ACCENT} 12%, #fff)`, color: POKER_ACCENT }}>
            {day.currentGame.status === "ready" ? "開始待ち" : day.currentGame.status === "playing" ? "プレイ中" : "チップ申告中"}
          </span>
        )}
      </div>

      {!day.iAmParticipant && !day.started && (
        <InfoCard text="この開催日に参加していません。参加タブから参加してください。" />
      )}

      {day.phase === "dealerSelect" && <DealerSelect day={day} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {day.phase === "ready" && day.currentGame && <ReadyPhase game={day.currentGame} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {day.phase === "playing" && day.currentGame && <PlayingPhase game={day.currentGame} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {day.phase === "reporting" && day.currentGame && <ReportingPhase game={day.currentGame} eventDate={eventDate} onDone={refresh} setError={setError} />}
    </div>
  );
}

function InfoCard({ text }: { text: string }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-sm text-[#231714]/80">{text}</div>;
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
      <div className="text-[13px] font-extrabold text-[#1c1f21]">
        {day.gamesPlayed > 0 ? "次の試合のディーラーを決めます" : "ディーラーを決めます"}
      </div>
      <p className="text-[11.5px] text-[#231714]/80 leading-relaxed">
        ディーラーは進行役です（プレイには参加しません）。誰か1人が「ディーラーをやる」を押してください。
        {day.gamesPlayed === 0 && "　最初のディーラーが「ゲーム開始」を押すと受付が締め切られます。"}
      </p>
      <div className="rounded-xl bg-[#f7faf8] px-3 py-2">
        <div className="text-[10.5px] font-extrabold text-[#3c4f54] mb-1">参加者（{day.paidCount}名）</div>
        <div className="flex flex-wrap gap-1.5">
          {day.participants.map((p, i) => (
            <span key={i} className="inline-flex items-center rounded-2xl px-2.5 min-h-[30px] text-[12px] font-bold bg-white border" style={{ borderColor: p.isMe ? POKER_ACCENT : "#e4e7e9", color: "#231714" }}>
              {p.displayName}{p.isMe && "（あなた）"}
            </span>
          ))}
        </div>
      </div>
      {day.iAmParticipant ? (
        <button onClick={become} disabled={busy || !enoughPeople} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: POKER_ACCENT }}>
          {busy ? "登録中…" : "ディーラーをやる"}
        </button>
      ) : (
        <InfoCard text="参加者のみディーラーになれます。" />
      )}
      {!enoughPeople && <p className="text-[10.5px] text-center text-[#231714]/80">参加者が{day.minParticipants}名以上になると始められます。</p>}
    </div>
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
      <div className="text-[13px] font-extrabold text-[#1c1f21]">ディーラー: {game.dealerName}</div>
      {game.iAmDealer ? (
        <>
          <p className="text-[11.5px] text-[#231714]/80 leading-relaxed">
            あなたがディーラーです。準備ができたら「ゲーム開始」を押してください（30分タイマーが始まります）。
            最初の試合ではこの操作で受付が締め切られます。
          </p>
          <button onClick={start} disabled={busy} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: POKER_ACCENT }}>
            {busy ? "開始中…" : "ゲーム開始（30分）"}
          </button>
        </>
      ) : (
        <InfoCard text={`ディーラー（${game.dealerName}）の開始を待っています。`} />
      )}
    </div>
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col items-center gap-3">
      <div className="text-[11px] font-bold text-[#3c4f54]">ディーラー: {game.dealerName}</div>
      <div className="text-[52px] font-black tabular-nums leading-none" style={{ color: over ? "#d8533a" : POKER_ACCENT }}>{text}</div>
      <p className="text-[11.5px] text-[#231714]/80 text-center leading-relaxed">
        {over ? "時間切れです。ディーラーがゲームを終了してください。" : "プレイ中です。誰か1人のチップが0になるか、30分でゲーム終了です。"}
      </p>
      {game.iAmDealer ? (
        <button onClick={end} disabled={busy} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: over ? "#d8533a" : POKER_ACCENT }}>
          {busy ? "終了中…" : "ゲーム終了（チップ申告へ）"}
        </button>
      ) : (
        <div className="text-[11.5px] text-[#231714]/75">ディーラーがゲームを終了すると、チップの申告に進みます。</div>
      )}
    </div>
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-extrabold text-[#1c1f21]">終了時チップを申告</span>
        <span className="text-[10.5px] font-bold text-[#3c4f54] tabular-nums">申告 {game.reportedCount}/{game.total}</span>
      </div>
      {game.myReported ? (
        <div className="flex flex-col gap-1.5">
          <div className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[13px] font-extrabold self-start" style={{ background: "#eef4dd", color: "#6f9023" }}>
            <CheckIcon color="#6f9023" size={14} />申告済み: {fmtChips(game.myChips ?? 0)}
          </div>
          <p className="text-[11px] text-[#231714]/70">
            {allReported ? "全員の申告が揃いました。ディーラーの確定を待っています。" : "他のプレイヤーの申告を待っています。"}
          </p>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-[#231714]/80">初期チップは1人 {fmtChips(POKER_INITIAL_CHIPS)}。手元の残高（点）を入力してください（0〜{fmtChips(game.maxChips)}）。</p>
          <div className="flex items-center gap-2">
            <input
              type="text" inputMode="numeric" autoFocus placeholder="0" value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))}
              className="flex-1 border-b-2 outline-none bg-transparent text-[26px] font-black tabular-nums text-[#1c1f21] py-1"
              style={{ borderColor: value ? POKER_ACCENT : "#e4e7e9" }}
            />
            <span className="text-[13px] font-bold text-[#3f4247]">点</span>
            <button onClick={submit} disabled={busy || !value} className="shrink-0 px-4 py-2.5 rounded-xl text-[13px] font-black text-white disabled:opacity-30" style={{ background: POKER_ACCENT }}>
              {busy ? "..." : "申告する"}
            </button>
          </div>
        </>
      )}
    </div>
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
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-extrabold text-[#1c1f21]">チップ申告の確認（ディーラー）</span>
        <span className="text-[10.5px] font-bold text-[#3c4f54] tabular-nums">申告 {game.reportedCount}/{game.total}</span>
      </div>
      <p className="text-[11px] text-[#231714]/80">各プレイヤーが自分で申告します。未申告の人はディーラーが代理入力できます。全員そろったら「確定」を押すと次の試合へ進みます。</p>
      <div className="flex flex-col gap-1.5">
        {game.players.map((p) => {
          const uid = p.lineUserId ?? "";
          return (
            <div key={uid} className="flex items-center gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: p.reported ? POKER_ACCENT : "#e4e7e9", background: p.reported ? `color-mix(in srgb, ${POKER_ACCENT} 6%, #fff)` : "#fff" }}>
              <span className="text-[12.5px] font-bold text-[#1c1f21] flex-1 min-w-0 truncate">{p.displayName}</span>
              {p.reported && <span className="text-[11px] font-bold tabular-nums" style={{ color: POKER_ACCENT }}>{fmtChips(p.chips ?? 0)}</span>}
              <input
                type="text" inputMode="numeric" placeholder={p.reported ? "修正" : "入力"}
                value={draft[uid] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [uid]: e.target.value.replace(/[^\d]/g, "") }))}
                className="w-20 text-right border-b outline-none bg-transparent text-[14px] font-black tabular-nums text-[#1c1f21] py-0.5"
                style={{ borderColor: draft[uid] ? POKER_ACCENT : "#e4e7e9" }}
              />
              <button onClick={() => submit(uid)} disabled={busy === uid || !draft[uid]} className="shrink-0 text-[11px] font-black px-2.5 py-1.5 rounded-lg text-white disabled:opacity-30" style={{ background: POKER_ACCENT }}>
                登録
              </button>
            </div>
          );
        })}
      </div>
      <button onClick={confirmGame} disabled={!allReported || confirming} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: POKER_ACCENT }}>
        {confirming ? "確定中…" : allReported ? "全員のチップを確定して次へ" : `あと${game.total - game.reportedCount}名の申告待ち`}
      </button>
    </div>
  );
}
