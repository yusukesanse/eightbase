"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { Avatar } from "@/components/ui/LineContact";
import { BILLIARDS_ACCENT, todayJst } from "@/components/billiards/billiardsShared";
import { BILLIARDS_MAX_LOSER_BALLS, BILLIARDS_MIN_PARTICIPANTS } from "@/types/billiards";

/**
 * ビリヤード 対戦記録タブ（試合ログ方式）。当日=todayJst。
 * GM: ゲーム開始 → 試合ごとに「勝者/敗者/敗者の玉数」を記録 → 本日終了/中止。
 * 参加者: ライブの当日順位と試合ログを閲覧。
 */

interface DayMember { lineUserId?: string; displayName: string; pictureUrl?: string; isMe: boolean }
interface DayMatch { matchId: string; winnerId?: string; loserId?: string; winnerName: string; loserName: string; loserBalls: number; winnerIsMe: boolean; loserIsMe: boolean }
interface DayStanding { displayName: string; points: number; wins: number; losses: number; dayRank: number; isMe: boolean }
interface DayDto {
  started: boolean;
  finished: boolean;
  isGameMaster: boolean;
  participants: DayMember[];
  paidCount: number;
  matches: DayMatch[];
  standings: DayStanding[];
}

export function BilliardsMatchLogTab({ onChanged }: { onChanged: () => void }) {
  const eventDate = todayJst();
  const [day, setDay] = useState<DayDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/billiards/day?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setDay(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load, 12000);

  const refresh = useCallback(async () => { await load(); onChanged(); }, [load, onChanged]);

  if (loading) return <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>;
  if (!day) return <InfoCard text="準備中です。" />;

  return (
    <div className="flex flex-col gap-4">
      {error && <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">{error}</div>}
      {day.isGameMaster && <GmPanel day={day} eventDate={eventDate} onDone={refresh} setError={setError} />}

      {!day.started ? (
        <InfoCard text="ゲームマスターの「ゲーム開始」を待っています。" />
      ) : (
        <>
          {/* ライブ当日順位 */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
            <div className="text-[12px] font-extrabold text-[#1c1f21] mb-2">当日順位（{day.finished ? "確定" : "途中経過"}）</div>
            {day.standings.length === 0 ? <div className="text-[12px] text-[#231714]/80 py-1">まだ試合がありません。</div> : (
              <div className="flex flex-col gap-1">
                {day.standings.map((s, i) => (
                  <div key={i} className="flex items-center gap-2.5 px-1.5 py-1 rounded-lg" style={s.isMe ? { background: `color-mix(in srgb, ${BILLIARDS_ACCENT} 8%, #fff)` } : undefined}>
                    <span className="w-[20px] text-center text-[13px] font-black tabular-nums" style={{ color: s.dayRank <= 3 ? BILLIARDS_ACCENT : "#97999d" }}>{s.dayRank}</span>
                    <span className="flex-1 min-w-0 text-[13px] font-bold text-[#1c1f21] truncate">{s.displayName}{s.isMe && <span className="ml-1 text-[10px] font-extrabold" style={{ color: BILLIARDS_ACCENT }}>YOU</span>}</span>
                    <span className="text-[10.5px] text-[#97999d] tabular-nums">{s.wins}勝{s.losses}敗</span>
                    <span className="text-[15px] font-black text-[#1c1f21] tabular-nums w-[42px] text-right">{s.points}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 試合ログ */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
            <div className="text-[12px] font-extrabold text-[#1c1f21] mb-2">試合ログ（{day.matches.length}試合）</div>
            {day.matches.length === 0 ? <div className="text-[12px] text-[#231714]/80 py-1">まだ試合がありません。</div> : (
              <div className="flex flex-col gap-1.5">
                {day.matches.map((m) => (
                  <div key={m.matchId} className="flex items-center gap-2 rounded-xl border border-[#eceff1] px-2.5 py-2 text-[12.5px]">
                    <span className="font-extrabold" style={{ color: "#6f9023" }}>勝</span>
                    <span className={`font-bold ${m.winnerIsMe ? "text-[#2f7d57]" : "text-[#1c1f21]"} truncate`}>{m.winnerName}</span>
                    <span className="text-[#97999d]">14</span>
                    <span className="text-[#c3c7cc] mx-0.5">—</span>
                    <span className={`font-bold ${m.loserIsMe ? "text-[#2f7d57]" : "text-[#40434a]"} truncate`}>{m.loserName}</span>
                    <span className="text-[#97999d]">{m.loserBalls}</span>
                    <span className="flex-1" />
                    {day.isGameMaster && !day.finished && <DeleteMatch eventDate={eventDate} matchId={m.matchId} onDone={refresh} setError={setError} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function InfoCard({ text }: { text: string }) {
  return <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center text-sm text-[#231714]/80">{text}</div>;
}

async function postDay(path: string, body: unknown, method = "POST"): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/billiards/day/${path}`, { method, headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error };
}

function DeleteMatch({ eventDate, matchId, onDone, setError }: { eventDate: string; matchId: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        if (!confirm("この試合を取り消しますか？")) return;
        setBusy(true); setError(null);
        const r = await postDay("match", { eventDate, matchId }, "DELETE");
        if (!r.ok) setError(r.error ?? "取り消しに失敗しました");
        else await onDone();
        setBusy(false);
      }}
      disabled={busy}
      className="shrink-0 text-[11px] font-bold text-[#d8533a] disabled:opacity-40"
    >
      取消
    </button>
  );
}

/* ───────── GM パネル（開始・記録・終了・中止） ───────── */

function GmPanel({ day, eventDate, onDone, setError }: { day: DayDto; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [starting, setStarting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [busy, setBusy] = useState(false);
  const [winnerId, setWinnerId] = useState("");
  const [loserId, setLoserId] = useState("");
  const [loserBalls, setLoserBalls] = useState("");

  const start = async () => {
    setStarting(true); setError(null);
    const r = await postDay("start", { eventDate });
    if (!r.ok) setError(r.error ?? "ゲーム開始に失敗しました");
    else await onDone();
    setStarting(false);
  };

  const record = async () => {
    if (!winnerId || !loserId || winnerId === loserId || loserBalls === "") return;
    setBusy(true); setError(null);
    const r = await postDay("match", { eventDate, winnerId, loserId, loserBalls: Number(loserBalls) });
    if (!r.ok) setError(r.error ?? "記録に失敗しました");
    else { setLoserId(""); setLoserBalls(""); await onDone(); }
    setBusy(false);
  };

  const finish = async () => {
    setBusy(true); setError(null);
    const r = await postDay("finish", { eventDate });
    if (!r.ok) setError(r.error ?? "終了に失敗しました");
    else { setConfirmFinish(false); await onDone(); }
    setBusy(false);
  };
  const cancel = async () => {
    setBusy(true); setError(null);
    const r = await postDay("cancel", { eventDate });
    if (!r.ok) setError(r.error ?? "中止に失敗しました");
    else { setConfirmCancel(false); await onDone(); }
    setBusy(false);
  };

  return (
    <div className="rounded-2xl border-2 p-4 flex flex-col gap-3" style={{ borderColor: BILLIARDS_ACCENT, background: `color-mix(in srgb, ${BILLIARDS_ACCENT} 5%, #fff)` }}>
      <div className="text-[13px] font-black" style={{ color: BILLIARDS_ACCENT }}>{!day.started ? "ゲーム開始（GM）" : day.finished ? "本日の対局は終了しました" : "試合を記録（GM）"}</div>

      {!day.started ? (
        <>
          <p className="text-[11px] text-[#231714]/80 leading-relaxed">「ゲーム開始」で<b>受付を締め切り</b>ます。以降は参加・支払い不可。その時点の支払い済みメンバーで進めます。</p>
          <div className="rounded-2xl border border-dashed p-2.5" style={{ borderColor: "#e4e7e9", background: "#fff" }}>
            <div className="text-[11px] font-extrabold text-[#3f4247] mb-1.5">支払い済み（{day.paidCount}名）</div>
            <div className="flex flex-wrap gap-1.5">
              {day.participants.length === 0 ? <span className="text-[11px] text-[#231714]/75">まだいません</span> : day.participants.map((m) => (
                <span key={m.lineUserId ?? m.displayName} className="inline-flex items-center rounded-2xl px-3 min-h-[36px] text-[13px] font-bold bg-white border" style={{ borderColor: "#e4e7e9", color: "#231714" }}>{m.displayName}</span>
              ))}
            </div>
          </div>
          <button onClick={start} disabled={starting || day.paidCount < BILLIARDS_MIN_PARTICIPANTS} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: BILLIARDS_ACCENT }}>{starting ? "開始中…" : "ゲーム開始（受付を締め切る）"}</button>
          {day.paidCount < BILLIARDS_MIN_PARTICIPANTS && <p className="text-[10.5px] text-[#231714]/85 text-center">支払い済みが{BILLIARDS_MIN_PARTICIPANTS}名以上になると開始できます。</p>}
          {!confirmCancel ? (
            <button onClick={() => setConfirmCancel(true)} className="text-[10.5px] font-bold text-[#c0563c] underline underline-offset-2 self-center">この開催日を中止（流会）にする</button>
          ) : (
            <div className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: "#e9b7ab", background: "#fdece8" }}>
              <p className="text-[11px] font-bold text-[#c0563c] leading-relaxed">支払い済みの{day.paidCount}名は<b>返金対象</b>になります。取り消せません。</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmCancel(false)} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-white disabled:opacity-40" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}>やめる</button>
                <button onClick={cancel} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] font-black text-white disabled:opacity-40" style={{ background: "#c0563c" }}>中止する</button>
              </div>
            </div>
          )}
        </>
      ) : day.finished ? (
        <p className="text-[12px] text-[#231714]/80 leading-relaxed">当日成績は確定し「リーグ」タブの通算に反映されました。おつかれさまでした。</p>
      ) : (
        <>
          {/* 記録フォーム */}
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-extrabold text-[#3c4f54]">勝者</span>
                <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-2 text-[13px]">
                  <option value="">選択</option>
                  {day.participants.map((m) => <option key={m.lineUserId} value={m.lineUserId}>{m.displayName}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-extrabold text-[#3c4f54]">敗者</span>
                <select value={loserId} onChange={(e) => setLoserId(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-2 text-[13px]">
                  <option value="">選択</option>
                  {day.participants.filter((m) => m.lineUserId !== winnerId).map((m) => <option key={m.lineUserId} value={m.lineUserId}>{m.displayName}</option>)}
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2">
              <span className="text-[10px] font-extrabold text-[#3c4f54] whitespace-nowrap">敗者の落とした玉数（0〜{BILLIARDS_MAX_LOSER_BALLS}）</span>
              <input type="text" inputMode="numeric" value={loserBalls} onChange={(e) => setLoserBalls(e.target.value.replace(/[^\d]/g, "").slice(0, 1))} placeholder="0" className="w-16 rounded-lg border border-gray-200 px-3 py-2 text-[14px] font-black text-center tabular-nums" />
              <span className="text-[10px] text-[#97999d]">勝者は14pt</span>
            </label>
            <button onClick={record} disabled={busy || !winnerId || !loserId || winnerId === loserId || loserBalls === ""} className="w-full py-2.5 rounded-xl text-[14px] font-black text-white disabled:opacity-40" style={{ background: BILLIARDS_ACCENT }}>{busy ? "記録中…" : "この試合を記録"}</button>
          </div>

          {/* 本日終了 */}
          {!confirmFinish ? (
            <button onClick={() => setConfirmFinish(true)} className="text-[10.5px] font-bold text-[#3c4f54] underline underline-offset-2 self-center">本日の対局を終了する</button>
          ) : (
            <div className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: "#c9d6cf", background: "#f7faf8" }}>
              <p className="text-[11px] font-bold leading-relaxed" style={{ color: BILLIARDS_ACCENT }}>本日終了で当日成績を確定し、通算順位に反映します。以降この日の記録はできません。</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmFinish(false)} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-white disabled:opacity-40" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}>やめる</button>
                <button onClick={finish} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] font-black text-white disabled:opacity-40" style={{ background: BILLIARDS_ACCENT }}>終了する</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
