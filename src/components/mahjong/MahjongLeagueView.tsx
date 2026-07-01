"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { LeaguePyramid } from "@/components/LeaguePyramid";
import { PlayerHistorySheet } from "@/components/mahjong/PlayerHistorySheet";
import { Avatar } from "@/components/ui/LineContact";
import type {
  MahjongStanding,
  PublicMahjongTable,
  PublicMahjongTableMember,
  MahjongScheduleEntry,
  MahjongSeasonSummary,
} from "@/types";

// 卓の席順（卓内の並び順から東南西北を割り当て）
const SEATS = ["東", "南", "西", "北"] as const;
// 麻雀リーグのアクセント（フェルト緑系・TILES案）
const ACCENT = "#2f7d57";

function dateParts(d: string): { md: string; wd: string } {
  const parts = d.split("-").map(Number);
  const dt = new Date(d + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return { md: `${parts[1]}/${parts[2]}`, wd: w };
}

function CheckIcon({ color = "#fff", size = 15 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function ChevronRight({ color = "#fff", size = 14 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

// 卓確定の色（CSメダル金系・参加中の緑と区別する）
const CONFIRM = "#b48f13";

/**
 * ランキング > 麻雀 のビュー
 * タブ: リーグ（ピラミッド＋順位） / 参加（開催予定表＋参加ボタン） / 申告（フォーム・参加中のみ活性）
 */

type SubTab = "league" | "join" | "report";

function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function formatJpDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  void y;
  const dt = new Date(d + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return `${m}/${day}(${w})`;
}

export function MahjongLeagueView() {
  const [subTab, setSubTab] = useState<SubTab>("league");

  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | undefined>(undefined);
  const [schedule, setSchedule] = useState<MahjongScheduleEntry[]>([]);
  const [enteredDates, setEnteredDates] = useState<Set<string>>(new Set());
  const [tables, setTables] = useState<PublicMahjongTable[]>([]);
  const [loading, setLoading] = useState(true);
  // シーズン切替（順位/戦歴の閲覧にのみ効く。参加/申告はアクティブシーズン固定）
  const [seasons, setSeasons] = useState<MahjongSeasonSummary[]>([]);
  const [selectedSeasonId, setSelectedSeasonId] = useState<string | null>(null);
  const [viewSeasonId, setViewSeasonId] = useState<string | undefined>(undefined);
  // 戦歴ビューの対象プレイヤー
  const [historyPlayer, setHistoryPlayer] = useState<string | null>(null);

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
      setViewSeasonId(sData.seasonId ?? selectedSeasonId ?? undefined);
      const league = (schData.schedule ?? []).filter(
        (x: MahjongScheduleEntry) => x.type === "league"
      );
      setSchedule(league);
      setTables(tData.tables ?? []);

      // 参加表明状況を各開催日ぶん取得
      const entered = new Set<string>();
      await Promise.all(
        league.map(async (s: MahjongScheduleEntry) => {
          try {
            const r = await fetch(`/api/mahjong/entries?eventDate=${s.date}`, {
              credentials: "include",
            });
            const d = await r.json();
            if (d.entered) entered.add(s.date);
          } catch {
            /* noop */
          }
        })
      );
      setEnteredDates(entered);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [selectedSeasonId]);

  useEffect(() => {
    loadCore();
  }, [loadCore]);

  const isParticipating = enteredDates.size > 0 || tables.length > 0;

  return (
    <div>
      {/* サブタブ */}
      <div className="flex gap-1 mb-4 bg-[#231714]/5 rounded-xl p-1">
        {(
          [
            { id: "league", label: "リーグ", enabled: true },
            { id: "join", label: "参加", enabled: true },
            { id: "report", label: "申告", enabled: isParticipating },
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
          />
        </div>
      ) : subTab === "join" ? (
        <JoinTab
          schedule={schedule}
          enteredDates={enteredDates}
          tables={tables}
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

/* ───────── 参加タブ ───────── */

function JoinTab({
  schedule,
  enteredDates,
  tables,
  onChanged,
}: {
  schedule: MahjongScheduleEntry[];
  enteredDates: Set<string>;
  tables: PublicMahjongTable[];
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // 卓確定の同卓メンバーを表示する対象日
  const [viewDate, setViewDate] = useState<string | null>(null);
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
      </p>
      {schedule.map((s) => {
        const entered = enteredDates.has(s.date);
        const past = s.date < today;
        // その日に自分が含まれる卓があれば「卓確定」
        const confirmed = tables.some((t) => t.eventDate === s.date);
        const { md, wd } = dateParts(s.date);
        const highlight = !past && (confirmed || entered);
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
              <div className="text-[12px] text-[#231714]/50 mt-0.5">{s.startTime}〜{s.endTime}</div>
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
            ) : (
              <button
                onClick={() => toggle(s.date, entered)}
                disabled={busy === s.date}
                className="shrink-0 inline-flex items-center gap-1 rounded-full text-[13px] font-extrabold px-4 py-2 active:scale-95 disabled:opacity-50 transition-transform"
                style={
                  entered
                    ? { background: ACCENT, color: "#fff", boxShadow: `0 2px 8px color-mix(in srgb, ${ACCENT} 40%, transparent)` }
                    : { background: "#f6f8f9", color: "#40434a", boxShadow: "inset 0 0 0 1px #e4e7e9" }
                }
              >
                {entered && busy !== s.date && <CheckIcon />}
                {busy === s.date ? "..." : entered ? "参加中" : "参加する"}
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
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

/* ───────── 申告タブ ───────── */

function ReportTab({
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

  return (
    <div className="flex flex-col gap-5">
      {sorted.map((t) => {
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
                  第{t.round}回戦
                </span>
              ) : null}
              <span className="flex-1" />
              <span className="text-[11px] font-bold" style={{ color: reportedCount === 4 ? "#6f9023" : "#97999d" }}>
                {reportedCount}/4 申告
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

/* 緑フェルトの卓ボード（席グリッド）。申告タブと参加タブの卓確定表示で共用 */
function TableBoard({ table }: { table: PublicMahjongTable }) {
  return (
    <div
      className="rounded-[20px] p-4"
      style={{
        background: "radial-gradient(120% 90% at 50% 30%, #2f7d57, #1c4d36)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08), inset 0 0 50px rgba(0,0,0,.28)",
      }}
    >
      {table.tableLabel && (
        <div className="text-center text-white/90 text-[12px] font-extrabold tracking-[0.1em] mb-3">{table.tableLabel}卓</div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {table.members.map((m, i) => (
          <Seat key={i} m={m} seat={SEATS[i] ?? ""} me={m.isCurrentUser} />
        ))}
      </div>
    </div>
  );
}

/* 緑フェルト上の席（東南西北） */
function Seat({ m, seat, me }: { m: PublicMahjongTableMember; seat: string; me: boolean }) {
  const done = m.points !== null;
  return (
    <div
      className="rounded-[14px] p-3 relative"
      style={
        me
          ? { background: "rgba(255,255,255,.96)", boxShadow: "0 4px 12px rgba(0,0,0,.25)" }
          : { background: "rgba(255,255,255,.1)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.16)" }
      }
    >
      <div className="flex items-center gap-2">
        <div className="relative">
          <Avatar src={m.pictureUrl} name={m.displayName} size={30} />
          <span
            className="absolute -left-1 -top-1.5 w-4 h-4 rounded-full text-white text-[10px] font-black flex items-center justify-center"
            style={{ background: "#d8533a", boxShadow: "0 0 0 1.5px rgba(255,255,255,.9)" }}
          >
            {seat}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-extrabold truncate" style={{ color: me ? "#1c1f21" : "#fff" }}>{m.displayName}</div>
          <div className="text-[10.5px] font-bold" style={{ color: me ? "#97999d" : "rgba(255,255,255,.7)" }}>
            {me ? "あなた" : done ? "申告済み" : "申告待ち"}
          </div>
        </div>
      </div>
      {done && (
        <div className="flex items-baseline justify-between mt-2">
          <span className="text-[16px] font-black tabular-nums" style={{ color: me ? "#1c1f21" : "#fff" }}>
            {m.points!.toLocaleString()}
          </span>
          <span className="text-[11px] font-extrabold" style={{ color: me ? "#97999d" : "rgba(255,255,255,.8)" }}>{m.rank}着</span>
        </div>
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 safe-area-pb max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#1c1f21]">スコアを申告</h3>
        <p className="text-[11px] text-[#231714]/50 mt-1 mb-5">
          同卓4人の合計が100,000点になると自動で確定します。
        </p>

        <label className="block text-[11px] font-extrabold text-[#97999d] tracking-[0.04em] mb-2">最終持ち点</label>
        <div className="flex items-center gap-2">
          <div
            className="flex-1 flex items-baseline gap-2 pb-1.5"
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
          {/* 数字キーボードを閉じて値を確定（下部シートがキーボードに隠れる対策） */}
          <button
            type="button"
            onClick={() => pointsRef.current?.blur()}
            className="shrink-0 inline-flex items-center gap-1 rounded-xl px-3.5 py-2.5 text-[13px] font-extrabold text-white active:scale-95 transition-transform"
            style={{ background: ACCENT }}
          >
            <CheckIcon size={15} />確定
          </button>
        </div>
        <div className="text-[11px] text-[#97999d] mt-1.5">100点単位で入力（4人の合計が100,000点）。「確定」でキーボードを閉じます</div>

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
