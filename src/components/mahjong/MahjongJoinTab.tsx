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
import { Avatar } from "@/components/ui/LineContact";
import {
  ACCENT,
  CONFIRM,
  dateParts,
  formatJpDate,
  todayJst,
  CheckIcon,
  ChevronRight,
  TableBoard,
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
  // 卓確定の同卓メンバーを表示する対象日
  const [viewDate, setViewDate] = useState<string | null>(null);
  // 参加費のエラー表示／キャンセル確認対象日
  const [payMsg, setPayMsg] = useState<string | null>(null);
  const [cancelDate, setCancelDate] = useState<string | null>(null);
  // カレンダーで選択中の開催日（土曜）
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // 選択日の参加者一覧（仮予約/確定を区別して表示・内部IDは持たない）
  const [dateEntries, setDateEntries] = useState<{ displayName: string; status?: string }[]>([]);
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
      return;
    }
    let alive = true;
    fetch(`/api/mahjong/entries?eventDate=${selectedDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (alive) setDateEntries(d.entries ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [selectedDate, enteredDates, paymentStatusByDate]);
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

  // 月1回制御＋土曜のみ。実効の参加日集合（楽観差分込み）から選択可否を決める。
  const enteredArr = Array.from(effectiveEntered);
  const isSat = (dateStr: string) => new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 6;
  const selectable = (dateStr: string) => {
    // 参加済みの日は曜日・過去に関わらず常に選べる（詳細確認・取消のため）。
    if (effectiveEntered.has(dateStr)) return true;
    if (!isSat(dateStr) || dateStr < today) return false;
    if (closedDates.has(dateStr)) return false; // 休催日は選べない
    if (cancelledDates.has(dateStr)) return false; // 人数不足で中止の日は選べない
    const ym = dateStr.slice(0, 7);
    return !enteredArr.some((e) => e.slice(0, 7) === ym); // 同月に他の参加があれば不可
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#231714]/50 leading-relaxed px-0.5">
        毎週土曜が開催日です。カレンダーから参加日を選んでください（参加は1か月に1回）。
        {paymentRequired && `　参加ボタンで仮予約→決済で参加確定。参加費 ¥${MAHJONG_ENTRY_FEE.toLocaleString()}。`}
        {`　${MAHJONG_CANCEL_POLICY}`}
      </p>
      {payMsg && (
        <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">{payMsg}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <MonthCalendar
          value={selectedDate}
          onSelect={setSelectedDate}
          isSelectable={(d) => selectable(d)}
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
              const conf = !paymentRequired || st === "paid";
              const label = cancelled
                ? "中止（人数不足）"
                : conf
                  ? "参加確定"
                  : st === "cancelRequested"
                    ? "返金対応中"
                    : "仮予約（未決済）";
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
                        : conf
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
          const isConfirmed = entered && (!paymentRequired || payStatus === "paid");
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
            <div
              className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3 px-4 py-3"
              style={{ boxShadow: `inset 0 0 0 1.5px ${confirmed ? CONFIRM : entered ? ACCENT : "#eceff1"}` }}
            >
              <div className="w-[50px] text-center shrink-0">
                <div className="text-[19px] font-black text-[#231714] tabular-nums leading-none">{md}</div>
                <div className="text-[11px] text-[#231714]/40 mt-0.5">{wd}</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14.5px] font-extrabold text-[#231714]">リーグ戦（土曜）</div>
                <div className="text-[12px] text-[#231714]/50 mt-0.5">
                  {confirmed
                    ? "卓が確定しています"
                    : !entered
                      ? "この日に参加できます"
                      : isConfirmed
                        ? "参加確定"
                        : payStatus === "cancelRequested"
                          ? "返金対応中"
                          : "仮予約（未決済）"}
                </div>
              </div>
              {confirmed ? (
                <button onClick={() => setViewDate(selectedDate)} className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold pl-4 pr-3 py-2 active:scale-95 transition-transform" style={{ background: CONFIRM, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}>
                  <CheckIcon />卓確定<ChevronRight size={13} />
                </button>
              ) : needsPay && payStatus === "paid" ? (
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full text-[12.5px] font-extrabold px-3 py-2" style={{ background: "#eef4dd", color: "#6f9023" }}><CheckIcon color="#6f9023" size={13} />参加確定</span>
                  {canCancelMahjong(selectedDate) ? (
                    <button onClick={() => setCancelDate(selectedDate)} className="text-[10.5px] font-bold text-[#231714]/40 underline underline-offset-2">支払いをキャンセル</button>
                  ) : (
                    <span className="text-[10px] text-[#97999d]">キャンセル期限切れ（{MAHJONG_CANCEL_DEADLINE_DAYS}日前まで）</span>
                  )}
                  {demo && <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>}
                </div>
              ) : needsPay && payStatus === "cancelRequested" ? (
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className="text-[11px] font-bold text-[#b48f13]">返金対応中</span>
                  {demo && <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>}
                </div>
              ) : needsPay ? (
                // 仮予約（未決済）: 支払い＋いつでも解除可（返金なし）。別日を選び直せる。
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <button onClick={() => pay(selectedDate)} disabled={busy === selectedDate} className="inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform text-white" style={{ background: CONFIRM, boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}>
                    {busy === selectedDate ? "..." : `支払いする ¥${MAHJONG_ENTRY_FEE.toLocaleString()}`}
                  </button>
                  <button onClick={() => toggle(selectedDate, true)} className="text-[10.5px] font-bold text-[#231714]/40 underline underline-offset-2">キャンセルして別日を選ぶ</button>
                </div>
              ) : entered ? (
                // 支払い不要（staff等）＝参加確定。いつでも解除可。
                <button onClick={() => toggle(selectedDate, true)} className="shrink-0 text-[11px] font-bold text-[#231714]/40 underline underline-offset-2">参加をやめる</button>
              ) : (
                <button onClick={() => toggle(selectedDate, false)} disabled={busy === selectedDate} className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform" style={{ background: ACCENT, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${ACCENT} 40%, transparent)` }}>
                  {busy === selectedDate ? "..." : "参加する"}
                </button>
              )}
            </div>
          );
        })()
      ) : (
        <div className="text-center text-[12px] text-[#231714]/40 py-4">参加する土曜日をカレンダーから選んでください</div>
      )}

      {/* この日の参加者（仮予約/確定） */}
      {selectedDate && dateEntries.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[11px] font-extrabold text-[#97999d] mb-2">この日の参加者（{dateEntries.length}名）</div>
          <div className="flex flex-col gap-1.5">
            {dateEntries.map((e, i) => {
              const conf = e.status === "paid";
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[12.5px] font-bold text-[#1c1f21] flex-1 min-w-0 truncate">{e.displayName}</span>
                  <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full" style={conf ? { background: "#eef4dd", color: "#6f9023" } : { background: "#fdf4e3", color: "#b48f13" }}>
                    {conf ? "確定" : "仮予約"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {viewDate && (
        <TableMembersModal
          date={viewDate}
          onClose={() => setViewDate(null)}
        />
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

/* 卓確定の卓組み表示（参加タブから開くボトムシート）。
   初回の卓組み（round1）のスナップショット＝A/B両卓＋抜け番（待機）を表示する。
   ?mine=1 の tables は自分の卓・全ラウンドのため使わず、専用APIから取得する。 */
interface SnapshotWaiter { displayName: string; pictureUrl?: string; isMe: boolean }
function TableMembersModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [tables, setTables] = useState<PublicMahjongTable[]>([]);
  const [waiting, setWaiting] = useState<SnapshotWaiter[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/mahjong/day/snapshot?eventDate=${date}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        setTables(d.tables ?? []);
        setWaiting(d.waiting ?? []);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [date]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 safe-area-pb max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[12px] font-extrabold px-2.5 py-1 rounded-full" style={{ background: "#f6efd8", color: CONFIRM }}>
            <CheckIcon color={CONFIRM} size={13} />卓確定
          </span>
          <h3 className="text-base font-bold text-[#1c1f21]">{formatJpDate(date)} の卓組み</h3>
        </div>
        <p className="text-[11px] text-[#231714]/50 mt-1 mb-4">初回の卓組み（A卓・B卓）と抜け番</p>

        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : tables.length === 0 ? (
          <div className="py-8 text-center text-sm text-[#231714]/40">卓はまだ組まれていません。</div>
        ) : (
          <div className="flex flex-col gap-4">
            {tables.map((t) => (
              <TableBoard key={t.tableId} table={t} />
            ))}

            {waiting.length > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-[#fafafa] p-3.5">
                <div className="text-[11px] font-extrabold text-[#97999d] mb-2">抜け番（待機）</div>
                <div className="flex flex-col gap-1.5">
                  {waiting.map((w, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12.5px]">
                      <Avatar src={w.pictureUrl} name={w.displayName} size={22} />
                      <span className="font-bold text-[#1c1f21]">
                        {w.displayName}
                        {w.isMe && <span className="ml-1 text-[10px] text-[#5f7a80]">（あなた）</span>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-5 w-full py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl"
          style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}
        >
          閉じる
        </button>
      </div>
    </div>
  );
}
