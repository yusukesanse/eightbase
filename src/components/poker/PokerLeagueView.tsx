"use client";

import { useEffect, useState, useCallback } from "react";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { completePokerEntryPayment } from "@/lib/pokerPayment";
import { PokerLeagueBoard } from "@/components/poker/PokerLeagueBoard";
import { PokerJoinTab } from "@/components/poker/PokerJoinTab";
import { PokerGameTab } from "@/components/poker/PokerGameTab";
import { PokerRulesTab } from "@/components/poker/PokerRulesTab";
import type { PokerPaymentStatus, PokerScheduleEntry } from "@/types/poker";

/**
 * ランキング > ポーカー のビュー（ダーツ/ビリヤードの LeagueView の読み替え）。
 * タブ: リーグ（通算チップ順）/ 参加（開催日カレンダー＋参加/決済）/ 当日（ディーラー進行）/ ルール。
 * CS は未実装（後日）。
 */

type SubTab = "league" | "join" | "game" | "rules";

export function PokerLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [paymentStatusByDate, setPaymentStatusByDate] = useState<Record<string, PokerPaymentStatus | null>>({});
  const [scheduleDates, setScheduleDates] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [payBanner, setPayBanner] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/poker/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setScheduleDates(new Set<string>((d.schedule ?? []).map((s: PokerScheduleEntry) => s.date))))
      .catch(() => {});
  }, []);

  const loadCore = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await fetch("/api/poker/entries?mine=1", { credentials: "include" });
      const data = await res.json();
      const entered = new Set<string>();
      const payByDate: Record<string, PokerPaymentStatus | null> = {};
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

  useEffect(() => { loadCore(); }, [loadCore]);
  useAutoRefresh(() => loadCore(true), 15000);

  // Square 参加費決済の戻り: ?pokerpay=<エントリーID> を確定処理する。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const rid = url.searchParams.get("pokerpay");
    if (!rid) return;
    setSubTab("join");
    completePokerEntryPayment(rid)
      .then((r) => {
        setPayBanner({ ok: r.paid, text: r.paid ? "参加費のお支払いが完了しました。" : "決済の確認ができませんでした。" });
        if (r.paid) loadCore(true);
      })
      .catch((e) => setPayBanner({ ok: false, text: e instanceof Error ? e.message : "決済の確認に失敗しました" }))
      .finally(() => {
        url.searchParams.delete("pokerpay");
        window.history.replaceState({}, "", url.pathname + url.search);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {payBanner && (
        <div className={`mb-3 rounded-2xl px-4 py-3 text-[13px] font-bold flex items-center justify-between gap-2 ${payBanner.ok ? "bg-[#eef4dd] text-[#5f7d1e]" : "bg-[#fdece8] text-[#d8533a]"}`}>
          <span>{payBanner.text}</span>
          <button onClick={() => setPayBanner(null)} className="shrink-0 font-black opacity-60">×</button>
        </div>
      )}

      <div className="flex gap-1 mb-4 bg-[#231714]/[0.08] rounded-xl p-1">
        {(
          [
            { id: "league", label: "リーグ" },
            { id: "join", label: "参加" },
            { id: "game", label: "当日" },
            { id: "rules", label: "ルール/約款" },
          ] as { id: SubTab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`flex-1 py-2 rounded-lg text-xs text-center transition-all ${
              subTab === t.id ? "bg-white text-[#33636e] font-bold shadow-md ring-1 ring-[#33636e]/25" : "text-[#231714]/80 font-medium"
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
        <PokerLeagueBoard />
      ) : subTab === "join" ? (
        <PokerJoinTab
          enteredDates={enteredDates}
          scheduleDates={scheduleDates}
          cancelledDates={new Set()}
          paymentRequired={paymentRequired}
          paymentStatusByDate={paymentStatusByDate}
          onChanged={() => loadCore(true)}
        />
      ) : subTab === "game" ? (
        <PokerGameTab onChanged={() => loadCore(true)} />
      ) : (
        <PokerRulesTab />
      )}
    </div>
  );
}
