"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { MAHJONG_ENTRY_FEE, type MahjongMyEntry } from "@/types";
import { completeEntryPayment, cancelEntryPayment, startEntryPayment } from "@/lib/mahjongPayment";
import { isDevLoginEnabled } from "@/lib/env";
import { canCancelMahjong, MAHJONG_CANCEL_DEADLINE_DAYS } from "@/lib/date";
import MonthCalendar from "@/components/ui/MonthCalendar";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";
import { calendarMinMonth, canBrowsePastMonths } from "@/lib/gameCalendarRange";
import {
  isViewableDate,
  isMonthlyBlocked,
  isPastEventDate,
  canJoinDate,
} from "@/lib/mahjongJoinCalendar";
import { MahjongDayStandings, type DayStanding } from "@/components/mahjong/MahjongDayStandings";
import { dateParts, formatJpDate, todayJst } from "@/components/mahjong/leagueShared";

/**
 * 麻雀リーグ 参加タブ（WP2: 参加＝支払い）。
 *
 * 利用者に見せる状態は3つだけ:
 *   未参加 → 「参加する（お支払いへ進む）」で Square へ
 *   お支払い確認中 → 15分の仮押さえ。支払いが終われば自動で参加確定
 *   参加確定 → 支払い済み（staff は参加した時点で確定）
 * 「参加確定（未払い）」は廃止した（席だけ押さえて払わない人が定員を埋めていたため）。
 */

/** 仮押さえの残り分数（切り上げ）。0以下は失効。 */
function minutesLeft(expiresAt: string, nowMs: number): number {
  return Math.ceil((new Date(expiresAt).getTime() - nowMs) / 60_000);
}

/** その entry が「お支払い確認中（期限内の仮押さえ）」か。 */
function isPendingNow(e: MahjongMyEntry | undefined, nowMs: number): boolean {
  return !!e && e.paymentStatus === "pending" && !!e.pendingExpiresAt && new Date(e.pendingExpiresAt).getTime() > nowMs;
}

