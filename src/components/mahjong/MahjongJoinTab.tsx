"use client";

import { useState } from "react";
import {
  MAHJONG_MAX_ENTRIES_PER_DATE,
  MAHJONG_ENTRY_FEE,
  type PublicMahjongTable,
  type MahjongScheduleEntry,
  type MahjongPaymentStatus,
} from "@/types";
import { startEntryPayment, cancelEntryPayment } from "@/lib/mahjongPayment";
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
  schedule,
  enteredDates,
  entryCountByDate,
  tables,
  paymentRequired,
  paymentStatusByDate,
  onChanged,
}: {
  schedule: MahjongScheduleEntry[];
  enteredDates: Set<string>;
  entryCountByDate: Record<string, number>;
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
  const today = todayJst();

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
        // Square 決済ページへ同一 webview で遷移（戻りは /games/mahjong?mjpay=... で確定）
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

  if (schedule.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        開催予定がまだ登録されていません
      </div>
    );
  }

  // 表示中の日の卓（自分の卓のみ ?mine=1 で取得済み）
  const viewTables = viewDate
    ? tables.filter((t) => t.eventDate === viewDate)
    : [];

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[12px] text-[#231714]/50 leading-relaxed px-0.5">
        参加したい開催日に表明してください。卓組みは当日、管理者が確定します。
        {paymentRequired && `　参加費 ¥${MAHJONG_ENTRY_FEE.toLocaleString()} は参加確定後にお支払いください（期限＝開催当日の開始時刻）。`}
      </p>
      {payMsg && (
        <div className="text-[12px] font-bold text-[#d8533a] bg-[#fdece8] rounded-xl px-3 py-2">
          {payMsg}
        </div>
      )}
      {schedule.map((s) => {
        const entered = enteredDates.has(s.date);
        const past = s.date < today;
        // その日に自分が含まれる卓があれば「卓確定」
        const confirmed = tables.some((t) => t.eventDate === s.date);
        const { md, wd } = dateParts(s.date);
        const highlight = !past && (confirmed || entered);
        const count = entryCountByDate[s.date] ?? 0;
        const full = !entered && count >= MAHJONG_MAX_ENTRIES_PER_DATE;
        // WP3: 参加確定（先着8名入り）した支払い要(member/guest)は即「支払う」導線へ。
        // 支払い期限（開催当日の開始時刻）はサーバー側 /api/mahjong/entries/pay が判定する。
        const payStatus = paymentStatusByDate[s.date] ?? null;
        const needsPay = entered && paymentRequired;
        return (
          <div
            key={s.scheduleId}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center gap-3 px-4 py-3"
            style={highlight ? { boxShadow: `inset 0 0 0 1.5px ${confirmed ? CONFIRM : ACCENT}` } : undefined}
          >
            <div className="w-[50px] text-center shrink-0">
              <div className="text-[19px] font-black text-[#231714] tabular-nums leading-none">{md}</div>
              <div className="text-[11px] text-[#231714]/40 mt-0.5">{wd}</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14.5px] font-extrabold text-[#231714]">リーグ戦</div>
              <div className="text-[12px] text-[#231714]/50 mt-0.5">
                {s.startTime}〜{s.endTime}
                {!past && !confirmed && (
                  <span className={`ml-2 ${full ? "text-[#d8533a] font-bold" : ""}`}>
                    参加 {count}/{MAHJONG_MAX_ENTRIES_PER_DATE}
                    {full ? "・満員" : ""}
                  </span>
                )}
              </div>
            </div>
            {past ? (
              <span className="text-[11px] text-[#231714]/30 font-bold shrink-0">終了</span>
            ) : confirmed ? (
              // 卓確定: タップで同卓メンバーを表示
              <button
                onClick={() => setViewDate(s.date)}
                className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold pl-4 pr-3 py-2 active:scale-95 transition-transform"
                style={{ background: CONFIRM, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}
              >
                <CheckIcon />卓確定
                <ChevronRight size={13} />
              </button>
            ) : needsPay && payStatus === "paid" ? (
              // 支払い済み: バッジ＋キャンセル依頼
              <div className="shrink-0 flex flex-col items-end gap-1">
                <span className="inline-flex items-center gap-1 rounded-full text-[12.5px] font-extrabold px-3 py-2" style={{ background: "#eef4dd", color: "#6f9023" }}>
                  <CheckIcon color="#6f9023" size={13} />支払い済み
                </span>
                <button
                  onClick={() => setCancelDate(s.date)}
                  className="text-[10.5px] font-bold text-[#231714]/40 underline underline-offset-2"
                >
                  支払いをキャンセル
                </button>
              </div>
            ) : needsPay && payStatus === "cancelRequested" ? (
              <span className="shrink-0 text-[11px] font-bold text-[#b48f13]">返金対応中</span>
            ) : needsPay ? (
              // 未払い（当日）: 参加費を支払う
              <button
                onClick={() => pay(s.date)}
                disabled={busy === s.date}
                className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform text-white"
                style={{ background: CONFIRM, boxShadow: `0 2px 8px color-mix(in srgb, ${CONFIRM} 40%, transparent)` }}
              >
                {busy === s.date ? "..." : `支払う ¥${MAHJONG_ENTRY_FEE.toLocaleString()}`}
              </button>
            ) : (
              <button
                onClick={() => toggle(s.date, entered)}
                disabled={busy === s.date || full}
                className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform"
                style={
                  entered
                    ? { background: "#eef4ee", color: ACCENT, boxShadow: `inset 0 0 0 1.5px ${ACCENT}` } // 参加中（済）
                    : full
                      ? { background: "#f6f8f9", color: "#97999d", boxShadow: "inset 0 0 0 1px #e4e7e9" } // 満員
                      : { background: ACCENT, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${ACCENT} 40%, transparent)` } // 参加する（CTA）
                }
              >
                {entered && busy !== s.date && <CheckIcon color={ACCENT} />}
                {busy === s.date ? "..." : entered ? "参加中" : full ? "満員" : "参加する"}
              </button>
            )}
          </div>
        );
      })}

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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
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
        <p className="text-[11px] text-[#231714]/50 mt-1 mb-4">同卓メンバー（席順：東→南→西→北）</p>

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
