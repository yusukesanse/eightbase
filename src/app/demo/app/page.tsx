"use client";

/**
 * ミニアプリ デモ（認証不要・モックデータ）
 * 麻雀リーグ: ピラミッド順位表 / 参加表明・スコア申告
 * ※卓は管理者が自動で組む運用（利用者は参加表明と申告のみ）
 */

import { useState } from "react";
import Link from "next/link";
import type { MahjongStanding, MahjongTable } from "@/types";
import { MOCK_STANDINGS, MOCK_TABLES, MOCK_ME } from "../mock";

type Tab = "league" | "tables";

export default function DemoMiniAppPage() {
  const [tab, setTab] = useState<Tab>("league");
  const [tables, setTables] = useState<MahjongTable[]>(MOCK_TABLES);
  const [entered, setEntered] = useState(false);
  const [reportTable, setReportTable] = useState<MahjongTable | null>(null);

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      <div className="max-w-md mx-auto min-h-screen bg-[#FAF7F2] pb-24 relative">
        {/* デモバナー */}
        <div className="bg-[#231714] text-white text-center text-[11px] py-1.5">
          デモ画面（サンプルデータ） —{" "}
          <Link href="/demo" className="underline">
            デモ一覧へ
          </Link>
        </div>

        {/* ヘッダー */}
        <header className="px-4 pt-5 pb-3">
          <h1 className="text-xl font-bold text-[#231714]">麻雀リーグ</h1>
          <p className="text-xs text-[#231714]/50 mt-0.5">2026前期シーズン</p>
        </header>

        {/* タブ */}
        <div className="px-4">
          <div className="flex gap-1 bg-[#231714]/5 rounded-xl p-1">
            {(
              [
                { id: "league", label: "リーグ順位" },
                { id: "tables", label: "参加・スコア申告" },
              ] as { id: Tab; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                  tab === t.id
                    ? "bg-white text-[#231714] shadow-sm"
                    : "text-[#231714]/40"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {tab === "league" ? (
          <LeaguePyramid standings={MOCK_STANDINGS} />
        ) : (
          <TablesSection
            tables={tables}
            entered={entered}
            onToggleEntry={() => setEntered((v) => !v)}
            onReport={(t) => setReportTable(t)}
          />
        )}

        {/* ボトムナビ（デモ用ダミー） */}
        <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-white border-t border-gray-200 grid grid-cols-5 z-50">
          {["ホーム", "予約", "ゲーム", "掲示板", "マイページ"].map((label) => (
            <div
              key={label}
              className={`flex flex-col items-center justify-center py-3 gap-1 text-[10px] ${
                label === "ゲーム" ? "text-[#A5C1C8] font-medium" : "text-gray-400"
              }`}
            >
              <span className={`w-5 h-5 rounded ${label === "ゲーム" ? "bg-[#A5C1C8]" : "bg-gray-200"}`} />
              {label}
            </div>
          ))}
        </nav>

        {reportTable && (
          <ReportModal
            table={reportTable}
            onClose={() => setReportTable(null)}
            onReported={(updated) => {
              setTables((prev) =>
                prev.map((t) => (t.tableId === updated.tableId ? updated : t))
              );
              setReportTable(null);
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ───────── ピラミッド（Jリーグ式） ───────── */

function LeaguePyramid({ standings }: { standings: MahjongStanding[] }) {
  const m1 = standings.filter((s) => s.tier === "M1");
  const m2 = standings.filter((s) => s.tier === "M2");
  const m3 = standings.filter((s) => s.tier === "M3");

  return (
    <div className="px-4 mt-4 space-y-4">
      <TierBlock
        label="M1"
        sub="トップリーグ"
        color="bg-gradient-to-b from-yellow-50 to-white border-yellow-300"
        badge="bg-yellow-400 text-white"
        players={m1}
        narrow
      />
      <TierBlock
        label="M2"
        sub="セカンドリーグ"
        color="bg-gradient-to-b from-gray-50 to-white border-gray-300"
        badge="bg-gray-400 text-white"
        players={m2}
        narrow={false}
      />
      <TierBlock
        label="M3"
        sub="チャレンジリーグ"
        color="bg-gradient-to-b from-orange-50 to-white border-orange-200"
        badge="bg-orange-300 text-white"
        players={m3}
        narrow={false}
        wide
      />
      <p className="text-[11px] text-[#231714]/40 text-center pb-2">
        順位はシーズン通算アベレージ（最終持ち点の平均）。毎月のリーグ戦後に入れ替えがあります。
      </p>
    </div>
  );
}

function TierBlock({
  label,
  sub,
  color,
  badge,
  players,
  narrow,
  wide,
}: {
  label: string;
  sub: string;
  color: string;
  badge: string;
  players: MahjongStanding[];
  narrow?: boolean;
  wide?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border ${color} p-3 ${
        narrow ? "mx-6" : wide ? "" : "mx-3"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-bold ${badge}`}>
          {label}
        </span>
        <span className="text-[11px] text-[#231714]/40">{sub}</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {players.map((p) => (
          <div
            key={p.lineUserId}
            className={`rounded-xl px-3 py-2 flex items-center gap-2 ${
              p.lineUserId === MOCK_ME.lineUserId
                ? "bg-[#A5C1C8]/20 ring-1 ring-[#A5C1C8]"
                : "bg-white border border-[#231714]/5"
            }`}
          >
            <span className="text-xs font-bold text-[#231714]/40 w-6">{p.rank}位</span>
            <div className="min-w-0">
              <div className="text-xs font-medium text-[#231714] truncate">{p.displayName}</div>
              <div className="text-[10px] text-[#231714]/50">{p.average.toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────── 卓一覧＋申告 ───────── */

function TablesSection({
  tables,
  entered,
  onToggleEntry,
  onReport,
}: {
  tables: MahjongTable[];
  entered: boolean;
  onToggleEntry: () => void;
  onReport: (t: MahjongTable) => void;
}) {
  return (
    <div className="px-4 mt-4 space-y-3">
      <button
        onClick={onToggleEntry}
        className={`w-full py-3 rounded-xl text-sm font-bold transition-colors ${
          entered
            ? "bg-[#231714]/5 text-[#231714]/60 border border-[#231714]/10"
            : "bg-[#B0E401] text-[#231714] hover:opacity-90"
        }`}
      >
        {entered ? "参加表明済み（取り消す）" : "今回のリーグ戦に参加表明する"}
      </button>
      <p className="text-[11px] text-[#231714]/40 px-1">
        卓は参加表明者をもとに管理者が自動で組みます。組まれた卓が下に表示されます。
      </p>

      {tables.map((t) => {
        const me = t.members.find((m) => m.lineUserId === MOCK_ME.lineUserId);
        const needsMyReport = me && me.points === null && t.status !== "completed";
        return (
          <div key={t.tableId} className="bg-white rounded-2xl border border-[#231714]/10 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-[#231714]">{t.eventDate} の卓</span>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  t.status === "completed"
                    ? "bg-[#B0E401]/20 text-[#231714]"
                    : "bg-orange-50 text-orange-600"
                }`}
              >
                {t.status === "completed" ? "集計済み" : "申告待ち"}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {t.members.map((m) => (
                <div key={m.lineUserId} className="bg-gray-50 rounded-lg p-2">
                  <div className="text-[11px] font-medium text-[#231714] truncate">
                    {m.displayName}
                    {m.lineUserId === MOCK_ME.lineUserId && (
                      <span className="ml-1 text-[#A5C1C8]">（自分）</span>
                    )}
                  </div>
                  {m.points !== null ? (
                    <div className="text-[11px] text-[#231714]/60 mt-0.5">
                      {m.rank}位 / {m.points.toLocaleString()}点
                    </div>
                  ) : (
                    <div className="text-[11px] text-orange-500 mt-0.5">未申告</div>
                  )}
                </div>
              ))}
            </div>

            {me && t.status !== "completed" && (
              <button
                onClick={() => onReport(t)}
                className={`mt-3 w-full py-2.5 rounded-xl text-sm font-bold ${
                  needsMyReport
                    ? "bg-[#231714] text-white"
                    : "bg-[#231714]/5 text-[#231714]/60"
                }`}
              >
                {needsMyReport ? "自分のスコアを申告する" : "申告をやり直す"}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ───────── スコア申告モーダル ───────── */

function ReportModal({
  table,
  onClose,
  onReported,
}: {
  table: MahjongTable;
  onClose: () => void;
  onReported: (t: MahjongTable) => void;
}) {
  const me = table.members.find((m) => m.lineUserId === MOCK_ME.lineUserId)!;
  const [points, setPoints] = useState(me.points !== null ? String(me.points) : "");
  const [rank, setRank] = useState<number | null>(me.rank);
  const [error, setError] = useState<string | null>(null);

  function submit() {
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
    const members = table.members.map((m) =>
      m.lineUserId === MOCK_ME.lineUserId
        ? { ...m, points: p, rank, reportedAt: new Date().toISOString() }
        : m
    );
    const allReported = members.every((m) => m.points !== null);
    const total = members.reduce((s, m) => s + (m.points ?? 0), 0);
    const ok = allReported && total === 100000;
    onReported({
      ...table,
      members,
      status: ok ? "completed" : "reporting",
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#231714]">スコアを申告</h3>
        <p className="text-xs text-[#231714]/50 mt-1 mb-4">
          {table.eventDate} の卓 / 4人の合計が100,000点になると自動で確定します
        </p>

        <label className="block text-xs font-medium text-[#231714]/60 mb-1">
          最終持ち点
        </label>
        <input
          type="number"
          step={100}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          placeholder="例: 32000"
          className="w-full px-4 py-3 text-base border border-[#231714]/10 rounded-xl text-right"
        />

        <label className="block text-xs font-medium text-[#231714]/60 mt-4 mb-1">
          卓内順位
        </label>
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setRank(n)}
              className={`py-3 rounded-xl text-sm font-bold border ${
                rank === n
                  ? "bg-[#231714] text-white border-[#231714]"
                  : "bg-white text-[#231714]/60 border-[#231714]/10"
              }`}
            >
              {n}位
            </button>
          ))}
        </div>

        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-3 text-sm font-medium text-[#231714]/60 border border-[#231714]/10 rounded-xl"
          >
            キャンセル
          </button>
          <button
            onClick={submit}
            className="flex-1 py-3 text-sm font-bold text-[#231714] bg-[#B0E401] rounded-xl"
          >
            申告する
          </button>
        </div>
      </div>
    </div>
  );
}
