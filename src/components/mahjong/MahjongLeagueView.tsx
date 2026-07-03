"use client";

import { useEffect, useState, useCallback } from "react";
import { LeaguePyramid } from "@/components/LeaguePyramid";
import { PlayerHistorySheet } from "@/components/mahjong/PlayerHistorySheet";
import {
  type MahjongStanding,
  type PublicMahjongTable,
  type MahjongScheduleEntry,
  type MahjongSeasonSummary,
  type MahjongPaymentStatus,
} from "@/types";
import { completeEntryPayment } from "@/lib/mahjongPayment";
import { JoinTab } from "@/components/mahjong/MahjongJoinTab";
import { ReportTab } from "@/components/mahjong/MahjongReportTab";

/**
 * ランキング > 麻雀 のビュー
 * タブ: リーグ（ピラミッド＋順位） / 参加（開催予定表＋参加ボタン） / 申告（フォーム・参加中のみ活性）
 * ※ 参加/申告タブの本体・共有プリミティブは MahjongJoinTab / MahjongReportTab / leagueShared に分離。
 */

type SubTab = "league" | "join" | "report";

export function MahjongLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [rankingMetric, setRankingMetric] = useState<"average" | "total">("average");
  const [schedule, setSchedule] = useState<MahjongScheduleEntry[]>([]);
  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [entryCountByDate, setEntryCountByDate] = useState<Record<string, number>>({});
  // WP3: 参加費（3,000円）の支払い要否（member/guest=要, staff=不要）と開催日ごとの自分の支払い状態
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [paymentStatusByDate, setPaymentStatusByDate] = useState<
    Record<string, MahjongPaymentStatus | null>
  >({});
  const [tables, setTables] = useState<PublicMahjongTable[]>([]);
  const [loading, setLoading] = useState(true);
  // シーズン切替（順位/戦歴の閲覧にのみ効く。参加/申告はアクティブシーズン固定）
  const [seasons, setSeasons] = useState<MahjongSeasonSummary[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [viewSeasonId, setViewSeasonId] = useState<string | undefined>(undefined);
  // 戦歴ビューの対象プレイヤー
  const [historyPlayer, setHistoryPlayer] = useState<string | null>(null);
  // WP3: 参加費決済の戻り（?mjpay=）結果バナー
  const [payBanner, setPayBanner] = useState<{ ok: boolean; text: string } | null>(null);

  // シーズン一覧（セレクタ用・初回のみ）
  useEffect(() => {
    fetch("/api/mahjong/seasons", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons ?? []))
      .catch(() => {
        /* noop */
      });
  }, []);

  const loadCore = useCallback(async () => {
    setLoading(true);
    try {
      const standingsUrl = selectedSeasonId
        ? `/api/mahjong/standings?seasonId=${encodeURIComponent(selectedSeasonId)}`
        : "/api/mahjong/standings";
      const [sRes, schRes, tRes] = await Promise.all([
        fetch(standingsUrl, { credentials: "include" }),
        fetch("/api/mahjong/schedule", { credentials: "include" }),
        fetch("/api/mahjong/tables?mine=1", { credentials: "include" }),
      ]);
      const sData = await sRes.json();
      const schData = await schRes.json();
      const tData = await tRes.json();
      setStandings(sData.standings ?? []);
      setCurrentUserId(sData.currentUserId);
      setRankingMetric(sData.rankingMetric === "total" ? "total" : "average");
      setViewSeasonId(sData.seasonId ?? selectedSeasonId ?? undefined);
      const league = (schData.schedule ?? []).filter(
        (x: MahjongScheduleEntry) => x.type === "league"
      );
      setSchedule(league);
      setTables(tData.tables ?? []);

      // 参加表明状況＋参加人数＋自分の支払い状態を各開催日ぶん取得
      const entered = new Set<string>();
      const counts: Record<string, number> = {};
      const payByDate: Record<string, MahjongPaymentStatus | null> = {};
      let payRequired = false;
      await Promise.all(
        league.map(async (s: MahjongScheduleEntry) => {
          try {
            const r = await fetch(`/api/mahjong/entries?eventDate=${s.date}`, {
              credentials: "include",
            });
            const d = await r.json();
            if (d.entered) entered.add(s.date);
            counts[s.date] = (d.entries ?? []).length;
            if (d.me?.paymentRequired) payRequired = true;
            payByDate[s.date] = d.me?.paymentStatus ?? null;
          } catch {
            /* noop */
          }
        })
      );
      setEnteredDates(entered);
      setEntryCountByDate(counts);
      setPaymentRequired(payRequired);
      setPaymentStatusByDate(payByDate);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [selectedSeasonId]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  // Square 参加費決済の戻り: ?mjpay=<エントリーID> を確定処理する（決済導線はこのビューに集約）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const rid = url.searchParams.get("mjpay");
    if (!rid) return;
    setSubTab("join");
    completeEntryPayment(rid).then((r) => {
      setPayBanner({
        ok: r.ok,
        text: r.ok ? "参加費のお支払いが完了しました。" : r.message || "決済の確認に失敗しました",
      });
      if (r.ok) loadCore();
      url.searchParams.delete("mjpay");
      window.history.replaceState({}, "", url.pathname + url.search);
    });
    // 初回マウント時のみ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isParticipating = enteredDates.size > 0 || tables.length > 0;

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
      {/* サブタブ */}
      <div className="flex gap-1 mb-4 bg-[#231714]/5 rounded-xl p-1">
        {(
          [
            { id: "league", label: "リーグ", enabled: true },
            { id: "join", label: "参加", enabled: true },
            { id: "report", label: "卓確認/申告", enabled: isParticipating },
          ] as { id: SubTab; label: string; enabled: boolean }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => t.enabled && setSubTab(t.id)}
            disabled={!t.enabled}
            className={`flex-1 py-2 rounded-lg text-xs font-medium text-center transition-all ${
              subTab === t.id
                ? "bg-white text-[#231714] shadow-sm"
                : t.enabled
                  ? "text-[#231714]/40"
                  : "text-[#231714]/20"
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
        <div className="space-y-4">
          {seasons.length > 1 && (
            <SeasonSelector
              seasons={seasons}
              value={viewSeasonId}
              onChange={setSelectedSeasonId}
            />
          )}
          <LeaguePyramid
            standings={standings}
            currentUserId={currentUserId}
            onSelectPlayer={setHistoryPlayer}
            rankingMetric={rankingMetric}
          />
        </div>
      ) : subTab === "join" ? (
        <JoinTab
          schedule={schedule}
          enteredDates={enteredDates}
          entryCountByDate={entryCountByDate}
          tables={tables}
          paymentRequired={paymentRequired}
          paymentStatusByDate={paymentStatusByDate}
          onChanged={loadCore}
        />
      ) : (
        <ReportTab
          tables={tables}
          onChanged={loadCore}
        />
      )}

      {historyPlayer && (
        <PlayerHistorySheet
          lineUserId={historyPlayer}
          seasonId={viewSeasonId}
          onClose={() => setHistoryPlayer(null)}
        />
      )}
    </div>
  );
}

/* ───────── シーズン選択 ───────── */

function SeasonSelector({
  seasons,
  value,
  onChange,
}: {
  seasons: MahjongSeasonSummary[];
  value?: string;
  onChange: (seasonId: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-0.5">
      {seasons.map((s) => {
        const active = s.seasonId === value;
        return (
          <button
            key={s.seasonId}
            type="button"
            onClick={() => onChange(s.seasonId)}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-[12.5px] font-bold transition-colors ${
              active ? "text-white" : "text-[#40434a]"
            }`}
            style={
              active
                ? { background: "#2f7d57" }
                : { background: "#f6f8f9", boxShadow: "inset 0 0 0 1px #e4e7e9" }
            }
          >
            {s.name || s.seasonId}
            {s.active && (
              <span className={`ml-1.5 text-[9px] ${active ? "opacity-80" : "text-[#2f7d57]"}`}>
                開催中
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
