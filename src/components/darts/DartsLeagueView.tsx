"use client";

import { useEffect, useState, useCallback } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { completeDartsEntryPayment } from "@/lib/dartsPayment";
import { DartsLeagueBoard } from "@/components/darts/DartsLeagueBoard";
import { DartsJoinTab } from "@/components/darts/DartsJoinTab";
import { DartsReportTab } from "@/components/darts/DartsReportTab";
import { DartsCsView } from "@/components/darts/DartsCsView";
import { DartsRulesTab } from "@/components/darts/DartsRulesTab";
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
  const [paymentStatusByDate, setPaymentStatusByDate] = useState<Record<string, DartsPaymentStatus | null>>({});
  const [scheduleDates, setScheduleDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [payBanner, setPayBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // 開催日一覧（初回のみ）。dartsSchedule が「有効な開催日」の唯一の正。
  useEffect(() => {
    fetch("/api/darts/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setScheduleDates(new Set<string>((d.schedule ?? []).map((s: DartsScheduleEntry) => s.date))))
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
        <div
          className={`mb-3 rounded-2xl px-4 py-3 text-[13px] font-bold flex items-center justify-between gap-2 ${
            payBanner.ok ? "bg-[#eef4dd] text-[#5f7d1e]" : "bg-[#fdece8] text-[#d8533a]"
          }`}
        >
          <span>{payBanner.text}</span>
          <button onClick={() => setPayBanner(null)} className="shrink-0 font-black opacity-60">
            ×
          </button>
        </div>
      )}

      {/* サブタブ（選択中は白ピル＋アクセント文字＋太字＋リング） */}
      <div className="flex gap-1 mb-4 bg-[#231714]/[0.08] rounded-xl p-1">
        {(
          [
            { id: "league", label: "リーグ" },
            { id: "join", label: "参加" },
            { id: "report", label: "対戦/申告" },
            { id: "cs", label: "CS" },
            { id: "rules", label: "ルール/約款" },
          ] as { id: SubTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-xs text-center transition-all ${
              subTab === t.id
                ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25"
                : "text-[#231714]/80 font-medium"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : subTab === "league" ? (
        <DartsLeagueBoard />
      ) : subTab === "join" ? (
        <DartsJoinTab
          enteredDates={enteredDates}
          scheduleDates={scheduleDates}
          cancelledDates={new Set()}
          paymentRequired={paymentRequired}
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
