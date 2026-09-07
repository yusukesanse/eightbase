"use client";

import { useEffect, useState, useCallback } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { completeDartsEntryPayment } from "@/lib/dartsPayment";
import { DartsLeagueBoard } from "@/components/darts/DartsLeagueBoard";
import { DartsJoinTab } from "@/components/darts/DartsJoinTab";
import { DartsReportTab } from "@/components/darts/DartsReportTab";
import { DartsCsView } from "@/components/darts/DartsCsView";
import { DartsRulesTab } from "@/components/darts/DartsRulesTab";
import { GlassCard, SegmentedTabs } from "@/components/ui/eb";
import type { DartsPaymentStatus, DartsScheduleEntry } from "@/types/darts";

/**
 * ランキング > ダーツ のビュー（麻雀 MahjongLeagueView の読み替え）。
 * タブ: リーグ（通算ポイント順ランキング）/ 参加（開催日カレンダー＋参加/決済）/ ルール・約款。
 * ※「卓確認/申告」（当日フロー・GMパネル）は次の実装増分で追加する。
 */

type SubTab = "league" | "join" | "report" | "cs" | "rules";

export function DartsLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  // 参加状況（カレンダー・月1回制御・支払い状態）
  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [paymentRequired, setPaymentRequired] = useState(false);
  // 管理者が個別に解除した「月1回制限」の免除（表示の出し分けのみ。可否の判定はサーバー）。
  const [monthlyExempt, setMonthlyExempt] = useState(false);
  const [paymentStatusByDate, setPaymentStatusByDate] = useState<Record<string, DartsPaymentStatus | null>>({});
  const [scheduleDates, setScheduleDates] = useState<Set<string>>(new Set());
  // 開催時刻は管理画面の設定（日程docの startTime/endTime）を表示に使う。ハードコードしない。
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, { startTime?: string; endTime?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [payBanner, setPayBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // 開催日一覧（初回のみ）。dartsSchedule が「有効な開催日」の唯一の正。
  useEffect(() => {
    fetch("/api/darts/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const list: DartsScheduleEntry[] = d.schedule ?? [];
        setScheduleDates(new Set<string>(list.map((s) => s.date)));
        setScheduleTimes(Object.fromEntries(list.map((s) => [s.date, { startTime: s.startTime, endTime: s.endTime }])));
      })
      .catch(() => {});
  }, []);

  const loadCore = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/darts/entries?mine=1", { credentials: "include" });
      const data = await res.json();
      const entered = new Set<string>();
      const payByDate: Record<string, DartsPaymentStatus | null> = {};
      for (const e of data.entries ?? []) {
        entered.add(e.eventDate);
        payByDate[e.eventDate] = e.paymentStatus ?? null;
      }
      setEnteredDates(entered);
      setPaymentRequired(!!data.paymentRequired);
      setMonthlyExempt(!!data.monthlyExempt);
      setPaymentStatusByDate(payByDate);
    } catch {
      /* noop */
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCore();
  }, [loadCore]);
  useAutoRefresh(() => loadCore(true), 15000);

  // Square 参加費決済の戻り: ?dartspay=<エントリーID> を確定処理する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const rid = url.searchParams.get("dartspay");
    if (!rid) return;
    setSubTab("join");
    completeDartsEntryPayment(rid)
      .then((r) => {
        setPayBanner({
          ok: r.paid,
          text: r.paid ? "参加費のお支払いが完了しました。" : "決済の確認ができませんでした。",
        });
        if (r.paid) loadCore(true);
      })
      .catch((e) => {
        setPayBanner({ ok: false, text: e instanceof Error ? e.message : "決済の確認に失敗しました" });
      })
      .finally(() => {
        url.searchParams.delete("dartspay");
        window.history.replaceState({}, "", url.pathname + url.search);
      });
    // 初回マウント時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {payBanner && (
        <GlassCard tone={payBanner.ok ? "green" : "coral"} padding="md" className="mb-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[15px] font-bold ${
                payBanner.ok
                  ? "text-[color:var(--eb-green-text)]"
                  : "text-[color:var(--eb-coral-text)]"
              }`}
            >
              {payBanner.text}
            </span>
            <button
              onClick={() => setPayBanner(null)}
              aria-label="閉じる"
              className="shrink-0 text-[17px] font-bold text-[color:var(--eb-ink-muted)]"
            >
              ×
            </button>
          </div>
        </GlassCard>
      )}

      <SegmentedTabs
        className="mb-4"
        size="md"
        value={subTab}
        onChange={(id) => setSubTab(id as SubTab)}
        items={[
          { id: "league", label: "リーグ" },
          { id: "join", label: "参加" },
          { id: "report", label: "対戦記録" },
          { id: "cs", label: "CS" },
          { id: "rules", label: "ルール/約款" },
        ]}
      />

      {loading ? (
        <div className="flex justify-center py-12">
          <div
            className="w-6 h-6 rounded-full animate-spin border-2 border-t-transparent"
            style={{ borderColor: "rgba(35,147,94,.3)", borderTopColor: "transparent" }}
          />
        </div>
      ) : subTab === "league" ? (
        <DartsLeagueBoard />
      ) : subTab === "join" ? (
        <DartsJoinTab
          enteredDates={enteredDates}
          scheduleDates={scheduleDates}
          scheduleTimes={scheduleTimes}
          cancelledDates={new Set()}
          paymentRequired={paymentRequired}
          monthlyExempt={monthlyExempt}
          paymentStatusByDate={paymentStatusByDate}
          onChanged={() => loadCore(true)}
        />
      ) : subTab === "report" ? (
        <DartsReportTab onChanged={() => loadCore(true)} />
      ) : subTab === "cs" ? (
        <DartsCsView />
      ) : (
        <DartsRulesTab />
      )}
    </div>
  );
}
