"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { PublicMahjongTable, MahjongDaySwap } from "@/types";
import { isDevLoginEnabled } from "@/lib/env";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { ACCENT, todayJst, CheckIcon, TableBoard } from "@/components/mahjong/leagueShared";
import { upcomingSaturdayJst } from "@/lib/date";
import { BottomSheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/LineContact";

/* ───────── 申告タブ ───────── */

export function ReportTab({ onChanged }: { tables?: PublicMahjongTable[]; onChanged: () => void }) {
  // 当日進行（自動卓組み・抜け番）。本番=自己申告、デモ=ダミー自動補完。UIは共通。
  return <RotationView onChanged={onChanged} />;
}

function ReportModal({
  table,
  onClose,
  onDone,
  onSubmit,
}: {
  table: PublicMahjongTable;
  onClose: () => void;
  onDone: (data?: { swap?: MahjongDaySwap | null }) => void;
  /** 差し替え送信（デモ抜け番は自分の順位を当日進行APIへ渡す）。指定時は既定の申告APIを使わない。 */
  onSubmit?: (points: number, rank: number) => Promise<void>;
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
      if (onSubmit) {
        await onSubmit(p, rank); // 差し替え（デモ抜け番）。閉じるは呼び出し側。
        return;
      }
      const res = await fetch(`/api/mahjong/tables/${table.tableId}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ points: p, rank }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "申告に失敗しました");
      else onDone(data);
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

/* ───────── デモ: 抜け番の当日進行ビュー（dev-only） ───────── */

/** 公開整形済み（内部lineUserIdは持たない）。 */
interface DayMember {
  displayName: string;
  pictureUrl?: string;
  isMe?: boolean;
}
interface DayResp {
  round: number;
  waiting: DayMember[];
  lastSwap: MahjongDaySwap | null;
  tables: PublicMahjongTable[];
}

function RotationView({ onChanged }: { onChanged: () => void }) {
  const demo = isDevLoginEnabled();
  // デモは開催日（直近の土曜）を対象にする＝シードの当日卓と一致。本番は当日(=開催日)。
  const eventDate = demo ? upcomingSaturdayJst() : todayJst();
  const [day, setDay] = useState<DayResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reportTable, setReportTable] = useState<PublicMahjongTable | null>(null);
  const [swap, setSwap] = useState<MahjongDaySwap | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/mahjong/day?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setDay(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => {
    load();
  }, [load]);
  // 他ユーザーの申告・進行を追従（12秒ポーリング＋復帰時）
  useAutoRefresh(load, 12000);

  const advance = useCallback(
    async (myRank?: number) => {
      setBusy(true);
      try {
        const res = await fetch("/api/mahjong/day", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ eventDate, myRank }),
        });
        const data = await res.json().catch(() => ({}));
        setReportTable(null);
        // 先に卓を最新化してから「次の卓」モーダルを出す（新A/B卓を正しく表示）。
        await load();
        if (data?.swap) setSwap(data.swap);
        onChanged();
      } finally {
        setBusy(false);
      }
    },
    [eventDate, load, onChanged]
  );

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!day || day.tables.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center text-sm text-[#231714]/40">
        まだ卓が組まれていません。
      </div>
    );
  }

  const myTable = day.tables.find((t) => t.members.some((m) => m.isCurrentUser)) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl bg-[#eef4f5] px-3.5 py-2.5 flex items-center justify-between">
        <div>
          <div className="text-[12px] font-extrabold text-[#40434a]">第{day.round}半荘・抜け番あり</div>
          <div className="text-[10.5px] text-[#5f7a80] mt-0.5">半荘ごとに自動で卓を組み直します</div>
        </div>
        <span className="text-[12px] font-black" style={{ color: myTable ? ACCENT : "#c0563c" }}>{myTable ? "対戦中" : "待機中"}</span>
      </div>

      {myTable ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-extrabold text-[#231714]">{myTable.tableLabel}卓</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef4f5", color: "#5f7a80" }}>第{day.round}半荘</span>
          </div>
          <TableBoard table={myTable} />
          <button
            onClick={() => setReportTable(myTable)}
            className="w-full py-3 rounded-2xl text-[14px] font-extrabold text-white active:scale-[0.98] transition-transform inline-flex items-center justify-center gap-1.5"
            style={{ background: ACCENT }}
          >
            <CheckIcon size={17} />スコアを申告する
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-[13px] font-extrabold text-[#231714]">今回は待機（抜け番）です</div>
          <div className="text-[11px] text-[#231714]/50 mt-1 mb-3">
            {demo ? "この半荘を進めると、次の卓で交代・INします" : "対戦中の卓が終わると、次の半荘で交代・INします"}
          </div>
          {demo && (
            <button
              onClick={() => advance()}
              disabled={busy}
              className="w-full py-3 rounded-2xl text-[14px] font-extrabold text-white disabled:opacity-50"
              style={{ background: ACCENT }}
            >
              {busy ? "進行中..." : "この半荘を進める（デモ）"}
            </button>
          )}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3.5">
        <div className="text-[11px] font-extrabold text-[#97999d] mb-2">待機順（先頭が次にIN）</div>
        {day.waiting.length === 0 ? (
          <div className="text-[11px] text-[#231714]/40">待機者はいません</div>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {day.waiting.map((w, i) => (
              <li key={i} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-5 text-[#97999d] font-bold tabular-nums">{i + 1}</span>
                <Avatar src={w.pictureUrl} name={w.displayName} size={22} />
                <span className="font-bold text-[#1c1f21]">
                  {w.displayName}
                  {w.isMe && <span className="ml-1 text-[10px] text-[#5f7a80]">（あなた）</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {reportTable &&
        (demo ? (
          <ReportModal table={reportTable} onClose={() => setReportTable(null)} onDone={() => {}} onSubmit={(_p, r) => advance(r)} />
        ) : (
          <ReportModal
            table={reportTable}
            onClose={() => setReportTable(null)}
            onDone={(data) => {
              setReportTable(null);
              // 先に卓を最新化してから「次の卓」モーダルを出す。
              load().then(() => {
                if (data?.swap) setSwap(data.swap);
              });
              onChanged();
            }}
          />
        ))}
      {swap && <SwapSheet swap={swap} tables={day.tables} onClose={() => setSwap(null)} />}
    </div>
  );
}

/** 「次の卓はこちらです」: 次半荘のA卓/B卓と各卓のメンバー（あなた・新加入INを強調）を表示。 */
function SwapSheet({ swap, tables, onClose }: { swap: MahjongDaySwap; tables: PublicMahjongTable[]; onClose: () => void }) {
  const inNames = new Set(swap.in.map((p) => p.displayName));
  return (
    <BottomSheet open title="次の卓はこちらです" onClose={onClose} dismissible={false} closeButton={false}>
      <p className="text-[12px] text-[#231714]/60 mb-3">第{swap.round}半荘が確定。抜け番で卓を組み直しました。下の卓に着席してください。</p>
      {swap.reason && (
        <div className="mb-3 rounded-xl bg-[#fdf4e3] px-3 py-2 text-[12px] font-bold text-[#b48f13]">{swap.reason}</div>
      )}
      <div className="flex flex-col gap-2.5">
        {tables.map((t) => (
          <div key={t.tableId} className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] font-extrabold text-[#231714]">{t.tableLabel}卓</span>
              <span className="text-[10px] text-[#97999d]">{t.members.length}名</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {t.members.map((m, i) => {
                const isNew = inNames.has(m.displayName);
                return (
                  <div key={i} className="flex items-center gap-1.5 min-w-0">
                    <Avatar src={m.pictureUrl} name={m.displayName} size={22} />
                    <span className={`text-[12px] font-bold truncate ${m.isCurrentUser ? "text-[#2f7d57]" : "text-[#1c1f21]"}`}>{m.displayName}</span>
                    {m.isCurrentUser && <span className="shrink-0 text-[9px] font-black text-[#2f7d57]">あなた</span>}
                    {isNew && !m.isCurrentUser && <span className="shrink-0 text-[9px] font-black px-1 rounded" style={{ color: "#6f9023", background: "#eef4dd" }}>IN</span>}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {swap.out.length > 0 && (
        <div className="mt-3 text-[11px] text-[#c0563c]">
          <span className="font-extrabold">退席（抜け番）:</span> {swap.out.map((p) => p.displayName).join("、")}
        </div>
      )}
      <button onClick={onClose} className="mt-5 w-full py-3 rounded-2xl text-sm font-extrabold text-white" style={{ background: ACCENT }}>
        次の卓へ
      </button>
    </BottomSheet>
  );
}
