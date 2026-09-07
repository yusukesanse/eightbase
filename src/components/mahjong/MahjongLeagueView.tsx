"use client";

import { useEffect, useState, useCallback } from "react";
import { LeaguePyramid } from "@/components/LeaguePyramid";
import { PlayerHistorySheet } from "@/components/mahjong/PlayerHistorySheet";
import {
  type MahjongStanding,
  type PublicMahjongTable,
  type MahjongSeasonSummary,
  type MahjongMyEntry,
} from "@/types";
import { completeEntryPayment } from "@/lib/mahjongPayment";
import { GlassCard, SegmentedTabs } from "@/components/ui/eb";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { JoinTab } from "@/components/mahjong/MahjongJoinTab";
import { ReportTab } from "@/components/mahjong/MahjongReportTab";
import { MahjongCsView } from "@/components/mahjong/MahjongCsView";
import { DayTabPlaceholder } from "@/components/games/DayTabPlaceholder";
import { MahjongRulesTab } from "@/components/mahjong/MahjongRulesTab";

/**
 * ランキング > 麻雀 のビュー
 * タブ: リーグ（ピラミッド＋順位） / 参加（開催予定表＋参加ボタン） / 申告（フォーム・参加中のみ活性）
 * ※ 参加/申告タブの本体・共有プリミティブは MahjongJoinTab / MahjongReportTab / leagueShared に分離。
 */

type SubTab = "league" | "join" | "report" | "cs" | "rules";

export function MahjongLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [rankingMetric, setRankingMetric] = useState<"average" | "total">("average");
  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  // 参加費（3,000円）の支払い要否（member/guest=要, staff=不要）と開催日ごとの自分の支払い状態
  const [paymentRequired, setPaymentRequired] = useState(false);
  // 管理者が個別に解除した「月1回制限」の免除（表示の出し分けのみ。可否の判定はサーバー）。
  const [monthlyExempt, setMonthlyExempt] = useState(false);
  // 自分の参加（開催日 → entry）。決済URL・仮押さえ期限を持つので参加タブの状態表示に使う。
  const [myEntries, setMyEntries] = useState<Record<string, MahjongMyEntry>>({});
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

  // 休催日（管理者が非活性化した土曜）
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set());
  // 人数不足で自動中止（流会）になった開催日
  const [cancelledDates, setCancelledDates] = useState<Set<string>>(new Set());
  // 管理者が登録した開催日（mahjongSchedule）。1件でもあればスケジュール駆動（曜日不問＝日曜も可）。
  const [scheduledDates, setScheduledDates] = useState<Set<string>>(new Set());

  // シーズン一覧＋休催日＋中止日＋開催日（初回のみ）
  useEffect(() => {
    fetch("/api/mahjong/seasons", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setSeasons(d.seasons ?? []))
      .catch(() => {
        /* noop */
      });
    fetch("/api/mahjong/schedule", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        const s = (d.schedule ?? [])
          .filter((x: { type?: string }) => !x.type || x.type === "league")
          .map((x: { date: string }) => x.date);
        setScheduledDates(new Set<string>(s));
      })
      .catch(() => {
        /* noop */
      });
    fetch("/api/mahjong/closed-dates", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setClosedDates(new Set<string>(d.dates ?? [])))
      .catch(() => {
        /* noop */
      });
    fetch("/api/mahjong/cancelled-dates", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setCancelledDates(new Set<string>(d.dates ?? [])))
      .catch(() => {
        /* noop */
      });
  }, []);

  // silent=true はバックグラウンド更新（ポーリング/操作後）。loading を触らず全画面スピナーを出さない。
  /**
   * @param withStandings 通算順位も取り直すか。
   *   ⚠️ /api/mahjong/standings は **scores をシーズン全件スキャン**するので、
   *   15秒ポーリングで毎回叩くと閲覧者×開催数に比例して読み取りが膨張する
   *   （過去に無料枠5万件/日を焼き切った実績あり）。順位が動くのは「本日終了」の瞬間だけなので、
   *   ポーリングでは取りに行かず、初回・シーズン切替・申告後だけ取り直す。
   */
  const loadCore = useCallback(async (silent = false, withStandings = true) => {
    if (!silent) setLoading(true);
    try {
      const standingsUrl = selectedSeasonId
        ? `/api/mahjong/standings?seasonId=${encodeURIComponent(selectedSeasonId)}`
        : "/api/mahjong/standings";
      const [sRes, tRes, eRes] = await Promise.all([
        withStandings ? fetch(standingsUrl, { credentials: "include" }) : Promise.resolve(null),
        fetch("/api/mahjong/tables?mine=1", { credentials: "include" }),
        fetch("/api/mahjong/entries?mine=1", { credentials: "include" }),
      ]);
      const sData = sRes ? await sRes.json() : null;
      const tData = await tRes.json();
      const eData = await eRes.json();
      if (sData) {
        setStandings(sData.standings ?? []);
        setCurrentUserId(sData.currentUserId);
        setRankingMetric(sData.rankingMetric === "total" ? "total" : "average");
        setViewSeasonId(sData.seasonId ?? selectedSeasonId ?? undefined);
      }
      setTables(tData.tables ?? []);

      // 自分の参加日＋支払い状態（月1回制御・カレンダー表示に使う）。
      // 期限切れの仮押さえはサーバーが除外済み＝ここに来るものは席を持っている。
      const entered = new Set<string>();
      const byDate: Record<string, MahjongMyEntry> = {};
      for (const e of (eData.entries ?? []) as MahjongMyEntry[]) {
        entered.add(e.eventDate);
        byDate[e.eventDate] = e;
      }
      setEnteredDates(entered);
      setPaymentRequired(!!eData.paymentRequired);
      setMonthlyExempt(!!eData.monthlyExempt);
      setMyEntries(byDate);
    } catch {
      /* noop */
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selectedSeasonId]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);
  // 参加状況・卓を追従（15秒ポーリング＋復帰時）。サイレント更新。
  // 通算順位はポーリング対象外（全件スキャンのため。上記 loadCore のコメント参照）。
  useAutoRefresh(() => loadCore(true, false), 15000);

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
      if (r.ok) loadCore(true);
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
      {/* サブタブ（タブ自体は常に開ける＝他3種目と挙動を揃える。非参加者には中身でプレースホルダ） */}
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
          enteredDates={enteredDates}
          closedDates={closedDates}
          cancelledDates={cancelledDates}
          scheduledDates={scheduledDates}
          // 参加タブはアクティブシーズン固定。カレンダーを遡れる下限に使う（成績閲覧用）。
          seasonStartDate={seasons.find((s) => s.active)?.startDate}
          paymentRequired={paymentRequired}
          monthlyExempt={monthlyExempt}
          myEntries={myEntries}
          onChanged={() => loadCore(true)}
        />
      ) : subTab === "report" ? (
        isParticipating ? (
          <ReportTab
            tables={tables}
            onChanged={() => loadCore(true)}
          />
        ) : (
          <DayTabPlaceholder />
        )
      ) : subTab === "cs" ? (
        <MahjongCsView />
      ) : (
        <MahjongRulesTab />
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
