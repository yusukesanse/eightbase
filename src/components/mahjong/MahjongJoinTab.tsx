"use client";

import { useState, useEffect, useMemo } from "react";
import {
  MAHJONG_ENTRY_FEE,
  type PublicMahjongTable,
  type MahjongPaymentStatus,
} from "@/types";
import { startEntryPayment, cancelEntryPayment } from "@/lib/mahjongPayment";
import { isDevLoginEnabled } from "@/lib/env";
import { canCancelMahjong, MAHJONG_CANCEL_DEADLINE_DAYS, MAHJONG_CANCEL_POLICY } from "@/lib/date";
import MonthCalendar from "@/components/ui/MonthCalendar";
import {
  isViewableDate,
  isMonthlyBlocked,
  isPastSaturday,
  canJoinDate,
} from "@/lib/mahjongJoinCalendar";
import { MahjongDayStandings, type DayStanding } from "@/components/mahjong/MahjongDayStandings";
import {
  ACCENT,
  CONFIRM,
  dateParts,
  formatJpDate,
  todayJst,
  CheckIcon,
} from "@/components/mahjong/leagueShared";

/* ───────── 参加タブ ───────── */

export function JoinTab({
  enteredDates,
  closedDates,
  cancelledDates,
  tables,
  paymentRequired,
  paymentStatusByDate,
  onChanged,
}: {
  enteredDates: Set<string>;
  closedDates: Set<string>;
  cancelledDates: Set<string>;
  tables: PublicMahjongTable[];
  paymentRequired: boolean;
  paymentStatusByDate: Record<string, MahjongPaymentStatus | null>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // 参加費のエラー表示／キャンセル確認対象日
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  // カレンダーで選択中の開催日（土曜）
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 選択日の参加者一覧（支払い済み/未払いを区別して表示・内部IDは持たない）
  const [dateEntries, setDateEntries] = useState<
    { displayName: string; status?: string; displayStatus?: "paid" | "joined_unpaid" }[]
  >([]);
  // 選択日が満員か（抜け番許容OFFのシーズンで定員8名に達している）。未参加者の新規参加を止める。
  const [dateFull, setDateFull] = useState(false);
  // 参加確定人数 / 定員（capacity=null は抜け番許容シーズン＝上限なし）。ヘッダー「n / 8名」に使う。
  const [dateCount, setDateCount] = useState(0);
  const [dateCapacity, setDateCapacity] = useState<number | null>(null);
  // 当日順位（終了した過去土曜を選んだときだけ取得）。null=未取得/対象外。
  const [dayStandings, setDayStandings] = useState<{
    hasResults: boolean;
    standings: DayStanding[];
    rankingMetric: "average" | "total";
  } | null>(null);
  const today = todayJst();

  // 楽観的UI: 参加/キャンセルを即時反映（サーバー確定を待たず表示）。失敗時はロールバック。
  const [optimistic, setOptimistic] = useState<Record<string, "joined" | "left">>({});
  // サーバーの enteredDates に楽観差分を重ねた「実効の参加日集合」。
  const effectiveEntered = useMemo(() => {
    const s = new Set(enteredDates);
    for (const [d, act] of Object.entries(optimistic)) {
      if (act === "joined") s.add(d);
      else s.delete(d);
    }
    return s;
  }, [enteredDates, optimistic]);
  // サーバー値が楽観差分に追いついたら、その差分を破棄（サーバーを正とする）。
  useEffect(() => {
    setOptimistic((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [d, act] of Object.entries(prev)) {
        const has = enteredDates.has(d);
        if ((act === "joined" && has) || (act === "left" && !has)) {
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
        if (alive) {
          setDateEntries(d.entries ?? []);
          setDateFull(!!d.full);
          setDateCount(typeof d.count === "number" ? d.count : (d.entries ?? []).length);
          setDateCapacity(typeof d.capacity === "number" ? d.capacity : null);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedDate, enteredDates, paymentStatusByDate]);

  // 当日順位: 終了した過去土曜を選んだときだけ取得（当日・未来は対象外）。
  useEffect(() => {
    if (!selectedDate || !isPastSaturday(selectedDate, today)) {
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
  }, [selectedDate, today]);
  // DEV-ONLY（develop 専用 / main へ入れない）: 支払い済み/返金対応中からリセットする導線を出す。
  const demo = isDevLoginEnabled();

  async function toggle(date: string, entered: boolean) {
    setBusy(date);
    setPayMsg(null);
    // 楽観更新: 参加=joined / 取消=left を即時反映。
    setOptimistic((p) => ({ ...p, [date]: entered ? "left" : "joined" }));
    try {
      const res = await fetch(`/api/mahjong/entries${entered ? `?eventDate=${date}` : ""}`, {
        method: entered ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: entered ? undefined : JSON.stringify({ eventDate: date }),
      });
      if (!res.ok) {
        // 失敗したら楽観差分をロールバック。
        setOptimistic((p) => {
          const n = { ...p };
          delete n[date];
          return n;
        });
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
      const r = await startEntryPayment(date);
      if (r.ok) {
        // Square 決済ページへ同一 webview で遷移（戻りは /info?mjpay=... で確定）
        window.location.href = r.paymentUrl;
      } else {
        setPayMsg(r.message);
        setBusy(null);
      }
    } catch {
      setPayMsg("決済の開始に失敗しました");
      setBusy(null);
    }
  }

  async function confirmCancel(date: string) {
    setBusy(date);
    setPayMsg(null);
    try {
      const r = await cancelEntryPayment(date);
      if (!r.ok) setPayMsg(r.message ?? "キャンセルに失敗しました");
      setCancelDate(null);
      onChanged();
    } finally {
      setBusy(null);
    }
  }

  const enteredArr = Array.from(effectiveEntered);
  // カレンダー判定は純関数 mahjongJoinCalendar に集約（過去土曜も閲覧可・参加は未来のみ）。
  const calCtx = { today, enteredDates: effectiveEntered, closedDates, cancelledDates };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#231714]/50 leading-relaxed px-0.5">
        毎週土曜が開催日です。カレンダーから参加日を選んでください（参加は1か月に1回）。
        {paymentRequired && `　「参加する」で参加が確定します（定員8名）。参加費 ¥${MAHJONG_ENTRY_FEE.toLocaleString()} は別途お支払いください。`}
        {`　${MAHJONG_CANCEL_POLICY}`}
      </p>
      {/* 懇親会の常時案内（ON/OFF 不要・費用は実費で参加費に含まない） */}
      <div className="text-[12px] text-[#231714]/70 bg-[#f6f8f4] border border-[#e4ebe0] rounded-xl px-3 py-2 leading-relaxed">
        ※ 参加当日は懇親会があります（費用は実費・参加費には含まれません）
      </div>
      {payMsg && (
        <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">{payMsg}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <MonthCalendar
          value={selectedDate}
          onSelect={setSelectedDate}
          isSelectable={(d) => isViewableDate(d, calCtx)}
          marked={(d) => effectiveEntered.has(d)}
          accent={ACCENT}
        />
      </div>

      {/* あなたの参加状況（カレンダー下） */}
      {enteredArr.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[11px] font-extrabold text-[#97999d] mb-1">あなたの参加状況</div>
          {/* 参加予定日ごとに1行（日付＝左 / 状態＝右）。タップで下の詳細に切替。 */}
          <div className="flex flex-col divide-y divide-gray-100">
            {[...enteredArr].sort().map((d) => {
              const cancelled = cancelledDates.has(d);
              const st = paymentStatusByDate[d] ?? null;
              // paidLike = 支払い済み or 社員（支払い不要）。それ以外は参加確定（未払い）。
              const paidLike = !paymentRequired || st === "paid";
              const label = cancelled
                ? "中止（人数不足）"
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
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className={`flex items-center justify-between gap-2 py-2.5 text-left active:opacity-70 ${active ? "" : ""}`}
                >
                  <span className="text-[13px] font-bold text-[#231714]">
                    {md}（{wd}）{active && <span className="ml-1 text-[10px] text-[#A5C1C8]">▼</span>}
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
          const entered = effectiveEntered.has(selectedDate);
          const confirmed = tables.some((t) => t.eventDate === selectedDate);
          const payStatus = paymentStatusByDate[selectedDate] ?? null;
          const needsPay = entered && paymentRequired;
          // 参加確定・未払い（会員/ゲスト）→ 支払い促しの注意書きを表示。社員・支払い済みには出さない。
          const unpaidNotice = needsPay && payStatus !== "paid" && payStatus !== "cancelRequested";
          // 未参加日: この月に別日で参加確定済みなら新規参加不可（閲覧は可）。
          const monthlyBlocked = !entered && isMonthlyBlocked(selectedDate, effectiveEntered);
          // 終了した過去土曜は参加導線を出さない（閲覧・当日順位のみ）。参加可否は純関数で判定。
          const isPast = isPastSaturday(selectedDate, today);
          const canJoin = canJoinDate(selectedDate, { ...calCtx, full: dateFull });
          const { md, wd } = dateParts(selectedDate);
          // 人数不足で自動中止（流会）になった日は、参加/決済導線を出さず中止の案内にする。
          if (cancelledDates.has(selectedDate)) {
            return (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3 px-4 py-3" style={{ boxShadow: "inset 0 0 0 1.5px #f0c9b0" }}>
                <div className="w-[50px] text-center shrink-0">
                  <div className="text-[19px] font-black text-[#231714] tabular-nums leading-none">{md}</div>
                  <div className="text-[11px] text-[#231714]/40 mt-0.5">{wd}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14.5px] font-extrabold text-[#a1502c]">中止（人数不足）</div>
                  <div className="text-[12px] text-[#231714]/50 mt-0.5">
                    参加者が規定人数に満たなかったため中止になりました。
                    {entered && "お支払い済みの参加費は返金対応します（担当よりご連絡します）。"}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <>
            <div
              className="bg-white rounded-2xl border border-gray-100 shadow-sm flex flex-col gap-2.5 px-4 py-3"
              style={{ boxShadow: `inset 0 0 0 1.5px ${confirmed ? CONFIRM : entered ? ACCENT : "#eceff1"}` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-[50px] text-center shrink-0">
                  <div className="text-[19px] font-black text-[#231714] tabular-nums leading-none">{md}</div>
                  <div className="text-[11px] text-[#231714]/40 mt-0.5">{wd}</div>
                </div>
                <div className="flex-1 min-w-0">
                  {/* truncate で狭幅でも1行維持（折り返さない） */}
                  <div className="text-[14.5px] font-extrabold text-[#231714] truncate">リーグ戦（土曜）</div>
                  <div className="text-[12px] text-[#231714]/50 mt-0.5 truncate">
                    {confirmed
                      ? "卓が確定しています"
                      : !entered
                        ? isPast
                          ? "この開催日は終了しました"
                          : monthlyBlocked
                            ? "今月は別の日に参加確定済みです"
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
                {confirmed ? (
                  // 卓の中身は「卓確認/申告」タブで見る（GM が半荘ごとに組むため、参加タブでの
                  // スナップショット表示は実態とずれる）。ここは確定した事実だけを示す。
                  <span className="shrink-0 inline-flex items-center gap-1 rounded-full text-[12.5px] font-extrabold px-3 py-2" style={{ background: CONFIRM, color: "#fff" }}>
                    <CheckIcon />卓確定
                  </span>
                ) : needsPay && payStatus === "paid" ? (
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="inline-flex items-center gap-1 rounded-full text-[12.5px] font-extrabold px-3 py-2 whitespace-nowrap" style={{ background: "#eef4dd", color: "#6f9023" }}><CheckIcon color="#6f9023" size={13} />参加確定</span>
                    {canCancelMahjong(selectedDate) ? (
                      <button onClick={() => setCancelDate(selectedDate)} className="text-[10.5px] font-bold text-[#231714]/40 underline underline-offset-2 whitespace-nowrap">支払いをキャンセル</button>
                    ) : (
                      <span className="text-[10px] text-[#97999d] whitespace-nowrap">キャンセル期限切れ（{MAHJONG_CANCEL_DEADLINE_DAYS}日前まで）</span>
                    )}
                    {demo && <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>}
                  </div>
                ) : needsPay && payStatus === "cancelRequested" ? (
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span className="text-[11px] font-bold text-[#b48f13] whitespace-nowrap">返金対応中</span>
                    {demo && <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>}
                  </div>
                ) : needsPay ? (
                  // 参加確定・未払いの操作は下の全幅ボタン行に出す（レスポンシブで折り返さない）。
                  null
                ) : entered ? (
                  // 支払い不要（staff等）＝参加確定。いつでも解除可。
                  <button onClick={() => toggle(selectedDate, true)} className="shrink-0 text-[11px] font-bold text-[#231714]/40 underline underline-offset-2 whitespace-nowrap">参加をやめる</button>
                ) : dateFull ? (
                  // 満員（定員8名・抜け番許容OFF）。未参加者は新規参加不可（閲覧は可）。
                  <span className="shrink-0 inline-flex items-center rounded-full text-[12.5px] font-extrabold px-3 py-2 bg-[#231714]/5 text-[#231714]/40">満員</span>
                ) : monthlyBlocked ? (
                  // 当月に別日で参加確定済み（月1回制限）。新規参加ボタンは出さない（閲覧のみ）。
                  <span className="shrink-0 inline-flex items-center rounded-full text-[11px] font-bold px-3 py-2 bg-[#fdf4e3] text-[#b48f13] whitespace-nowrap">今月は参加済み</span>
                ) : canJoin ? (
                  <button onClick={() => toggle(selectedDate, false)} disabled={busy === selectedDate} className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform whitespace-nowrap" style={{ background: ACCENT, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${ACCENT} 40%, transparent)` }}>
                    {busy === selectedDate ? "..." : "参加する"}
                  </button>
                ) : null /* 過去日など参加不可: 参加ボタンは出さない（閲覧・当日順位のみ） */}
              </div>

              {/* 参加確定・未払い: 支払い/取消を全幅の押しやすいボタン行に（レスポンシブでも折り返さない） */}
              {unpaidNotice && (
                <div className="flex items-stretch gap-2">
                  <button
                    onClick={() => pay(selectedDate)}
                    disabled={busy === selectedDate}
                    className="flex-[3] inline-flex items-center justify-center gap-1 rounded-xl text-[13.5px] font-extrabold py-2.5 active:scale-[0.98] disabled:opacity-50 transition-transform text-white whitespace-nowrap"
                    style={{ background: CONFIRM, boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}
                  >
                    {busy === selectedDate ? "..." : `支払いする ¥${MAHJONG_ENTRY_FEE.toLocaleString()}`}
                  </button>
                  <button
                    onClick={() => toggle(selectedDate, true)}
                    disabled={busy === selectedDate}
                    className="flex-[2] inline-flex items-center justify-center rounded-xl text-[12.5px] font-bold py-2.5 border border-[#231714]/15 text-[#231714]/55 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50 transition-transform whitespace-nowrap"
                  >
                    参加をやめる
                  </button>
                </div>
              )}
            </div>

            {/* 参加確定・未払いのときの支払い促し（社員・支払い済みには出さない）。§4.4 の3文案を表示。 */}
            {unpaidNotice && (
              <div className="rounded-2xl border px-4 py-3 space-y-2" style={{ background: "#fff9ec", borderColor: "#f0d9a8" }}>
                <div className="flex items-center gap-1.5">
                  <span className="text-[13px] font-extrabold text-[#b48f13]">参加確定（未払い）</span>
                </div>
                <p className="text-[12.5px] font-bold text-[#8a6a12] leading-relaxed">
                  参加枠を確保しました。当日の卓振り分けには、参加費（¥{MAHJONG_ENTRY_FEE.toLocaleString()}）のお支払いが完了している必要があります。開催日までにお支払いください。
                </p>
                <p className="text-[12px] text-[#8a6a12]/90 leading-relaxed">
                  未払いのまま当日を迎えると、卓の振り分け対象外となります。
                </p>
                <p className="text-[12px] text-[#8a6a12]/80 leading-relaxed">
                  参加するには参加費のお支払いが必要です。お早めに「支払いする」から決済を完了してください。
                </p>
              </div>
            )}
            </>
          );
        })()
      ) : (
        <div className="text-center text-[12px] text-[#231714]/40 py-4">参加する土曜日をカレンダーから選んでください</div>
      )}

      {/* この日の参加者（支払い済み / 参加済み・未払い）。0名でも空状態を表示。
          終了した過去日は当日順位を出すので参加者一覧は隠す。 */}
      {selectedDate && !cancelledDates.has(selectedDate) && !isPastSaturday(selectedDate, today) && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[11px] font-extrabold text-[#97999d] mb-2">
            この日の参加者（{dateCapacity != null ? `${dateCount} / ${dateCapacity}名` : `${dateCount}名`}）
            {dateFull && <span className="ml-1.5 text-[#b48f13]">満員</span>}
          </div>
          {dateEntries.length === 0 ? (
            <div className="text-[12px] text-[#231714]/40 py-2">まだ参加者がいません。</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {dateEntries.map((e, i) => {
                const paid = (e.displayStatus ?? (e.status === "paid" ? "paid" : "joined_unpaid")) === "paid";
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

      {/* 当日順位（終了した過去土曜のみ）。当日・未来では出さない。 */}
      {selectedDate && isPastSaturday(selectedDate, today) && dayStandings && (
        dayStandings.hasResults ? (
          <MahjongDayStandings
            eventDate={selectedDate}
            standings={dayStandings.standings}
            rankingMetric={dayStandings.rankingMetric}
          />
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-6 text-center text-[12px] text-[#231714]/40">
            この日の成績はまだありません。
          </div>
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
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 safe-area-pb"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#1c1f21]">参加費のキャンセル</h3>
        <p className="text-[12.5px] text-[#231714]/60 mt-2 leading-relaxed">
          {formatJpDate(date)} の参加費のキャンセルを依頼します。<br />
          <span className="font-bold text-[#231714]/80">アプリ内では自動返金されません。</span>
          管理者へ返金依頼の通知が送られ、後日Squareから手動で返金対応します。
        </p>
        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl"
            style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}
          >
            やめる
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 py-3 text-sm font-extrabold text-white rounded-2xl active:scale-[0.98] disabled:opacity-50"
            style={{ background: "#d8533a" }}
          >
            {busy ? "送信中..." : "キャンセルを依頼"}
          </button>
        </div>
      </div>
    </div>
  );
}
