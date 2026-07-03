"use client";

import { useState, useRef } from "react";
import type { PublicMahjongTable } from "@/types";
import { ACCENT, formatJpDate, CheckIcon, TableBoard } from "@/components/mahjong/leagueShared";

/* ───────── 申告タブ ───────── */

export function ReportTab({
  tables,
  onChanged,
}: {
  tables: PublicMahjongTable[];
  onChanged: () => void;
}) {
  const [reportTable, setReportTable] = useState<PublicMahjongTable | null>(null);

  if (tables.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        まだ卓が組まれていません。<br />
        卓が組まれるとここで申告できます。
      </div>
    );
  }

  const sorted = tables
    .slice()
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate) || (a.round ?? 0) - (b.round ?? 0));

  // 卓確認/申告は「直近の開催日」の半荘だけを対象にする（過去日の完了卓は戦歴側で確認）。
  // これにより進行カウント（全4半荘）が過去日の卓を数えて 5/4 等になる不具合を防ぐ。
  const MAX_HANCHAN = 4;
  const currentDate = sorted[0]?.eventDate;
  const dayTables = sorted.filter((t) => t.eventDate === currentDate);
  const completedHanchan = Math.min(
    dayTables.filter((t) => t.status === "completed").length,
    MAX_HANCHAN
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl bg-[#eef4f5] px-3.5 py-2.5 flex items-center justify-between">
        <div>
          <div className="text-[12px] font-extrabold text-[#40434a]">全{MAX_HANCHAN}半荘制</div>
          <div className="text-[10.5px] text-[#5f7a80] mt-0.5">1半荘ごとに申告すると次の半荘に進みます</div>
        </div>
        <span className="text-[13px] font-black" style={{ color: ACCENT }}>{completedHanchan}/{MAX_HANCHAN} 半荘 完了</span>
      </div>
      {dayTables.map((t) => {
        const me = t.members.find((m) => m.isCurrentUser);
        const reportedCount = t.members.filter((m) => m.points !== null).length;
        const needReport = !!me && me.points === null && t.status !== "completed";
        const reported = !!me && me.points !== null;
        return (
          <div key={t.tableId} className="flex flex-col gap-3">
            {/* ヘッダー */}
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-extrabold text-[#231714]">{formatJpDate(t.eventDate)}</span>
              {t.round ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef4f5", color: "#5f7a80" }}>
                  第{t.round}半荘
                </span>
              ) : null}
              <span className="flex-1" />
              <span className="text-[11px] font-bold" style={{ color: reportedCount === 4 ? "#6f9023" : "#97999d" }}>
                {reportedCount}/4人 申告
              </span>
            </div>

            {/* 緑フェルトの卓 */}
            <TableBoard table={t} />

            {/* アクション */}
            {t.status === "completed" ? (
              <div className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-bold" style={{ background: "#eef4dd", color: "#6f9023" }}>
                <CheckIcon color="#6f9023" size={16} />確定済み
              </div>
            ) : needReport ? (
              <button
                onClick={() => setReportTable(t)}
                className="w-full py-3 rounded-2xl text-[14px] font-extrabold text-white active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5"
                style={{ background: ACCENT }}
              >
                <CheckIcon size={17} />スコアを申告する
              </button>
            ) : reported ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-extrabold" style={{ background: "#eef4dd", color: "#6f9023" }}>
                  <CheckIcon color="#6f9023" size={16} />申告済み — 全員の申告で卓が確定します
                </div>
                <button onClick={() => setReportTable(t)} className="w-full py-2 rounded-xl text-[12px] font-bold text-[#231714]/60 bg-gray-100">
                  申告をやり直す
                </button>
              </div>
            ) : null}
          </div>
        );
      })}

      {reportTable && (
        <ReportModal
          table={reportTable}
          onClose={() => setReportTable(null)}
          onDone={() => {
            setReportTable(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ReportModal({
  table,
  onClose,
  onDone,
}: {
  table: PublicMahjongTable;
  onClose: () => void;
  onDone: () => void;
}) {
  const [points, setPoints] = useState("");
  const [rank, setRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pointsRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setError(null);
    const p = Number(points);
    if (points === "" || !Number.isInteger(p) || p % 100 !== 0) {
      setError("点数は100点単位の整数で入力してください");
      return;
    }
    if (rank === null) {
      setError("順位を選択してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/mahjong/tables/${table.tableId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ points: p, rank }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "申告に失敗しました");
      else onDone();
    } catch {
      setError("申告に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 pb-8 safe-area-pb max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#1c1f21]">スコアを申告</h3>
        <p className="text-[11px] text-[#231714]/50 mt-1 mb-5">
          同卓4人の合計が100,000点になると自動で確定します。
        </p>

        <label className="block text-[11px] font-extrabold text-[#97999d] tracking-[0.04em] mb-2">最終持ち点</label>
        <div
          className="flex items-baseline gap-2 pb-1.5"
          style={{ borderBottom: `2px solid ${points ? ACCENT : "#e4e7e9"}` }}
        >
          <input
            ref={pointsRef}
            type="number"
            inputMode="numeric"
            step={100}
            autoFocus
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") pointsRef.current?.blur();
            }}
            placeholder="25000"
            className="flex-1 w-full border-0 outline-none bg-transparent font-black text-[#1c1f21] tabular-nums"
            style={{ fontSize: "30px" }}
          />
          <span className="text-[14px] font-bold text-[#97999d]">点</span>
        </div>
        <div className="text-[11px] text-[#97999d] mt-1.5">100点単位で入力（同卓4人の合計が100,000点）。</div>

        <label className="block text-[11px] font-extrabold text-[#97999d] tracking-[0.04em] mt-5 mb-2">卓内順位</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setRank(n)}
              className="flex-1 py-3 rounded-xl text-[16px] font-black transition-all"
              style={
                rank === n
                  ? { background: ACCENT, color: "#fff", boxShadow: `0 3px 10px color-mix(in srgb, ${ACCENT} 40%, transparent)` }
                  : { background: "#f6f8f9", color: "#40434a", boxShadow: "inset 0 0 0 1px #e4e7e9" }
              }
            >
              {n}<span className="text-[11px]">着</span>
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-bold text-[#40434a] bg-white rounded-2xl"
            style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="flex-1 py-3 text-sm font-extrabold text-white rounded-2xl active:scale-[0.98] disabled:opacity-50"
            style={{ background: ACCENT }}
          >
            {busy ? "送信中..." : "申告する"}
          </button>
        </div>
      </div>
    </div>
  );
}
