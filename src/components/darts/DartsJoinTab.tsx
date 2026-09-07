"use client";

import { useState, useEffect } from "react";
import MonthCalendar from "@/components/ui/MonthCalendar";
import { calendarMinMonth, canBrowsePastMonths } from "@/lib/gameCalendarRange";
import { isDevLoginEnabled } from "@/lib/env";
import { startDartsEntryPayment, cancelDartsEntryPayment } from "@/lib/dartsPayment";
import { DARTS_ENTRY_FEE, DARTS_MAX_ENTRIES_PER_DATE, type DartsPaymentStatus } from "@/types/darts";
import { DartsDayStandings, type DartsDayStanding } from "@/components/darts/DartsDayStandings";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";
import {
  dateParts,
  formatJpDate,
  todayJst,
} from "@/components/darts/dartsShared";

/**
 * ダーツ 参加タブ（麻雀 MahjongJoinTab の読み替え）。
 * 開催日は管理登録の `dartsSchedule`（隔週木曜）のみ選択可。参加費 ¥1,000・定員8名・月1回。
 * ※ 麻雀と違い「土曜の暗黙ルール」ではなく scheduleDates（開催日集合）で選択可否を決める。
 * ※ ダーツは「参加表明→支払い」の2段階のまま（仕様変更しない）。
 */
