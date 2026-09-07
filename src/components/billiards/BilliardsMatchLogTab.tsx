"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { todayJst } from "@/components/billiards/billiardsShared";
import { DayGmBanner } from "@/components/games/DayGmBanner";
import { DayTabPlaceholder } from "@/components/games/DayTabPlaceholder";
import { DayRosterPanel } from "@/components/games/DayRosterPanel";
import { BILLIARDS_MAX_LOSER_BALLS, BILLIARDS_MIN_PARTICIPANTS } from "@/types/billiards";
import { Button, GlassCard, StatusPill, inputClass } from "@/components/ui/eb";

/**
 * ビリヤード 対戦記録タブ（試合ログ方式）。当日=todayJst。
 * GM: ゲーム開始 → 試合ごとに「勝者/敗者/敗者の玉数」を記録 → 本日終了/中止。
 * 参加者: ライブの当日順位と試合ログを閲覧。
 */

interface DayMember { lineUserId?: string; displayName: string; pictureUrl?: string; isMe: boolean; paid: boolean }
interface DayMatch { matchId: string; winnerId?: string; loserId?: string; winnerName: string; loserName: string; loserBalls: number; winnerIsMe: boolean; loserIsMe: boolean }
interface DayStanding { displayName: string; points: number; wins: number; losses: number; dayRank: number; isMe: boolean }
interface DayDto {
  started: boolean;
  finished: boolean;
  isGameMaster: boolean;
  gameMasterName: string | null;
  iAmParticipant: boolean;
  entryClosed: boolean;
  startTime: string | null;
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

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[color:var(--eb-green)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // 参加者以外（取得できなかった場合も含む）には出さない。理由は DayTabPlaceholder 参照。
  if (!day || !day.iAmParticipant) return <DayTabPlaceholder />;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <GlassCard tone="coral" padding="md">
          <p className="text-[15px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>
        </GlassCard>
      )}
      {/* 当日GMは開催日ごとに参加者が自己選出する（シーズン固定GMは麻雀だけ）。 */}
      <DayGmBanner
        game="billiards"
        eventDate={eventDate}
        isGameMaster={day.isGameMaster}
        gameMasterName={day.gameMasterName}
        finished={day.finished}
        entryClosed={day.entryClosed}
        startTime={day.startTime}
        onChanged={refresh}
      />
      {day.started && (
        <DayRosterPanel
          game="billiards"
          eventDate={eventDate}
          members={day.participants}
          isGameMaster={day.isGameMaster}
          finished={day.finished}
          onChanged={refresh}
        />
      )}
      {day.isGameMaster && <GmPanel day={day} eventDate={eventDate} onDone={refresh} setError={setError} />}

      {!day.started ? (
        <GlassCard className="py-8 text-center">
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            {day.gameMasterName ? "ゲームマスターの「ゲーム開始」を待っています。" : "まだゲームマスターが決まっていません。上の「GMをやる」から担当を決めてください。"}
          </p>
        </GlassCard>
      ) : (
        <>
          {/* ライブ当日順位 */}
          <GlassCard padding="md">
            <div className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
              当日順位（{day.finished ? "確定" : "途中経過"}）
            </div>
            {day.standings.length === 0 ? (
              <p className="py-1 text-[15px] text-[color:var(--eb-ink-muted)]">まだ試合がありません。</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {day.standings.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-xl"
                    style={
                      s.isMe
                        ? { background: "rgba(35,147,94,.08)", boxShadow: "inset 0 0 0 1.5px var(--eb-green)" }
                        : undefined
                    }
                  >
                    <span
                      className="w-6 text-center font-bold tabular-nums shrink-0"
                      style={{ fontSize: s.dayRank <= 3 ? 17 : 15, color: "rgba(26,29,27,.6)" }}
                    >
                      {s.dayRank}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-[15px] font-bold text-[color:var(--eb-ink)]">
                      {s.displayName}
                      {s.isMe && <StatusPill tone="green" className="ml-1.5">YOU</StatusPill>}
                    </span>
                    <span className="text-[12px] text-[color:var(--eb-ink-muted)] tabular-nums">{s.wins}勝{s.losses}敗</span>
                    <span className="w-[42px] text-right text-[16px] font-bold text-[color:var(--eb-ink)] tabular-nums">{s.points}</span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          {/* 試合ログ */}
          <GlassCard padding="md">
            <div className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">試合ログ（{day.matches.length}試合）</div>
            {day.matches.length === 0 ? (
              <p className="py-1 text-[15px] text-[color:var(--eb-ink-muted)]">まだ試合がありません。</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {day.matches.map((m) => (
                  <div
                    key={m.matchId}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-[14px]"
                    style={{ background: "var(--eb-tint)" }}
                  >
                    <span className="font-bold text-[color:var(--eb-green-text)]">勝</span>
                    <span
                      className={`truncate font-bold ${m.winnerIsMe ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-ink)]"}`}
                    >
                      {m.winnerName}
                    </span>
                    <span className="text-[color:var(--eb-ink-muted)]">14</span>
                    <span className="mx-0.5 text-[color:var(--eb-ink-muted)]">—</span>
                    <span
                      className={`truncate font-bold ${m.loserIsMe ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-ink-muted)]"}`}
                    >
                      {m.loserName}
                    </span>
                    <span className="text-[color:var(--eb-ink-muted)]">{m.loserBalls}</span>
                    <span className="flex-1" />
                    {day.isGameMaster && !day.finished && <DeleteMatch eventDate={eventDate} matchId={m.matchId} onDone={refresh} setError={setError} />}
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </>
      )}
    </div>
  );
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
      className="shrink-0 text-[13px] font-bold text-[color:var(--eb-coral-text)] disabled:opacity-40"
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
    <GlassCard tone="green">
      <div className="flex flex-col gap-3">
        <div className="text-[15px] font-bold text-[color:var(--eb-green-text)]">
          {!day.started ? "ゲーム開始（GM）" : day.finished ? "本日の対局は終了しました" : "試合を記録（GM）"}
        </div>

        {!day.started ? (
          <>
            <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
              「ゲーム開始」で<b className="text-[color:var(--eb-ink)]">受付を締め切り</b>ます。以降は参加・支払い不可。その時点の支払い済みメンバーで進めます。
            </p>
            <div className="rounded-2xl p-3" style={{ background: "var(--eb-tint)" }}>
              <div className="mb-1.5 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">支払い済み（{day.paidCount}名）</div>
              <div className="flex flex-wrap gap-1.5">
                {day.participants.length === 0 ? (
                  <span className="text-[13px] text-[color:var(--eb-ink-muted)]">まだいません</span>
                ) : (
                  day.participants.map((m) => (
                    <span
                      key={m.lineUserId ?? m.displayName}
                      className="inline-flex min-h-[36px] items-center rounded-2xl border border-[color:var(--eb-line)] bg-white px-3 text-[13px] font-bold text-[color:var(--eb-ink)]"
                    >
                      {m.displayName}
                    </span>
                  ))
                )}
              </div>
            </div>
            <Button variant="primary" loading={starting} disabled={day.paidCount < BILLIARDS_MIN_PARTICIPANTS} onClick={start}>
              ゲーム開始（受付を締め切る）
            </Button>
            {day.paidCount < BILLIARDS_MIN_PARTICIPANTS && (
              <p className="text-center text-[13px] text-[color:var(--eb-ink-muted)]">
                支払い済みが{BILLIARDS_MIN_PARTICIPANTS}名以上になると開始できます。
              </p>
            )}
            {!confirmCancel ? (
              <button
                onClick={() => setConfirmCancel(true)}
                className="self-center text-[13px] font-bold text-[color:var(--eb-coral-text)] underline underline-offset-2"
              >
                この開催日を中止（流会）にする
              </button>
            ) : (
              <GlassCard tone="coral" padding="md">
                <div className="flex flex-col gap-2.5">
                  <p className="text-[13px] font-bold leading-relaxed text-[color:var(--eb-coral-text)]">
                    支払い済みの{day.paidCount}名は<b>返金対象</b>になります。取り消せません。
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" loading={busy} onClick={() => setConfirmCancel(false)}>
                      やめる
                    </Button>
                    <Button variant="danger" loading={busy} onClick={cancel}>
                      中止する
                    </Button>
                  </div>
                </div>
              </GlassCard>
            )}
          </>
        ) : day.finished ? (
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            当日成績は確定し「リーグ」タブの通算に反映されました。おつかれさまでした。
          </p>
        ) : (
          <>
            {/* 記録フォーム */}
            <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-2 gap-2.5">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[color:var(--eb-ink-muted)]">勝者</span>
                  <select value={winnerId} onChange={(e) => setWinnerId(e.target.value)} className={inputClass}>
                    <option value="">選択</option>
                    {day.participants.filter((m) => m.paid !== false).map((m) => (
                      <option key={m.lineUserId} value={m.lineUserId}>{m.displayName}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-[13px] font-bold text-[color:var(--eb-ink-muted)]">敗者</span>
                  <select value={loserId} onChange={(e) => setLoserId(e.target.value)} className={inputClass}>
                    <option value="">選択</option>
                    {day.participants.filter((m) => m.paid !== false && m.lineUserId !== winnerId).map((m) => (
                      <option key={m.lineUserId} value={m.lineUserId}>{m.displayName}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="flex items-center gap-2.5">
                <span className="whitespace-nowrap text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
                  敗者の落とした玉数（0〜{BILLIARDS_MAX_LOSER_BALLS}）
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={loserBalls}
                  onChange={(e) => setLoserBalls(e.target.value.replace(/[^\d]/g, "").slice(0, 1))}
                  placeholder="0"
                  className="h-14 w-16 shrink-0 rounded-2xl border border-[color:var(--eb-line)] bg-white text-center text-[20px] font-bold tabular-nums text-[color:var(--eb-ink)] focus:outline-none focus:border-2 focus:border-[color:var(--eb-green)]"
                />
                <span className="shrink-0 text-[13px] text-[color:var(--eb-ink-muted)]">勝者は14pt</span>
              </label>
              <Button
                variant="primary"
                loading={busy}
                disabled={!winnerId || !loserId || winnerId === loserId || loserBalls === ""}
                onClick={record}
              >
                この試合を記録
              </Button>
            </div>

            {/* 本日終了 */}
            {!confirmFinish ? (
              <button
                onClick={() => setConfirmFinish(true)}
                className="self-center text-[13px] font-bold text-[color:var(--eb-ink-muted)] underline underline-offset-2"
              >
                本日の対局を終了する
              </button>
            ) : (
              <GlassCard padding="md">
                <div className="flex flex-col gap-2.5">
                  <p className="text-[13px] font-bold leading-relaxed text-[color:var(--eb-green-text)]">
                    本日終了で当日成績を確定し、通算順位に反映します。以降この日の記録はできません。
                  </p>
                  <div className="flex gap-2">
                    <Button variant="ghost" loading={busy} onClick={() => setConfirmFinish(false)}>
                      やめる
                    </Button>
                    <Button variant="primary" loading={busy} onClick={finish}>
                      終了する
                    </Button>
                  </div>
                </div>
              </GlassCard>
            )}
          </>
        )}
      </div>
    </GlassCard>
  );
}