/** キャンセルできる最終日（開催日の7日前）を「M月D日」で。※UTC基準で日付だけ扱う。 */
function cancelDeadlineLabel(eventDate: string): string {
  const d = new Date(
    new Date(`${eventDate}T00:00:00Z`).getTime() - MAHJONG_CANCEL_DEADLINE_DAYS * 86_400_000
  );
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

export function JoinTab({
  enteredDates,
  myEntries,
  closedDates,
  cancelledDates,
  scheduledDates,
  seasonStartDate,
  paymentRequired,
  monthlyExempt = false,
  onChanged,
}: {
  enteredDates: Set<string>;
  /** 自分の参加（開催日 → entry）。期限切れの仮押さえはサーバーが除外済み。 */
  myEntries: Record<string, MahjongMyEntry>;
  closedDates: Set<string>;
  cancelledDates: Set<string>;
  scheduledDates?: Set<string>;
  /**
   * アクティブシーズンの開始日（"YYYY-MM-DD"）。カレンダーを遡れる下限に使う。
   * 日程未登録（毎週土曜フォールバック）のシーズンでも過去の開催日まで戻れるようにするため。
   */
  seasonStartDate?: string;
  paymentRequired: boolean;
  /** 管理者が月1回制限を解除したユーザーか（表示の出し分けのみ。可否の判定はサーバー）。 */
  monthlyExempt?: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 残り時間の表示用に一定間隔で進める現在時刻。
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 選択日の参加者（支払い済みの人だけ表示する）。
  const [dateEntries, setDateEntries] = useState<
    { displayName: string; displayStatus?: "paid" | "joined_unpaid" }[]
  >([]);
  const [dateFull, setDateFull] = useState(false);
  const [dateCount, setDateCount] = useState(0);
  const [dateCapacity, setDateCapacity] = useState<number | null>(null);
  const [dayStandings, setDayStandings] = useState<{
    hasResults: boolean;
    standings: DayStanding[];
    rankingMetric: "average" | "total";
  } | null>(null);
  const today = todayJst();

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 10_000);
    return () => clearInterval(id);
  }, []);

  // 楽観的UI: 参加取消を即時反映（サーバー確定を待たず表示）。失敗時はロールバック。
  // ※「参加する」は Square へ遷移するので楽観更新しない（戻ってきたときサーバーが正）。
  const [optimistic, setOptimistic] = useState<Record<string, "left">>({});
  const effectiveEntered = useMemo(() => {
    const s = new Set(enteredDates);
    for (const d of Object.keys(optimistic)) s.delete(d);
    return s;
  }, [enteredDates, optimistic]);
  useEffect(() => {
    setOptimistic((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const d of Object.keys(prev)) {
        if (!enteredDates.has(d)) {
          delete next[d];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [enteredDates]);

  useEffect(() => {
    if (!selectedDate) {
      setDateEntries([]);
      setDateFull(false);
      setDateCount(0);
      setDateCapacity(null);
      return;
    }
    let alive = true;
    fetch(`/api/mahjong/entries?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDateEntries(d.entries ?? []);
        setDateFull(!!d.full);
        setDateCount(typeof d.count === "number" ? d.count : (d.entries ?? []).length);
        setDateCapacity(typeof d.capacity === "number" ? d.capacity : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedDate, enteredDates, myEntries]);

  // 当日順位: 終了した過去の開催日を選んだときだけ取得（当日・未来は対象外）。
  useEffect(() => {
    if (
      !selectedDate ||
      !isPastEventDate(selectedDate, { today, enteredDates, closedDates, cancelledDates, scheduledDates })
    ) {
      setDayStandings(null);
      return;
    }
    let alive = true;
    fetch(`/api/mahjong/standings/day?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) {
          setDayStandings({
            hasResults: !!d.hasResults,
            standings: d.standings ?? [],
            rankingMetric: d.rankingMetric === "total" ? "total" : "average",
          });
        }
      })
      .catch(() => {
        if (alive) setDayStandings({ hasResults: false, standings: [], rankingMetric: "average" });
      });
    return () => {
      alive = false;
    };
  }, [selectedDate, today, closedDates, cancelledDates, enteredDates, scheduledDates]);

  // DEV-ONLY（develop 専用 / main へ入れない）: 支払い済み/返金対応中からリセットする導線を出す。
  const demo = isDevLoginEnabled();

  /** 決済の確定を試す（戻りが届かなかったときの救済）。 */
  const runComplete = useCallback(
    async (entryId: string, silent: boolean) => {
      const r = await completeEntryPayment(entryId);
      if (r.ok) {
        if (!silent) setMsg(null);
        onChanged();
        return true;
      }
      // 自動確認（silent）はまだ支払っていない人にも走るので、失敗を出さない
      // （「お支払い確認中」カードに次の操作が残っている）。手動で押したときだけ知らせる。
      if (!silent) {
        setMsg(r.message ? `お支払いの確認ができませんでした：${r.message}` : "お支払いの確認ができませんでした");
      }
      return false;
    },
    [onChanged]
  );

  // 参加タブを開いたとき、期限内の仮押さえがあれば1回だけ確定を試す
  // （Square から戻るときに ?mjpay= が届かなかった人の救済）。
  const autoTried = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const e of Object.values(myEntries)) {
      if (!isPendingNow(e, Date.now())) continue;
      if (autoTried.current.has(e.entryId)) continue;
      autoTried.current.add(e.entryId);
      void runComplete(e.entryId, true);
    }
  }, [myEntries, runComplete]);

  /** 「参加する」= 参加表明＋決済リンク発行 → Square のお支払い画面へ。 */
  async function join(date: string) {
    setBusy(date);
    setMsg(null);
    try {
      const res = await fetch("/api/mahjong/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate: date }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg(data.message ?? data.error ?? "参加の受付に失敗しました");
        setBusy(null);
        return;
      }
      if (data.paymentUrl) {
        // 同一 webview で Square へ。戻りは /games?mjpay=... で確定する。
        window.location.href = data.paymentUrl;
        return; // 遷移するので busy は解除しない
      }
      // staff（参加費免除）はこの時点で参加確定。
      onChanged();
    } catch {
      setMsg("通信に失敗しました");
    } finally {
      setBusy((b) => (b === date ? null : b));
    }
  }

  /**
   * 「お支払い画面に戻る」。発行済みの決済URLがあればそこへ、
   * 無い（＝URL を保存していない旧データ）なら pay API に再発行させてから遷移する。
   * 期限内なら pay API も同じ URL を返すので、注文が二重に立つことはない。
   */
  async function resumePayment(date: string, url?: string | null) {
    if (url) {
      window.location.href = url;
      return;
    }
    setBusy(date);
    setMsg(null);
    const r = await startEntryPayment(date);
    if (r.ok) {
      window.location.href = r.paymentUrl;
      return;
    }
    setMsg(r.message);
    setBusy(null);
  }

  /** 参加をやめる（お支払い確認中のみ）。席と月枠を解放する。 */
  async function leave(date: string) {
    setBusy(date);
    setMsg(null);
    setOptimistic((p) => ({ ...p, [date]: "left" }));
    try {
      const res = await fetch(`/api/mahjong/entries?eventDate=${date}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        setOptimistic((p) => {
          const n = { ...p };
          delete n[date];
          return n;
        });
        const d = await res.json().catch(() => ({}));
        setMsg(d.message ?? d.error ?? "取消に失敗しました");
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function confirmCancel(date: string) {
    setBusy(date);
    setMsg(null);
    try {
      const r = await cancelEntryPayment(date);
      if (!r.ok) setMsg(r.message ?? "キャンセルに失敗しました");
      setCancelDate(null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const enteredArr = Array.from(effectiveEntered).sort();
  const calCtx = {
    today,
    enteredDates: effectiveEntered,
    closedDates,
    cancelledDates,
    scheduledDates,
    monthlyExempt,
  };
  const minMonth = calendarMinMonth(scheduledDates, effectiveEntered, seasonStartDate);

  return (
    <div className="flex flex-col gap-4">
      <p className="px-0.5 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
        土曜日が開催日です。参加したい日を選んでください。
      </p>

      {msg && (
        <GlassCard tone="coral" padding="md">
          <p className="text-[15px] font-bold text-[color:var(--eb-coral-text)]">{msg}</p>
        </GlassCard>
      )}

      <GlassCard>
        <MonthCalendar
          value={selectedDate}
          onSelect={setSelectedDate}
          isSelectable={(d) => isViewableDate(d, calCtx)}
          marked={(d) => effectiveEntered.has(d)}
          minMonth={minMonth}
          variant="game"
        />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[color:var(--eb-ink-muted)]">
          <span className="whitespace-nowrap">○ 開催日</span>
          <span className="whitespace-nowrap">◎ 参加確定</span>
          <span className="whitespace-nowrap">● 選んだ日</span>
        </div>
        {canBrowsePastMonths(minMonth, today) && (
          <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            「‹」で前の月に戻ると、その日の対戦結果を確認できます。
          </p>
        )}
      </GlassCard>

      {/* あなたの参加状況 */}
      {enteredArr.length > 0 && (
        <GlassCard padding="md">
          <div className="mb-2 whitespace-nowrap text-[13px] font-bold text-[color:var(--eb-ink-muted)]">あなたの参加状況</div>
          <div className="flex flex-col divide-y divide-[color:var(--eb-line)]">
            {enteredArr.map((d) => {
              const e = myEntries[d];
              const cancelled = cancelledDates.has(d);
              const pending = isPendingNow(e, nowMs);
              const label = cancelled
                ? "中止"
                : e?.paymentStatus === "cancelRequested"
                  ? "返金対応中"
                  : pending
                    ? "お支払い確認中"
                    : e?.paymentStatus === "pending"
                      ? "仮押さえ解除"
                      : "参加確定";
              const tone =
                cancelled ? "coral" : label === "参加確定" ? "green" : label === "仮押さえ解除" ? "muted" : "gold";
              const { md, wd } = dateParts(d);
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className="flex items-center justify-between gap-2 py-2.5 text-left active:opacity-70"
                >
                  <span className="shrink-0 whitespace-nowrap text-[15px] font-bold text-[color:var(--eb-ink)]">
                    {md}（{wd}）
                  </span>
                  <StatusPill tone={tone}>{label}</StatusPill>
                </button>
              );
            })}
          </div>
        </GlassCard>
      )}

      {!selectedDate ? (
        <GlassCard>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            カレンダーの日にちを押すと、その日に参加できるか表示されます
          </p>
        </GlassCard>
      ) : (
        <SelectedDateCard
          date={selectedDate}
          entry={myEntries[selectedDate]}
          entered={effectiveEntered.has(selectedDate)}
          paymentRequired={paymentRequired}
          cancelled={cancelledDates.has(selectedDate)}
          isPast={isPastEventDate(selectedDate, calCtx)}
          monthlyBlocked={
            !effectiveEntered.has(selectedDate) &&
            isMonthlyBlocked(selectedDate, effectiveEntered, monthlyExempt)
          }
          full={dateFull}
          canJoin={canJoinDate(selectedDate, { ...calCtx, full: dateFull })}
          busy={busy === selectedDate}
          nowMs={nowMs}
          demo={demo}
          onJoin={() => join(selectedDate)}
          onResume={() => resumePayment(selectedDate, myEntries[selectedDate]?.paymentUrl)}
          onLeave={() => leave(selectedDate)}
          onComplete={(entryId) => runComplete(entryId, false)}
          onRequestCancel={() => setCancelDate(selectedDate)}
          onClearSelection={() => setSelectedDate(null)}
        />
      )}

      {/* この日の参加者（支払いが完了した人だけ）。終了した過去日は当日順位を出すので隠す。 */}
      {selectedDate && !cancelledDates.has(selectedDate) && !isPastEventDate(selectedDate, calCtx) && (
        <GlassCard>
          <div className="mb-2 whitespace-nowrap text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
            この日の参加者（{dateCapacity != null ? `${dateCount} / ${dateCapacity}名` : `${dateCount}名`}）
          </div>
          {(() => {
            const paidOnly = dateEntries.filter((e) => e.displayStatus === "paid");
            return paidOnly.length === 0 ? (
              <p className="py-1 text-[15px] text-[color:var(--eb-ink-muted)]">まだ参加者がいません。</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {paidOnly.map((e, i) => (
                  <div key={i} className="text-[15px] font-bold text-[color:var(--eb-ink)]">
                    {e.displayName}
                  </div>
                ))}
              </div>
            );
          })()}
          <p className="mt-2 text-[13px] text-[color:var(--eb-ink-muted)]">
            ※ 支払いが完了した人だけが表示されます
          </p>
        </GlassCard>
      )}

      {/* 当日順位（終了した過去の開催日のみ） */}
      {selectedDate &&
        isPastEventDate(selectedDate, calCtx) &&
        dayStandings &&
        (dayStandings.hasResults ? (
          <MahjongDayStandings
            eventDate={selectedDate}
            standings={dayStandings.standings}
            rankingMetric={dayStandings.rankingMetric}
          />
        ) : (
          <GlassCard>
            <p className="text-center text-[15px] text-[color:var(--eb-ink-muted)]">
              この日の成績はまだありません。
            </p>
          </GlassCard>
        ))}

      {cancelDate && (
        <CancelPayModal
          date={cancelDate}
          busy={busy === cancelDate}
          onConfirm={() => confirmCancel(cancelDate)}
          onClose={() => setCancelDate(null)}
        />
      )}
    </div>
  );
}

/* ───────── 選択した開催日のカード ───────── */

function SelectedDateCard({
  date,
  entry,
  entered,
  paymentRequired,
  cancelled,
  isPast,
  monthlyBlocked,
  full,
  canJoin,
  busy,
  nowMs,
  demo,
  onJoin,
  onResume,
  onLeave,
  onComplete,
  onRequestCancel,
  onClearSelection,
}: {
  date: string;
  entry?: MahjongMyEntry;
  entered: boolean;
  paymentRequired: boolean;
  cancelled: boolean;
  isPast: boolean;
  monthlyBlocked: boolean;
  full: boolean;
  canJoin: boolean;
  busy: boolean;
  nowMs: number;
  demo: boolean;
  onJoin: () => void;
  onResume: () => void;
  onLeave: () => void;
  onComplete: (entryId: string) => void;
  onRequestCancel: () => void;
  onClearSelection: () => void;
}) {
  const { md, wd } = dateParts(date);
  const heading = (
    <div className="flex items-baseline gap-2">
      <span className="whitespace-nowrap text-[20px] font-bold text-[color:var(--eb-ink)]">
        {md}（{wd}）
      </span>
      <span className="whitespace-nowrap text-[15px] text-[color:var(--eb-ink-muted)]">リーグ戦</span>
    </div>
  );

  // 中止（流会）
  if (cancelled) {
    return (
      <GlassCard tone="coral">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="coral" className="self-start">
            中止
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            参加者が規定人数に満たなかったため中止になりました。
            {entered && "お支払い済みの参加費は返金対応します（担当よりご連絡します）。"}
          </p>
          <Button variant="secondary" onClick={onClearSelection}>
            ほかの開催日を見る
          </Button>
        </div>
      </GlassCard>
    );
  }

  const pending = isPendingNow(entry, nowMs);
  const paid = entered && (!paymentRequired || entry?.paymentStatus === "paid");
  const cancelRequested = entry?.paymentStatus === "cancelRequested";

  // お支払い確認中（15分の仮押さえ）
  if (pending && entry) {
    const left = Math.max(0, minutesLeft(entry.pendingExpiresAt!, nowMs));
    return (
      <GlassCard tone="gold">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="gold" className="self-start">
            お支払い確認中
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            お支払い画面を開いています。15分以内にお支払いを終えてください。時間を過ぎると席の仮押さえは解除されます。
          </p>
          <p className="text-[15px] font-bold text-[color:var(--eb-gold-text)]">あと {left} 分</p>
          <Button variant="pay" loading={busy} onClick={onResume}>
            お支払い画面に戻る
          </Button>
          <Button variant="secondary" loading={busy} onClick={() => onComplete(entry.entryId)}>
            支払いを終えたのに確定しない
          </Button>
          <Button variant="ghost" loading={busy} onClick={onLeave}>
            参加をやめる
          </Button>
        </div>
      </GlassCard>
    );
  }

  // 仮押さえが切れた（画面を開いたまま15分過ぎた等）。サーバー上も席は解放されている。
  // ここを作らないと「参加中なのに何も操作できないカード」が出る（次のポーリングまで数秒〜十数秒）。
  if (entry?.paymentStatus === "pending" && !pending) {
    return (
      <GlassCard>
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="muted" className="self-start">
            仮押さえ解除
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            お支払いの時間（15分）が過ぎたため、席の仮押さえを解除しました。もう一度お手続きください。
          </p>
          <Button variant="primary" loading={busy} onClick={onJoin}>
            参加する（お支払いへ進む）
          </Button>
        </div>
      </GlassCard>
    );
  }

  // 返金対応中
  if (entered && cancelRequested) {
    return (
      <GlassCard tone="gold">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="gold" className="self-start">
            返金対応中
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            参加費の返金を手続き中です。担当よりご連絡します。
          </p>
          {demo && (
            <Button variant="ghost" loading={busy} onClick={onLeave}>
              リセット（デモ）
            </Button>
          )}
        </div>
      </GlassCard>
    );
  }

  // 参加確定（支払い済み・staff）
  if (paid) {
    const cancellable = canCancelMahjong(date);
    return (
      <GlassCard tone="green">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="green" className="self-start">
            ✓ 参加確定・支払い済み
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            当日はゲーム開始までに会場へお越しください。卓の振り分けは当日GMが行います。
          </p>
          {paymentRequired ? (
            cancellable ? (
              <>
                <Button variant="secondary" loading={busy} onClick={onRequestCancel}>
                  支払いをキャンセルする
                </Button>
                <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
                  キャンセルは{cancelDeadlineLabel(date)}まで受け付けます。
                </p>
              </>
            ) : (
              <p className="text-[15px] text-[color:var(--eb-ink-muted)]">
                キャンセル期限切れ（{cancelDeadlineLabel(date)}まで）
              </p>
            )
          ) : (
            <Button variant="ghost" loading={busy} onClick={onLeave}>
              参加をやめる
            </Button>
          )}
          {demo && paymentRequired && (
            <Button variant="ghost" loading={busy} onClick={onLeave}>
              リセット（デモ）
            </Button>
          )}
        </div>
      </GlassCard>
    );
  }

  // 未参加: 参加できない理由を1文で（ボタンは出さない）
  if (!canJoin) {
    const reason = isPast
      ? "この開催日は終了しました"
      : full
        ? "満員です（この日はもう参加できません）"
        : monthlyBlocked
          ? "今月はすでに別の日に参加しています"
          : "この日は参加を受け付けていません";
    return (
      <GlassCard>
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="muted" className="self-start">
            {isPast ? "終了" : full ? "満員" : monthlyBlocked ? "今月は参加済み" : "受付なし"}
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">{reason}</p>
        </div>
      </GlassCard>
    );
  }

  // 未参加・参加できる日
  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        {heading}
        <StatusPill tone="green" className="self-start">
          参加できます
        </StatusPill>
        {paymentRequired ? (
          <>
            <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
              参加費のお支払いが完了すると、参加が確定します。
            </p>
            <div
              className="flex items-center justify-between rounded-2xl px-4 py-3 gap-2"
              style={{ background: "var(--eb-tint)" }}
            >
              <span className="whitespace-nowrap text-[15px] text-[color:var(--eb-ink)]">参加費</span>
              <span className="shrink-0 whitespace-nowrap text-[20px] font-bold text-[color:var(--eb-ink)]">
                ¥{MAHJONG_ENTRY_FEE.toLocaleString()}
              </span>
            </div>
            <Button variant="primary" loading={busy} onClick={onJoin}>
              参加する（お支払いへ進む）
            </Button>
            <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
              押すとSquareのお支払い画面が開きます。支払いが終わると自動でこの画面に戻り「参加確定」になります。
            </p>
          </>
        ) : (
          <>
            <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
              参加費のお支払いは不要です。押すとすぐに参加確定になります。
            </p>
            <Button variant="primary" loading={busy} onClick={onJoin}>
              参加する
            </Button>
          </>
        )}
      </div>
    </GlassCard>
  );
}

/* 参加費キャンセル依頼の確認（自動返金なし・管理者が手動返金） */
function CancelPayModal({
  date,
  busy,
  onConfirm,
  onClose,
}: {
  date: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3" onClick={onClose}>
      <div className="safe-area-pb w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <GlassCard>
          <h3 className="text-[17px] font-bold text-[color:var(--eb-ink)]">参加費のキャンセル</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            {formatJpDate(date)} の参加費のキャンセルを依頼します。
            <br />
            <span className="font-bold">アプリ内では自動返金されません。</span>
            管理者へ返金依頼の通知が送られ、後日Squareから手動で返金対応します。
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <Button variant="danger" loading={busy} onClick={onConfirm}>
              キャンセルを依頼
            </Button>
            <Button variant="ghost" onClick={onClose}>
              やめる
            </Button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
