"use client";

import { useState } from "react";
import {
  MAHJONG_ENTRY_FEE,
  type PublicMahjongTable,
  type MahjongPaymentStatus,
} from "@/types";
import { startEntryPayment, cancelEntryPayment } from "@/lib/mahjongPayment";
import { isDevLoginEnabled } from "@/lib/env";
import MonthCalendar from "@/components/ui/MonthCalendar";
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
  tables,
  paymentRequired,
  paymentStatusByDate,
  onChanged,
}: {
  enteredDates: Set<string>;
  closedDates: Set<string>;
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
  const today = todayJst();
  // DEV-ONLY（develop 専用 / main へ入れない）: 支払い済み/返金対応中からリセットする導線を出す。
  const demo = isDevLoginEnabled();

  async function toggle(date: string, entered: boolean) {
    setBusy(date);
    try {
      await fetch(`/api/mahjong/entries${entered ? `?eventDate=${date}` : ""}`, {
        method: entered ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: entered ? undefined : JSON.stringify({ eventDate: date }),
      });
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

  // 表示中の日の卓（自分の卓のみ ?mine=1 で取得済み）
  const viewTables = viewDate
    ? tables.filter((t) => t.eventDate === viewDate)
    : [];

  // 月1回制御＋土曜のみ。自分の参加日(enteredDates)から選択可否を決める。
  const enteredArr = Array.from(enteredDates);
  const isSat = (dateStr: string) => new Date(`${dateStr}T12:00:00Z`).getUTCDay() === 6;
  const selectable = (dateStr: string) => {
    if (!isSat(dateStr) || dateStr < today) return false;
    if (closedDates.has(dateStr)) return false; // 休催日は選べない
    if (enteredDates.has(dateStr)) return true;
    const ym = dateStr.slice(0, 7);
    return !enteredArr.some((e) => e.slice(0, 7) === ym); // 同月に他の参加があれば不可
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-[#231714]/50 leading-relaxed px-0.5">
        毎週土曜が開催日です。カレンダーから参加日を選んでください（参加は1か月に1回）。
        {paymentRequired && `　参加費 ¥${MAHJONG_ENTRY_FEE.toLocaleString()} は参加後にお支払いください。`}
      </p>
      {payMsg && (
        <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">{payMsg}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <MonthCalendar
          value={selectedDate}
          onSelect={setSelectedDate}
          isSelectable={(d) => selectable(d)}
          marked={(d) => enteredDates.has(d)}
          accent={ACCENT}
        />
      </div>

      {selectedDate ? (
        (() => {
          const entered = enteredDates.has(selectedDate);
          const confirmed = tables.some((t) => t.eventDate === selectedDate);
          const payStatus = paymentStatusByDate[selectedDate] ?? null;
          const needsPay = entered && paymentRequired;
          const { md, wd } = dateParts(selectedDate);
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
                  {confirmed ? "卓が確定しています" : entered ? "参加中" : "この日に参加できます"}
                </div>
              </div>
              {confirmed ? (
                <button onClick={() => setViewDate(selectedDate)} className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold pl-4 pr-3 py-2 active:scale-95 transition-transform" style={{ background: CONFIRM, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}>
                  <CheckIcon />卓確定<ChevronRight size={13} />
                </button>
              ) : needsPay && payStatus === "paid" ? (
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full text-[12.5px] font-extrabold px-3 py-2" style={{ background: "#eef4dd", color: "#6f9023" }}><CheckIcon color="#6f9023" size={13} />支払い済み</span>
                  <button onClick={() => setCancelDate(selectedDate)} className="text-[10.5px] font-bold text-[#231714]/40 underline underline-offset-2">支払いをキャンセル</button>
                  {demo && <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>}
                </div>
              ) : needsPay && payStatus === "cancelRequested" ? (
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className="text-[11px] font-bold text-[#b48f13]">返金対応中</span>
                  {demo && <button onClick={() => toggle(selectedDate, true)} className="text-[10px] font-bold text-[#b48f13] underline underline-offset-2">リセット（デモ）</button>}
                </div>
              ) : needsPay ? (
                <button onClick={() => pay(selectedDate)} disabled={busy === selectedDate} className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform text-white" style={{ background: CONFIRM, boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}>
                  {busy === selectedDate ? "..." : `支払う ¥${MAHJONG_ENTRY_FEE.toLocaleString()}`}
                </button>
              ) : (
                <button onClick={() => toggle(selectedDate, entered)} disabled={busy === selectedDate} className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform" style={entered ? { background: "#eef4ee", color: ACCENT, boxShadow: `inset 0 0 0 1.5px ${ACCENT}` } : { background: ACCENT, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${ACCENT} 40%, transparent)` }}>
                  {entered && busy !== selectedDate && <CheckIcon color={ACCENT} />}
                  {busy === selectedDate ? "..." : entered ? "参加中" : "参加する"}
                </button>
              )}
            </div>
          );
        })()
      ) : (
        <div className="text-center text-[12px] text-[#231714]/40 py-4">参加する土曜日をカレンダーから選んでください</div>
      )}

      {viewDate && viewTables.length > 0 && (
        <TableMembersModal
          date={viewDate}
          tables={viewTables}
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

/* 卓確定の同卓メンバー表示（参加タブから開くボトムシート） */
function TableMembersModal({
  date,
  tables,
  onClose,
}: {
  date: string;
  tables: PublicMahjongTable[];
  onClose: () => void;
}) {
  const sorted = tables
    .slice()
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));
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
          <h3 className="text-base font-bold text-[#1c1f21]">{formatJpDate(date)} の卓</h3>
        </div>
        <p className="text-[11px] text-[#231714]/50 mt-1 mb-4">同卓メンバー</p>

        <div className="flex flex-col gap-4">
          {sorted.map((t) => (
            <div key={t.tableId} className="flex flex-col gap-2">
              {t.round ? (
                <div className="text-[11px] font-bold px-2 py-0.5 rounded-full self-start" style={{ background: "#eef4f5", color: "#5f7a80" }}>
                  第{t.round}回戦
                </div>
              ) : null}
              <TableBoard table={t} />
            </div>
          ))}
        </div>

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