export function DartsJoinTab({
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
  paymentStatusByDate: Record<string, DartsPaymentStatus | null>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dateEntries, setDateEntries] = useState<
    { displayName: string; displayStatus?: "paid" | "joined_unpaid" }[]
  >([]);
  const [dateFull, setDateFull] = useState(false);
  const [dateCount, setDateCount] = useState(0);
  // 過去の開催日を選んだときの当日成績（総合順位＋3種目内訳）。麻雀と同じく参加タブで閲覧。
  const [dayStandings, setDayStandings] = useState<{ hasResults: boolean; standings: DartsDayStanding[] } | null>(null);
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
    fetch(`/api/darts/entries?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setDateEntries(d.entries ?? []);
        setDateFull(!!d.full);
        setDateCount(typeof d.count === "number" ? d.count : (d.entries ?? []).length);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedDate, enteredDates, paymentStatusByDate]);

  // 過去の開催日の当日成績を取得（当日・未来は対象外）。
  useEffect(() => {
    if (!selectedDate || selectedDate >= today) {
      setDayStandings(null);
      return;
    }
    let alive = true;
    fetch(`/api/darts/standings/day?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setDayStandings({ hasResults: !!d.hasResults, standings: d.standings ?? [] });
      })
      .catch(() => {
        if (alive) setDayStandings({ hasResults: false, standings: [] });
      });
    return () => {
      alive = false;
    };
  }, [selectedDate, today]);

  async function toggle(date: string, entered: boolean) {
    setBusy(date);
    setPayMsg(null);
    try {
      const res = await fetch(`/api/darts/entries${entered ? `?eventDate=${date}` : ""}`, {
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
      const r = await startDartsEntryPayment(date);
      // Square 決済ページへ同一 webview で遷移（戻りは /games?dartspay=... で確定）
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
      await cancelDartsEntryPayment(date);
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
        隔週木曜が開催日です。カレンダーの開催日から参加日を選んでください{monthlyExempt ? "（同じ月に何度でも参加できます）" : "（参加は1か月に1回）"}。
        {paymentRequired &&
          `「参加する」で参加枠を確保し、参加費 ¥${DARTS_ENTRY_FEE.toLocaleString()} のお支払いで確定します（定員${DARTS_MAX_ENTRIES_PER_DATE}名）。`}
        参加費のキャンセルは開催7日前まで。<b>開始時刻を過ぎると参加表明・取消はできません。</b>
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
            「‹」で前の月に戻れます。過去の開催日を選ぶと、その日の対戦結果（順位）を確認できます。
          </p>
        )}
      </GlassCard>

      {/* あなたの参加状況 */}
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
                  <span className="text-[15px] font-bold text-[color:var(--eb-ink)] whitespace-nowrap shrink-0">
                    {md}（{wd}）
                  </span>
                  <StatusPill tone={tone}>{label}</StatusPill>
                </button>
              );
            })}
          </div>
        </GlassCard>
      )}

      {selectedDate ? (
        (() => {
          const entered = enteredDates.has(selectedDate);
          const payStatus = paymentStatusByDate[selectedDate] ?? null;
          const needsPay = entered && paymentRequired;
          const unpaidNotice = needsPay && payStatus !== "paid" && payStatus !== "cancelRequested";
          const isPast = selectedDate < today;
          // 受付締切（開催日の開始時刻）を過ぎたか。締切後は参加表明も取消もできない
          // （「締切までに表明した人＝参加者」なので抜けられると名簿が崩れる。サーバーも409で拒否）。
          const st = scheduleTimes?.[selectedDate]?.startTime;
          const closed = isPast || (!!st && Date.now() >= Date.parse(`${selectedDate}T${st}:00+09:00`));
          const { md, wd } = dateParts(selectedDate);

          if (cancelledDates.has(selectedDate)) {
            return (
              <GlassCard tone="coral">
                <div className="flex flex-col gap-3">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[20px] font-bold text-[color:var(--eb-ink)]">
                      {md}（{wd}）
                    </span>
                  </div>
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

          return (
            <>
              <GlassCard tone={entered ? "green" : "default"}>
                <div className="flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-[20px] font-bold text-[color:var(--eb-ink)] whitespace-nowrap">
                          {md}（{wd}）
                        </span>
                        <span className="text-[15px] text-[color:var(--eb-ink-muted)] whitespace-nowrap">リーグ戦</span>
                        {selectedDate && scheduleTimes?.[selectedDate]?.startTime && (
                          <span className="text-[13px] font-bold text-[color:var(--eb-ink-muted)] tabular-nums whitespace-nowrap">
                            {scheduleTimes[selectedDate].startTime}
                            {scheduleTimes[selectedDate].endTime ? `〜${scheduleTimes[selectedDate].endTime}` : "〜"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[13px] text-[color:var(--eb-ink-muted)]">
                        {!entered
                          ? isPast
                            ? "この開催日は終了しました"
                            : dateFull
                              ? "満員です（参加者を確認できます）"
                              : "この日に参加できます"
                          : !paymentRequired
                            ? "参加確定"
                            : payStatus === "paid"
                              ? "支払い済み"
                              : payStatus === "cancelRequested"
                                ? "返金対応中"
                                : "参加確定（未払い）"}
                      </p>
                    </div>
                    {needsPay && payStatus === "paid" ? (
                      <StatusPill tone="green" className="shrink-0">
                        参加確定
                      </StatusPill>
                    ) : needsPay && payStatus === "cancelRequested" ? (
                      <StatusPill tone="gold" className="shrink-0">
                        返金対応中
                      </StatusPill>
                    ) : !needsPay && entered ? (
                      <StatusPill tone="green" className="shrink-0">
                        参加確定
                      </StatusPill>
                    ) : dateFull ? (
                      <StatusPill tone="muted" className="shrink-0">
                        満員
                      </StatusPill>
                    ) : null}
                  </div>

                  {needsPay && payStatus === "paid" ? (
                    <div className="flex flex-col gap-2">
                      {!isPast && (
                        <Button
                          variant="secondary"
                          loading={busy === selectedDate}
                          onClick={() => setCancelDate(selectedDate)}
                        >
                          支払いをキャンセル
                        </Button>
                      )}
                      {demo && (
                        <Button variant="ghost" loading={busy === selectedDate} onClick={() => toggle(selectedDate, true)}>
                          リセット（デモ）
                        </Button>
                      )}
                    </div>
                  ) : needsPay && payStatus === "cancelRequested" ? (
                    demo && (
                      <Button variant="ghost" loading={busy === selectedDate} onClick={() => toggle(selectedDate, true)}>
                        リセット（デモ）
                      </Button>
                    )
                  ) : needsPay ? null : entered && !closed ? (
                    <Button variant="ghost" loading={busy === selectedDate} onClick={() => toggle(selectedDate, true)}>
                      参加をやめる
                    </Button>
                  ) : entered || dateFull || closed ? null : (
                    <Button variant="primary" loading={busy === selectedDate} onClick={() => toggle(selectedDate, false)}>
                      参加する
                    </Button>
                  )}
                </div>

                {unpaidNotice && (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button variant="pay" loading={busy === selectedDate} onClick={() => pay(selectedDate)}>
                      参加費 ¥{DARTS_ENTRY_FEE.toLocaleString()} を支払う
                    </Button>
                    <Button variant="ghost" loading={busy === selectedDate} onClick={() => toggle(selectedDate, true)}>
                      参加をやめる
                    </Button>
                  </div>
                )}
              </GlassCard>

              {unpaidNotice && (
                <GlassCard tone="gold" padding="md">
                  <div className="flex flex-col gap-2">
                    <StatusPill tone="gold" className="self-start">
                      参加確定（未払い）
                    </StatusPill>
                    <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
                      参加枠を確保しました。当日プレイするには参加費（¥{DARTS_ENTRY_FEE.toLocaleString()}）のお支払いが必要です。
                    </p>
                    <p className="text-[13px] leading-relaxed text-[color:var(--eb-gold-text)]">
                      <b>参加費は開催日の開始時刻{selectedDate && scheduleTimes?.[selectedDate]?.startTime ? `（${scheduleTimes[selectedDate].startTime}）` : ""}までにお支払いください。</b>
                      この種目はゲームマスターを事前に決めないため、<b>開始時刻で受付が自動的に締め切られます</b>。
                      未払いのままだと当日の進行に参加できません（当日その場でお支払いいただければ参加できます）。
                    </p>
                  </div>
                </GlassCard>
              )}
            </>
          );
        })()
      ) : (
        <GlassCard>
          <p className="text-[15px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            参加する開催日をカレンダーから選んでください
          </p>
        </GlassCard>
      )}

      {/* この日の参加者 */}
      {selectedDate && !cancelledDates.has(selectedDate) && selectedDate >= today && (
        <GlassCard padding="md">
          <div className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)] whitespace-nowrap">
            この日の参加者（{dateCount} / {DARTS_MAX_ENTRIES_PER_DATE}名）
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
                    <span className="flex-1 min-w-0 truncate text-[15px] font-bold text-[color:var(--eb-ink)]">{e.displayName}</span>
                    <StatusPill tone={paid ? "green" : "gold"}>{paid ? "支払い済み" : "参加済み（未払い）"}</StatusPill>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      )}

      {/* 当日成績（過去の開催日のみ）。当日・未来では出さない。 */}
      {selectedDate &&
        !cancelledDates.has(selectedDate) &&
        selectedDate < today &&
        dayStandings &&
        (dayStandings.hasResults ? (
          <DartsDayStandings eventDate={selectedDate} standings={dayStandings.standings} />
        ) : (
          <GlassCard>
            <p className="text-center text-[15px] text-[color:var(--eb-ink-muted)]">この日の成績はまだありません。</p>
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
