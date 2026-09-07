"use client";

import { useEffect, useState, useCallback } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { completeBilliardsEntryPayment } from "@/lib/billiardsPayment";
import { BilliardsLeagueBoard } from "@/components/billiards/BilliardsLeagueBoard";
import { BilliardsJoinTab } from "@/components/billiards/BilliardsJoinTab";
import { BilliardsMatchLogTab } from "@/components/billiards/BilliardsMatchLogTab";
import { BilliardsCsView } from "@/components/billiards/BilliardsCsView";
import { BilliardsRulesTab } from "@/components/billiards/BilliardsRulesTab";
import { GlassCard, SegmentedTabs } from "@/components/ui/eb";
import type { BilliardsPaymentStatus, BilliardsScheduleEntry } from "@/types/billiards";

/**
 * ランキング > ビリヤード のビュー（ダーツ DartsLeagueView の読み替え）。
 * タブ: リーグ / 参加 / 対戦記録 / ルール・約款。（CS は P5 で追加）
 */

type SubTab = "league" | "join" | "match" | "cs" | "rules";

export function BilliardsLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [paymentRequired, setPaymentRequired] = useState(false);
  // 管理者が個別に解除した「月1回制限」の免除（表示の出し分けのみ。可否の判定はサーバー）。
  const [monthlyExempt, setMonthlyExempt] = useState(false);
  const [paymentStatusByDate, setPaymentStatusByDate] = useState<Record<string, BilliardsPaymentStatus | null>>({});
  const [scheduleDates, setScheduleDates] = useState<Set<string>>(new Set());
  // 開催時刻は管理画面の設定（日程docの startTime/endTime）を表示に使う。ハードコードしない。
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, { startTime?: string; endTime?: string }>>({});
  const [loading, setLoading] = useState(true);
  const [payBanner, setPayBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/billiards/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const list: BilliardsScheduleEntry[] = d.schedule ?? [];
        setScheduleDates(new Set<string>(list.map((s) => s.date)));
        setScheduleTimes(Object.fromEntries(list.map((s) => [s.date, { startTime: s.startTime, endTime: s.endTime }])));
      })
      .catch(() => {});
  }, []);

  const loadCore = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/billiards/entries?mine=1", { credentials: "include" });
      const data = await res.json();
      const entered = new Set<string>();
      const payByDate: Record<string, BilliardsPaymentStatus | null> = {};
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

  useEffect(() => { loadCore(); }, [loadCore]);
  useAutoRefresh(() => loadCore(true), 15000);

  // Square 参加費決済の戻り: ?billiardspay=<エントリーID> を確定処理する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const rid = url.searchParams.get("billiardspay");
    if (!rid) return;
    setSubTab("join");
    completeBilliardsEntryPayment(rid)
      .then((r) => {
        setPayBanner({ ok: r.paid, text: r.paid ? "参加費のお支払いが完了しました。" : "決済の確認ができませんでした。" });
        if (r.paid) loadCore(true);
      })
      .catch((e) => setPayBanner({ ok: false, text: e instanceof Error ? e.message : "決済の確認に失敗しました" }))
      .finally(() => {
        url.searchParams.delete("billiardspay");
        window.history.replaceState({}, "", url.pathname + url.search);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {payBanner && (
        <GlassCard tone={payBanner.ok ? "green" : "coral"} padding="md" className="mb-3">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`text-[15px] font-bold ${
                payBanner.ok ? "text-[color:var(--eb-green-text)]" : "text-[color:var(--eb-coral-text)]"
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
          { id: "match", label: "対戦記録" },
          { id: "cs", label: "CS" },
          { id: "rules", label: "ルール/約款" },
        ]}
      />

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
      ) : subTab === "league" ? (
        <BilliardsLeagueBoard />
      ) : subTab === "join" ? (
        <BilliardsJoinTab
          enteredDates={enteredDates}
          scheduleDates={scheduleDates}
          scheduleTimes={scheduleTimes}
          cancelledDates={new Set()}
          paymentRequired={paymentRequired}
          monthlyExempt={monthlyExempt}
          paymentStatusByDate={paymentStatusByDate}
          onChanged={() => loadCore(true)}
        />
      ) : subTab === "match" ? (
        <BilliardsMatchLogTab onChanged={() => loadCore(true)} />
      ) : subTab === "cs" ? (
        <BilliardsCsView />
      ) : (
        <BilliardsRulesTab />
      )}
    </div>
  );
}
