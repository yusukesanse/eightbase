"use client";

import { useState, useEffect } from "react";
import MonthCalendar from "@/components/ui/MonthCalendar";
import { calendarMinMonth, canBrowsePastMonths } from "@/lib/gameCalendarRange";
import { isDevLoginEnabled } from "@/lib/env";
import { startPokerEntryPayment, cancelPokerEntryPayment } from "@/lib/pokerPayment";
import { POKER_ENTRY_FEE, POKER_MAX_ENTRIES_PER_DATE, type PokerPaymentStatus } from "@/types/poker";
import { PokerDayStandings, type PokerDayStanding } from "@/components/poker/PokerDayStandings";
import { dateParts, formatJpDate, todayJst } from "@/components/poker/pokerShared";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";

/**
 * ポーカー 参加タブ（ダーツ/ビリヤードの JoinTab の読み替え）。
 * 開催日は管理登録の `pokerSchedule`（第1・第3土曜）のみ選択可。参加費 ¥1,000・定員9名・月1回。
 */
export function PokerJoinTab({
  enteredDates,
  scheduleDates,
  scheduleTimes,
  cancelledDates,
  paymentRequired,
  monthlyExempt = false,
  paymentStatusByDate,
  onChanged,
}: {
  enteredDates: Set<string>;
  scheduleDates: Set<string>;
  /** 日付ごとの開催時刻（管理画面の設定）。未指定の日は時刻を出さない。 */
  scheduleTimes?: Record<string, { startTime?: string; endTime?: string }>;
  cancelledDates: Set<string>;
  paymentRequired: boolean;
  /** 管理者が月1回制限を解除したユーザーか（表示の出し分けのみ。可否の判定はサーバー）。 */
  monthlyExempt?: boolean;
  paymentStatusByDate: Record<string, PokerPaymentStatus | null>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateEntries, setDateEntries] = useState<{ displayName: string; displayStatus?: "paid" | "joined_unpaid" }[]>([]);
  const [dateFull, setDateFull] = useState(false);
  const [dateCount, setDateCount] = useState(0);
  const [dayStandings, setDayStandings] = useState<{ hasResults: boolean; standings: PokerDayStanding[] } | null>(null);
  const today = todayJst();
  const demo = isDevLoginEnabled();

  useEffect(() => {
    if (!selectedDate) {
      setDateEntries([]);
      setDateFull(false);
      setDateCount(0);
      return;
    }
    let alive = true;
    fetch(`/api/poker/entries?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDateEntries(d.entries ?? []);
        setDateFull(!!d.full);
        setDateCount(typeof d.count === "number" ? d.count : (d.entries ?? []).length);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [selectedDate, enteredDates, paymentStatusByDate]);

  useEffect(() => {
    if (!selectedDate || selectedDate >= today) {
      setDayStandings(null);
      return;
    }
    let alive = true;
    fetch(`/api/poker/standings/day?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setDayStandings({ hasResults: !!d.hasResults, standings: d.standings ?? [] });
      })
      .catch(() => {
        if (alive) setDayStandings({ hasResults: false, standings: [] });
      });
    return () => { alive = false; };
  }, [selectedDate, today]);

  async function toggle(date: string, entered: boolean) {
    setBusy(date);
    setPayMsg(null);
    try {
      const res = await fetch(`/api/poker/entries${entered ? `?eventDate=${date}` : ""}`, {
        method: entered ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: entered ? undefined : JSON.stringify({ eventDate: date }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPayMsg(d.message ?? d.error ?? "処理に失敗しました");
      }
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  async function pay(date: string) {
    setBusy(date);
    setPayMsg(null);
    try {
      const r = await startPokerEntryPayment(date);
      window.location.href = r.paymentUrl;
    } catch (e) {
      setPayMsg(e instanceof Error ? e.message : "決済の開始に失敗しました");
      setBusy(null);
    }
  }

  async function confirmCancel(date: string) {
    setBusy(date);
    setPayMsg(null);
    try {
      await cancelPokerEntryPayment(date);
      setCancelDate(null);
      onChanged();
    } catch (e) {
      setPayMsg(e instanceof Error ? e.message : "キャンセルに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  const enteredArr = Array.from(enteredDates).sort();
  // カレンダーを遡れる下限の月（過去の開催日の成績を見るため）。undefined なら当月止まり＝案内も出さない。
  const minMonth = calendarMinMonth(scheduleDates, enteredDates);

  return (
    <div className="flex flex-col gap-4">
      <p className="px-0.5 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
        第1・第3土曜が開催日です。カレンダーの開催日から参加日を選んでください
        {monthlyExempt ? "（同じ月に何度でも参加できます）" : "（参加は1か月に1回）"}。
        {paymentRequired &&
          `「参加する」で参加枠を確保し、参加費 ¥${POKER_ENTRY_FEE.toLocaleString()} のお支払いで確定します（定員${POKER_MAX_ENTRIES_PER_DATE}名）。`}
        参加費のキャンセルは開催7日前まで。開始時刻を過ぎると参加表明・取消はできません。
      </p>

      {payMsg && (
        <GlassCard tone="coral" padding="md">
          <p className="text-[15px] font-bold text-[color:var(--eb-coral-text)]">{payMsg}</p>
        </GlassCard>
      )}

      <GlassCard>
        <MonthCalendar
          value={selectedDate}
          onSelect={setSelectedDate}
          isSelectable={(d) => scheduleDates.has(d)}
          marked={(d) => enteredDates.has(d)}
          minMonth={minMonth}
          variant="game"
        />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[color:var(--eb-ink-muted)]">
          <span>○ 開催日</span>
          <span>◎ 参加確定</span>
          <span>● 選んだ日</span>
        </div>
        {canBrowsePastMonths(minMonth, today) && (
          <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            「‹」で前の月に戻ると、その日の対戦結果を確認できます。
          </p>
        )}
      </GlassCard>

      {enteredArr.length > 0 && (
        <GlassCard padding="md">
          <div className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">あなたの参加状況</div>
          <div className="flex flex-col divide-y divide-[color:var(--eb-line)]">
            {enteredArr.map((d) => {
              const cancelled = cancelledDates.has(d);
              const st = paymentStatusByDate[d] ?? null;
              const paidLike = !paymentRequired || st === "paid";
              const label = cancelled
                ? "中止（流会）"
                : st === "cancelRequested"
                  ? "返金対応中"
                  : !paymentRequired
                    ? "参加確定"
                    : st === "paid"
                      ? "支払い済み"
                      : "参加確定（未払い）";
              const tone = cancelled ? "coral" : paidLike ? "green" : "gold";
              const { md, wd } = dateParts(d);
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className="flex items-center justify-between gap-2 py-2.5 text-left active:opacity-70"
                >
                  <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">
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
            参加する開催日をカレンダーから選んでください
          </p>
        </GlassCard>
      ) : (
        <SelectedDateCard
          date={selectedDate}
          entered={enteredDates.has(selectedDate)}
          paymentRequired={paymentRequired}
          payStatus={paymentStatusByDate[selectedDate] ?? null}
          cancelled={cancelledDates.has(selectedDate)}
          isPast={selectedDate < today}
          startTime={scheduleTimes?.[selectedDate]?.startTime}
          endTime={scheduleTimes?.[selectedDate]?.endTime}
          dateFull={dateFull}
          busy={busy === selectedDate}
          demo={demo}
          onJoin={() => toggle(selectedDate, false)}
          onLeave={() => toggle(selectedDate, true)}
          onPay={() => pay(selectedDate)}
          onRequestCancel={() => setCancelDate(selectedDate)}
        />
      )}

      {selectedDate && !cancelledDates.has(selectedDate) && selectedDate >= today && (
        <GlassCard>
          <div className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
            この日の参加者（{dateCount} / {POKER_MAX_ENTRIES_PER_DATE}名）
            {dateFull && <span className="ml-1.5 text-[color:var(--eb-gold-text)]">満員</span>}
          </div>
          {dateEntries.length === 0 ? (
            <p className="py-1 text-[15px] text-[color:var(--eb-ink-muted)]">まだ参加者がいません。</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {dateEntries.map((e, i) => {
                const paid = e.displayStatus === "paid";
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="flex-1 min-w-0 truncate text-[15px] font-bold text-[color:var(--eb-ink)]">
                      {e.displayName}
                    </span>
                    <StatusPill tone={paid ? "green" : "gold"}>{paid ? "支払い済み" : "参加済み（未払い）"}</StatusPill>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {selectedDate && !cancelledDates.has(selectedDate) && selectedDate < today && dayStandings && (
        dayStandings.hasResults ? (
          <PokerDayStandings eventDate={selectedDate} standings={dayStandings.standings} />
        ) : (
          <GlassCard>
            <p className="text-center text-[15px] text-[color:var(--eb-ink-muted)]">この日の成績はまだありません。</p>
          </GlassCard>
        )
      )}

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
  entered,
  paymentRequired,
  payStatus,
  cancelled,
  isPast,
  startTime,
  endTime,
  dateFull,
  busy,
  demo,
  onJoin,
  onLeave,
  onPay,
  onRequestCancel,
}: {
  date: string;
  entered: boolean;
  paymentRequired: boolean;
  payStatus: PokerPaymentStatus | null;
  cancelled: boolean;
  isPast: boolean;
  startTime?: string;
  endTime?: string;
  dateFull: boolean;
  busy: boolean;
  demo: boolean;
  onJoin: () => void;
  onLeave: () => void;
  onPay: () => void;
  onRequestCancel: () => void;
}) {
  // 受付締切（開催日の開始時刻）を過ぎたか。締切後は参加表明も取消もできない
  // （「締切までに表明した人＝参加者」なので抜けられると名簿が崩れる。サーバーも409で拒否）。
  const closed = isPast || (!!startTime && Date.now() >= Date.parse(`${date}T${startTime}:00+09:00`));
  const timeLabel = startTime ? `${startTime}${endTime ? `〜${endTime}` : "〜"}` : null;
  const { md, wd } = dateParts(date);
  const heading = (
    <div className="flex items-baseline gap-2">
      <span className="text-[20px] font-bold text-[color:var(--eb-ink)]">
        {md}（{wd}）
      </span>
      <span className="text-[15px] text-[color:var(--eb-ink-muted)]">
        ポーカー{timeLabel && <span className="ml-1.5 tabular-nums">{timeLabel}</span>}
      </span>
    </div>
  );

  // 中止（流会）
  if (cancelled) {
    return (
      <GlassCard tone="coral">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="coral" className="self-start">
            中止（流会）
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            この開催日は中止になりました。
            {entered && "お支払い済みの参加費は返金対応します（担当よりご連絡します）。"}
          </p>
        </div>
      </GlassCard>
    );
  }

  const needsPay = entered && paymentRequired;

  // 返金対応中
  if (needsPay && payStatus === "cancelRequested") {
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

  // 参加確定（支払い済み・または支払い不要）
  if (needsPay ? payStatus === "paid" : entered) {
    return (
      <GlassCard tone="green">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="green" className="self-start">
            ✓ 参加確定{needsPay ? "・支払い済み" : ""}
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            当日はゲーム開始までに会場へお越しください。
          </p>
          {needsPay ? (
            !isPast && (
              <Button variant="secondary" loading={busy} onClick={onRequestCancel}>
                支払いをキャンセルする
              </Button>
            )
          ) : (
            !closed && (
              <Button variant="ghost" loading={busy} onClick={onLeave}>
                参加をやめる
              </Button>
            )
          )}
          {demo && needsPay && (
            <Button variant="ghost" loading={busy} onClick={onLeave}>
              リセット（デモ）
            </Button>
          )}
        </div>
      </GlassCard>
    );
  }

  // 参加確定（未払い）
  if (needsPay) {
    return (
      <GlassCard tone="gold">
        <div className="flex flex-col gap-3">
          {heading}
          <StatusPill tone="gold" className="self-start">
            参加確定（未払い）
          </StatusPill>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
            参加枠を確保しました。当日プレイするには参加費（¥{POKER_ENTRY_FEE.toLocaleString()}）のお支払いが必要です。
          </p>
          <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            <b className="text-[color:var(--eb-ink)]">
              参加費は開催日の開始時刻{timeLabel ? `（${startTime}）` : ""}までにお支払いください。
            </b>
            この種目はゲームマスターを事前に決めないため、
            <b className="text-[color:var(--eb-ink)]">開始時刻で受付が自動的に締め切られます</b>
            。未払いのままだと当日の進行に参加できません（当日その場でお支払いいただければ参加できます）。
          </p>
          <Button variant="pay" loading={busy} onClick={onPay}>
            支払いする ¥{POKER_ENTRY_FEE.toLocaleString()}
          </Button>
          <Button variant="ghost" loading={busy} onClick={onLeave}>
            参加をやめる
          </Button>
        </div>
      </GlassCard>
    );
  }

  // 未参加
  const reasonLabel = isPast ? "終了" : dateFull ? "満員" : "参加できます";
  const reason = isPast ? "この開催日は終了しました" : dateFull ? "満員です（参加者を確認できます）" : "この日に参加できます";
  const canJoinNow = !isPast && !dateFull && !closed;

  return (
    <GlassCard>
      <div className="flex flex-col gap-3">
        {heading}
        <StatusPill tone={canJoinNow ? "green" : "muted"} className="self-start">
          {reasonLabel}
        </StatusPill>
        <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">{reason}</p>
        {canJoinNow && (
          <Button variant="primary" loading={busy} onClick={onJoin}>
            参加する
          </Button>
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
