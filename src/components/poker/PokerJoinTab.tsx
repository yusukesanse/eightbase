"use client";

import { useState, useEffect } from "react";
import MonthCalendar from "@/components/ui/MonthCalendar";
import { isDevLoginEnabled } from "@/lib/env";
import { startPokerEntryPayment, cancelPokerEntryPayment } from "@/lib/pokerPayment";
import { POKER_ENTRY_FEE, POKER_MAX_ENTRIES_PER_DATE, type PokerPaymentStatus } from "@/types/poker";
import { PokerDayStandings, type PokerDayStanding } from "@/components/poker/PokerDayStandings";
import { POKER_ACCENT, POKER_CONFIRM, dateParts, formatJpDate, todayJst, CheckIcon } from "@/components/poker/pokerShared";

/**
 * ポーカー 参加タブ（ダーツ/ビリヤードの JoinTab の読み替え）。
 * 開催日は管理登録の `pokerSchedule`（第1・第3土曜）のみ選択可。参加費 ¥1,000・定員9名・月1回。
 */
export function PokerJoinTab({
  enteredDates,
  scheduleDates,
  cancelledDates,
  paymentRequired,
  paymentStatusByDate,
  onChanged,
}: {
  enteredDates: Set<string>;
  scheduleDates: Set<string>;
  cancelledDates: Set<string>;
  paymentRequired: boolean;
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#231714]/85 leading-relaxed px-0.5">
        第1・第3土曜が開催日です（13:00〜18:00）。カレンダーの開催日から参加日を選んでください（参加は1か月に1回）。
        {paymentRequired &&
          `　「参加する」で参加枠を確保し、参加費 ¥${POKER_ENTRY_FEE.toLocaleString()} のお支払いで確定します（定員${POKER_MAX_ENTRIES_PER_DATE}名）。`}
        　キャンセルは開催7日前まで。
      </p>
      {payMsg && <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">{payMsg}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <MonthCalendar
          value={selectedDate}
          onSelect={setSelectedDate}
          isSelectable={(d) => scheduleDates.has(d)}
          marked={(d) => enteredDates.has(d)}
          accent={POKER_ACCENT}
        />
      </div>

      {enteredArr.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[11px] font-extrabold text-[#3f4247] mb-1">あなたの参加状況</div>
          <div className="flex flex-col divide-y divide-gray-100">
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
              const { md, wd } = dateParts(d);
              const active = selectedDate === d;
              return (
                <button key={d} onClick={() => setSelectedDate(d)} className="flex items-center justify-between gap-2 py-2.5 text-left active:opacity-70">
                  <span className="text-[13px] font-bold text-[#231714]">
                    {md}（{wd}）{active && <span className="ml-1 text-[10px] text-[#4f757e]">▼</span>}
                  </span>
                  <span
                    className="shrink-0 text-[10.5px] font-extrabold px-2 py-0.5 rounded-full"
                    style={
                      cancelled
                        ? { background: "#fdeede", color: "#a1502c" }
                        : paidLike
                          ? { background: "#eef4dd", color: "#6f9023" }
                          : { background: "#fdf4e3", color: "#b48f13" }
                    }
                  >
                    {label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedDate ? (
        (() => {
          const entered = enteredDates.has(selectedDate);
          const payStatus = paymentStatusByDate[selectedDate] ?? null;
          const needsPay = entered && paymentRequired;
          const unpaidNotice = needsPay && payStatus !== "paid" && payStatus !== "cancelRequested";
          const isPast = selectedDate < today;
          const { md, wd } = dateParts(selectedDate);

          if (cancelledDates.has(selectedDate)) {
            return (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3 px-4 py-3" style={{ boxShadow: "inset 0 0 0 1.5px #f0c9b0" }}>
                <div className="w-[50px] text-center shrink-0">
                  <div className="text-[19px] font-black text-[#231714] tabular-nums leading-none">{md}</div>
                  <div className="text-[11px] text-[#231714]/80 mt-0.5">{wd}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] font-extrabold text-[#a1502c]">中止（流会）</div>
                  <div className="text-[12px] text-[#231714]/85 mt-0.5">
                    この開催日は中止になりました。
                    {entered && "お支払い済みの参加費は返金対応します（担当よりご連絡します）。"}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-2.5 px-4 py-3" style={{ boxShadow: `inset 0 0 0 1.5px ${entered ? POKER_ACCENT : "#eceff1"}` }}>
                <div className="flex items-center gap-3">
                  <div className="w-[50px] text-center shrink-0">
                    <div className="text-[19px] font-black text-[#231714] tabular-nums leading-none">{md}</div>
                    <div className="text-[11px] text-[#231714]/80 mt-0.5">{wd}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[14.5px] font-extrabold text-[#231714] truncate">ポーカー（土曜 13:00〜）</div>
                    <div className="text-[12px] text-[#231714]/85 mt-0.5 truncate">
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
                    </div>
                  </div>
                  {needsPay && payStatus === "paid" ? (
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full text-[12.5px] font-extrabold px-3 py-2 whitespace-nowrap" style={{ background: "#eef4dd", color: "#6f9023" }}>
                        <CheckIcon color="#6f9023" size={13} />参加確定
                      </span>
                      {!isPast && (
                        <button onClick={() => setCancelDate(selectedDate)} className="text-[10.5px] font-bold text-[#231714]/80 underline underline-offset-2 whitespace-nowrap">
                          支払いをキャンセル
                        </button>
                      )}
                      {demo && (
                        <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>
                      )}
                    </div>
                  ) : needsPay && payStatus === "cancelRequested" ? (
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-[11px] font-bold text-[#b48f13] whitespace-nowrap">返金対応中</span>
                      {demo && (
                        <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>
                      )}
                    </div>
                  ) : needsPay ? null : entered ? (
                    <button onClick={() => toggle(selectedDate, true)} className="shrink-0 text-[11px] font-bold text-[#231714]/80 underline underline-offset-2 whitespace-nowrap">
                      参加をやめる
                    </button>
                  ) : dateFull ? (
                    <span className="shrink-0 inline-flex items-center rounded-full text-[12.5px] font-extrabold px-3 py-2 bg-[#231714]/5 text-[#231714]/80">満員</span>
                  ) : !isPast ? (
                    <button
                      onClick={() => toggle(selectedDate, false)}
                      disabled={busy === selectedDate}
                      className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform whitespace-nowrap"
                      style={{ background: POKER_ACCENT, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${POKER_ACCENT} 40%, transparent)` }}
                    >
                      {busy === selectedDate ? "..." : "参加する"}
                    </button>
                  ) : null}
                </div>

                {unpaidNotice && (
                  <div className="flex items-stretch gap-2">
                    <button
                      onClick={() => pay(selectedDate)}
                      disabled={busy === selectedDate}
                      className="flex-[3] inline-flex items-center justify-center gap-1 rounded-xl text-[13.5px] font-extrabold py-2.5 active:scale-[0.98] disabled:opacity-50 transition-transform text-white whitespace-nowrap"
                      style={{ background: POKER_CONFIRM, boxShadow: `0 2px 8px color-mix(in srgb, ${POKER_CONFIRM} 40%, transparent)` }}
                    >
                      {busy === selectedDate ? "..." : `支払いする ¥${POKER_ENTRY_FEE.toLocaleString()}`}
                    </button>
                    <button
                      onClick={() => toggle(selectedDate, true)}
                      disabled={busy === selectedDate}
                      className="flex-[2] inline-flex items-center justify-center rounded-xl text-[12.5px] font-bold py-2.5 border border-[#231714]/15 text-[#231714]/75 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 transition-transform whitespace-nowrap"
                    >
                      参加をやめる
                    </button>
                  </div>
                )}
              </div>

              {unpaidNotice && (
                <div className="rounded-2xl border px-4 py-3 space-y-2" style={{ background: "#fff9ec", borderColor: "#f0d9a8" }}>
                  <div className="text-[13px] font-extrabold text-[#b48f13]">参加確定（未払い）</div>
                  <p className="text-[12.5px] font-bold text-[#8a6a12] leading-relaxed">
                    参加枠を確保しました。当日プレイするには参加費（¥{POKER_ENTRY_FEE.toLocaleString()}）のお支払いが必要です。開催日までにお支払いください。
                  </p>
                  <p className="text-[12px] text-[#8a6a12]/90 leading-relaxed">
                    未払いのまま当日を迎えると、参加者に含まれません（最初のディーラーの「ゲーム開始」で締め切られます）。
                  </p>
                </div>
              )}
            </>
          );
        })()
      ) : (
        <div className="text-center text-[12px] text-[#231714]/80 py-4">参加する開催日をカレンダーから選んでください</div>
      )}

      {selectedDate && !cancelledDates.has(selectedDate) && selectedDate >= today && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[11px] font-extrabold text-[#3f4247] mb-2">
            この日の参加者（{dateCount} / {POKER_MAX_ENTRIES_PER_DATE}名）
            {dateFull && <span className="ml-1.5 text-[#b48f13]">満員</span>}
          </div>
          {dateEntries.length === 0 ? (
            <div className="text-[12px] text-[#231714]/80 py-2">まだ参加者がいません。</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {dateEntries.map((e, i) => {
                const paid = e.displayStatus === "paid";
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[12.5px] font-bold text-[#1c1f21] flex-1 min-w-0 truncate">{e.displayName}</span>
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={paid ? { background: "#eef4dd", color: "#6f9023" } : { background: "#fdf4e3", color: "#b48f13" }}>
                      {paid ? "支払い済み" : "参加済み（未払い）"}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedDate && !cancelledDates.has(selectedDate) && selectedDate < today && dayStandings && (
        dayStandings.hasResults ? (
          <PokerDayStandings eventDate={selectedDate} standings={dayStandings.standings} />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-6 text-center text-[12px] text-[#231714]/80">
            この日の成績はまだありません。
          </div>
        )
      )}

      {cancelDate && (
        <CancelPayModal date={cancelDate} busy={busy === cancelDate} onConfirm={() => confirmCancel(cancelDate)} onClose={() => setCancelDate(null)} />
      )}
    </div>
  );
}

function CancelPayModal({ date, busy, onConfirm, onClose }: { date: string; busy: boolean; onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 safe-area-pb" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-[#1c1f21]">参加費のキャンセル</h3>
        <p className="text-[12.5px] text-[#231714]/80 mt-2 leading-relaxed">
          {formatJpDate(date)} の参加費のキャンセルを依頼します。<br />
          <span className="font-bold text-[#231714]/90">アプリ内では自動返金されません。</span>
          管理者へ返金依頼の通知が送られ、後日Squareから手動で返金対応します。
        </p>
        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}>
            やめる
          </button>
          <button onClick={onConfirm} disabled={busy} className="flex-1 py-3 text-sm font-extrabold text-white rounded-2xl active:scale-[0.98] disabled:opacity-50" style={{ background: "#d8533a" }}>
            {busy ? "送信中..." : "キャンセルを依頼"}
          </button>
        </div>
      </div>
    </div>
  );
}
