"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { PublicMahjongTable, MahjongDaySwap } from "@/types";
import { isDevLoginEnabled } from "@/lib/env";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { todayJst, TableBoard, PointsSignToggle, CheckIcon } from "@/components/mahjong/leagueShared";
import { upcomingSaturdayJst } from "@/lib/date";
import { BottomSheet } from "@/components/ui/Sheet";
import { Avatar } from "@/components/ui/LineContact";
import { Button, GlassCard, StatusPill } from "@/components/ui/eb";
import { MahjongGmAssignPanel } from "@/components/mahjong/MahjongGmAssignPanel";
import { MahjongDayGmBanner } from "@/components/mahjong/MahjongDayGmBanner";

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
  // 持ち点欄は絶対値だけを持ち、符号はトグルで持つ。既定は＋。0点は符号に関わらず0。
  const [sign, setSign] = useState<1 | -1>(1);
  const [rank, setRank] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pointsRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setError(null);
    const abs = Number(points);
    if (points === "" || !Number.isInteger(abs) || abs % 100 !== 0) {
      setError("点数は100点単位の整数で入力してください");
      return;
    }
    if (rank === null) {
      setError("順位を選択してください");
      return;
    }
    const p = abs === 0 ? 0 : sign * abs;
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
        className="w-full max-w-md rounded-t-[28px] p-5 pb-8 safe-area-pb max-h-[90vh] overflow-y-auto"
        style={{ background: "rgba(255,255,255,.96)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[color:var(--eb-line)]" />
        <h3 className="text-[22px] font-bold text-[color:var(--eb-ink)]">スコアを申告</h3>
        <p className="text-[14px] text-[color:var(--eb-ink-muted)] mt-1 mb-5">
          同卓4人の合計が100,000点になると自動で確定します。
        </p>

        <label className="block text-[14px] font-bold text-[color:var(--eb-ink)] mb-2">最終持ち点</label>
        <div className="flex items-center gap-2.5">
          <PointsSignToggle sign={sign} onChange={setSign} />
          <div className="flex flex-1 items-center h-14 rounded-2xl bg-white px-4 border border-[color:var(--eb-line)]">
            <input
              ref={pointsRef}
              type="text"
              inputMode="numeric"
              autoFocus
              value={points}
              onChange={(e) => setPoints(e.target.value.replace(/[^\d]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") pointsRef.current?.blur();
              }}
              placeholder="25000"
              className="flex-1 w-full min-w-0 border-0 outline-none bg-transparent font-bold text-right text-[color:var(--eb-ink)] tabular-nums text-[26px]"
            />
            <span className="ml-2 shrink-0 text-[14px] font-bold text-[color:var(--eb-ink-muted)]">点</span>
          </div>
        </div>
        <div className="text-[12px] text-[color:var(--eb-ink-muted)] mt-1.5">100点単位で入力（同卓4人の合計が100,000点）。マイナス（箱下）は左の「−」を選択。</div>

        <label className="block text-[14px] font-bold text-[color:var(--eb-ink)] mt-5 mb-2">卓内順位</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setRank(n)}
              className="flex-1 h-14 rounded-2xl text-[16px] font-bold transition-all"
              style={
                rank === n
                  ? { background: "var(--eb-green)", color: "#fff" }
                  : { background: "var(--eb-tint)", color: "var(--eb-ink)" }
              }
            >
              {n}<span className="text-[12px]">着</span>
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-[13px] text-[color:var(--eb-coral-text)]">{error}</p>}

        <div className="mt-6 flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            申告する
          </Button>
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
  // 手動卓振り分け（GM）シーズン用
  manualSeason?: boolean;
  isGameMaster?: boolean;
  dayGm?: {
    eligible: boolean;
    needsClaim: boolean;
    implicit: boolean;
    gmDisplayName: string | null;
    isMe: boolean;
    candidates: string[];
  };
  awaitingAssignment?: boolean;
  /** GM が「本日の対局を終了」した日。 */
  finished?: boolean;
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
  // デモ操作（ダミー1名分の代行申告）の結果メッセージ。
  const [stepMsg, setStepMsg] = useState<string | null>(null);

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
        setStepMsg(null);
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

  // デモ: ダミー1名分だけ申告を代行する（GM パネルの申告進捗が1人ずつ増えるのを確認できる）。
  const stepOne = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/mahjong/day", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate, step: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.filled) {
        setStepMsg(
          `${data.filled.tableLabel}卓: ${data.filled.displayName} さんの申告を代行しました。` +
            (data.completedTable ? `（${data.completedTable}卓が確定）` : "")
        );
      } else if (data?.needsSelf) {
        setStepMsg("残りはあなたの申告だけです。「スコアを申告する」から申告してください。");
      } else if (data?.completedTable) {
        setStepMsg(`${data.completedTable}卓を確定しました。`);
      } else {
        setStepMsg("代行できる申告がありません。");
      }
      await load();
      if (data?.swap) setSwap(data.swap);
      onChanged();
    } finally {
      setBusy(false);
    }
  }, [eventDate, load, onChanged]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="w-6 h-6 rounded-full animate-spin border-2 border-t-transparent" style={{ borderColor: "rgba(35,147,94,.3)", borderTopColor: "transparent" }} />
      </div>
    );
  }

  const gmBanner = day?.manualSeason && day.dayGm ? (
    <MahjongDayGmBanner eventDate={eventDate} dayGm={day.dayGm} finished={!!day.finished} onChanged={load} />
  ) : null;

  // GM（手動シーズン）: 卓振り分けパネルを常時上部に表示（自己申告UIとは別セクション）。
  const gmPanel = day?.manualSeason && day.isGameMaster ? (
    <MahjongGmAssignPanel eventDate={eventDate} onChanged={load} />
  ) : null;

  if (!day || day.tables.length === 0) {
    // 本日終了 ＞ 手動シーズンの「GM の振り分け待ち」 ＞ 通常の未生成メッセージ。
    return (
      <div className="flex flex-col gap-4">
        {gmBanner}
        {gmPanel}
        {day?.finished ? (
          <GlassCard className="text-center py-8">
            <div
              className="mx-auto mb-3 flex items-center justify-center rounded-full"
              style={{ width: 64, height: 64, background: "rgba(35,147,94,.14)" }}
            >
              <CheckIcon color="var(--eb-green-text)" size={28} />
            </div>
            <div className="text-[18px] font-bold text-[color:var(--eb-ink)]">本日の対局はすべて終了しました</div>
            <p className="text-[15px] text-[color:var(--eb-ink-muted)] mt-1">
              おつかれさまでした。結果は「リーグ」タブの順位に反映されます。
            </p>
          </GlassCard>
        ) : day?.manualSeason && day.awaitingAssignment ? (
          <GlassCard className="text-center py-8">
            <div className="mx-auto mb-3 h-7 w-7 rounded-full animate-spin border-[3px] border-t-transparent" style={{ borderColor: "rgba(35,147,94,.3)", borderTopColor: "var(--eb-green)" }} />
            <div className="text-[17px] font-bold text-[color:var(--eb-ink)]">卓はまだ確定していません</div>
            <p className="text-[15px] text-[color:var(--eb-ink-muted)] mt-1">
              ゲームマスターの振り分け待ちです。決まると自動でこの画面に卓が表示されます。
            </p>
          </GlassCard>
        ) : (
          <GlassCard className="text-center py-8">
            <p className="text-[15px] text-[color:var(--eb-ink-muted)]">まだ卓が組まれていません。</p>
          </GlassCard>
        )}
      </div>
    );
  }

  const myTable = day.tables.find((t) => t.members.some((m) => m.isCurrentUser)) ?? null;

  return (
    <div className="flex flex-col gap-4">
      {gmBanner}
      {gmPanel}
      <div className="flex items-center justify-between px-1">
        <div>
          <div className="text-[17px] font-bold text-[color:var(--eb-ink)]">第{day.round}半荘・抜け番あり</div>
          <div className="text-[12px] text-[color:var(--eb-ink-muted)] mt-0.5">半荘ごとに自動で卓を組み直します</div>
        </div>
        <StatusPill tone={myTable ? "green" : "coral"}>{myTable ? "対戦中" : "待機中"}</StatusPill>
      </div>

      {myTable ? (
        <GlassCard className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[20px] font-bold text-[color:var(--eb-ink)]">{myTable.tableLabel}卓</span>
            <StatusPill tone="muted">第{day.round}半荘</StatusPill>
          </div>
          <TableBoard table={myTable} />
          <Button variant="primary" onClick={() => setReportTable(myTable)}>
            スコアを申告する
          </Button>
        </GlassCard>
      ) : (
        <GlassCard className="text-center">
          <div className="text-[18px] font-bold text-[color:var(--eb-ink)]">今回は待機（抜け番）です</div>
          <div className="text-[15px] text-[color:var(--eb-ink-muted)] mt-1 mb-3">
            {demo ? "この半荘を進めると、次の卓で交代・INします" : "対戦中の卓が終わると、次の半荘で交代・INします"}
          </div>
          {demo && (
            <Button variant="primary" onClick={() => advance()} loading={busy}>
              この半荘を進める（デモ）
            </Button>
          )}
        </GlassCard>
      )}

      {/* デモ操作: ダミーは自己申告しないため、代行申告で実運用の流れ（1人ずつ申告→卓確定→次半荘）を再現する。 */}
      {demo && day.tables.length > 0 && (
        <div className="rounded-2xl border-[1.5px] border-dashed p-3.5 flex flex-col gap-2" style={{ borderColor: "rgba(35,147,94,.4)", background: "var(--eb-tint)" }}>
          <div className="text-[12px] font-bold text-[color:var(--eb-green-text)]">デモ操作（ダミーの申告を代行）</div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={stepOne} disabled={busy} className="text-[13px]">
              ダミー1名分を申告
            </Button>
            <Button variant="primary" onClick={() => advance()} disabled={busy} className="text-[13px]">
              残り全員分を一括申告
            </Button>
          </div>
          {stepMsg && <p className="text-[12px] font-bold text-[color:var(--eb-green-text)]">{stepMsg}</p>}
        </div>
      )}

      <GlassCard padding="md">
        <div className="text-[13px] font-bold text-[color:var(--eb-ink)] mb-2">待機順（先頭が次にIN）</div>
        {day.waiting.length === 0 ? (
          <div className="text-[13px] text-[color:var(--eb-ink-muted)]">待機者はいません</div>
        ) : (
          <ol className="flex flex-wrap gap-2">
            {day.waiting.map((w, i) => (
              <li
                key={i}
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
                style={
                  w.isMe
                    ? { background: "rgba(255,255,255,.9)", border: "2px solid var(--eb-green)" }
                    : { background: "var(--eb-tint)" }
                }
              >
                <span className="text-[11px] font-bold text-[color:var(--eb-ink-muted)] tabular-nums">{i + 1}</span>
                <Avatar src={w.pictureUrl} name={w.displayName} size={20} />
                <span className="text-[14px] font-bold text-[color:var(--eb-ink)]">
                  {w.displayName}
                  {w.isMe && <span className="ml-1 text-[12px] font-bold text-[color:var(--eb-green-text)]">（あなた）</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </GlassCard>

      {/* 自分の申告はデモでも本番と同じ report API に送る（デモの差し替えは廃止。
          ダミー分は上の「デモ操作」で代行し、実運用と同じ経路・流れを再現する）。 */}
      {reportTable && (
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
      )}
      {swap && <SwapSheet swap={swap} tables={day.tables} onClose={() => setSwap(null)} />}
    </div>
  );
}

/** 「次の卓はこちらです」: 次半荘のA卓/B卓と各卓のメンバー（あなた・新加入INを強調）を表示。 */
function SwapSheet({ swap, tables, onClose }: { swap: MahjongDaySwap; tables: PublicMahjongTable[]; onClose: () => void }) {
  const inNames = new Set(swap.in.map((p) => p.displayName));
  return (
    <BottomSheet open title="次の卓はこちらです" onClose={onClose} dismissible={false} closeButton={false}>
      <p className="text-[14px] text-[color:var(--eb-ink-muted)] mb-3">第{swap.round}半荘が確定。抜け番で卓を組み直しました。下の卓に着席してください。</p>
      {swap.reason && (
        <div className="mb-3 rounded-xl px-3 py-2 text-[13px] font-bold text-[color:var(--eb-gold-text)]" style={{ background: "rgba(217,169,58,.18)" }}>{swap.reason}</div>
      )}
      <div className="flex flex-col gap-2.5">
        {tables.map((t) => (
          <GlassCard key={t.tableId} padding="md">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[15px] font-bold text-[color:var(--eb-ink)]">{t.tableLabel}卓</span>
              <span className="text-[12px] text-[color:var(--eb-ink-muted)]">{t.members.length}名</span>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {t.members.map((m, i) => {
                const isNew = inNames.has(m.displayName);
                return (
                  <div key={i} className="flex items-center gap-1.5 min-w-0">
                    <Avatar src={m.pictureUrl} name={m.displayName} size={22} />
                    <span className={`text-[13px] font-bold truncate ${m.isCurrentUser ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-ink)]"}`}>{m.displayName}</span>
                    {m.isCurrentUser && <span className="shrink-0 text-[11px] font-bold text-[color:var(--eb-green-text)]">あなた</span>}
                    {isNew && !m.isCurrentUser && <StatusPill tone="green" className="shrink-0 px-1.5 py-0.5 text-[10px]">IN</StatusPill>}
                  </div>
                );
              })}
            </div>
          </GlassCard>
        ))}
      </div>
      {swap.out.length > 0 && (
        <div className="mt-3 text-[13px] text-[color:var(--eb-coral-text)]">
          <span className="font-bold">退席（抜け番）:</span> {swap.out.map((p) => p.displayName).join("、")}
        </div>
      )}
      <Button variant="primary" onClick={onClose} className="mt-5">
        次の卓へ
      </Button>
    </BottomSheet>
  );
}
