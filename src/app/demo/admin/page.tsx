"use client";

/**
 * 管理画面デモ（認証不要・モックデータ）
 * 麻雀リーグ: 通算順位表 / 卓の申告状況 / スコア修正
 */

import { useState } from "react";
import Link from "next/link";
import type { MahjongLeagueTier, MahjongTable } from "@/types";
import { MOCK_STANDINGS, MOCK_TABLES } from "../mock";

const TIER_STYLES: Record<MahjongLeagueTier, string> = {
  M1: "bg-yellow-100 text-yellow-700",
  M2: "bg-gray-100 text-gray-700",
  M3: "bg-orange-50 text-orange-600",
};

export default function DemoAdminPage() {
  const [tables, setTables] = useState<MahjongTable[]>(MOCK_TABLES);
  const [editTable, setEditTable] = useState<MahjongTable | null>(null);

  return (
    <div className="min-h-screen bg-[#FAF7F2]">
      {/* デモバナー */}
      <div className="bg-[#231714] text-white text-center text-[11px] py-1.5">
        デモ画面（サンプルデータ） —{" "}
        <Link href="/demo" className="underline">
          デモ一覧へ
        </Link>
      </div>

      <div className="max-w-5xl mx-auto p-4 sm:p-8 space-y-8">
        <div>
          <h1 className="text-xl font-bold text-[#231714]">麻雀リーグ管理</h1>
          <p className="text-xs text-[#231714]/85 mt-0.5">2026前期シーズン</p>
        </div>

        {/* 順位表 */}
        <section>
          <h2 className="text-sm font-bold text-[#231714] mb-3">通算アベレージ順位表</h2>
          <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-[#231714]/5">
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-[#231714]/80 w-14">順位</th>
                  <th className="text-center px-2 py-2.5 text-xs font-medium text-[#231714]/80 w-16">リーグ</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/80">プレイヤー</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-[#231714]/80">アベレージ</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-[#231714]/80 w-20">試合数</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_STANDINGS.map((s) => (
                  <tr key={s.lineUserId} className="border-b border-[#231714]/5">
                    <td className="px-4 py-3 text-center text-sm text-[#231714]/85 font-medium">{s.rank}</td>
                    <td className="px-2 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${TIER_STYLES[s.tier]}`}>
                        {s.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-[#231714]">{s.displayName}</td>
                    <td className="px-4 py-3 text-right text-sm font-bold text-[#231714]">
                      {s.average.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-[#231714]/85">{s.gamesPlayed}試合</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 卓一覧 */}
        <section>
          <h2 className="text-sm font-bold text-[#231714] mb-3">卓一覧（申告状況）</h2>
          <div className="space-y-3">
            {tables.map((t) => (
              <div key={t.tableId} className="bg-white rounded-xl border border-[#231714]/10 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[#231714]">{t.eventDate}</span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        t.status === "completed"
                          ? "bg-[#B0E401]/20 text-[#231714]"
                          : "bg-orange-50 text-orange-600"
                      }`}
                    >
                      {t.status === "completed" ? "集計済み" : "申告待ち"}
                    </span>
                  </div>
                  <button
                    onClick={() => setEditTable(t)}
                    className="px-3 py-1.5 text-xs font-medium text-[#231714]/80 hover:text-[#231714] border border-[#231714]/10 rounded-lg hover:bg-gray-50"
                  >
                    修正
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {t.members.map((m) => (
                    <div key={m.lineUserId} className="bg-gray-50 rounded-lg p-2.5">
                      <div className="text-xs font-medium text-[#231714] truncate">{m.displayName}</div>
                      {m.points !== null ? (
                        <div className="mt-1 text-xs text-[#231714]/80">
                          {m.rank}位 / {m.points.toLocaleString()}点
                        </div>
                      ) : (
                        <div className="mt-1 text-xs text-orange-500">未申告</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {editTable && (
        <EditModal
          table={editTable}
          onClose={() => setEditTable(null)}
          onSaved={(updated) => {
            setTables((prev) =>
              prev.map((t) => (t.tableId === updated.tableId ? updated : t))
            );
            setEditTable(null);
          }}
        />
      )}
    </div>
  );
}

/* ───────── 修正モーダル（デモ） ───────── */

function EditModal({
  table,
  onClose,
  onSaved,
}: {
  table: MahjongTable;
  onClose: () => void;
  onSaved: (t: MahjongTable) => void;
}) {
  const [rows, setRows] = useState(
    table.members.map((m) => ({
      ...m,
      pointsStr: m.points !== null ? String(m.points) : "",
      rankStr: m.rank !== null ? String(m.rank) : "",
    }))
  );
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((s, r) => s + (Number(r.pointsStr) || 0), 0);

  function save() {
    setError(null);
    if (rows.some((r) => r.pointsStr === "" || r.rankStr === "")) {
      setError("全員の点数と順位を入力してください");
      return;
    }
    if (total !== 100000) {
      setError(`合計が ${total.toLocaleString()} 点です（100,000点になる必要があります）`);
      return;
    }
    onSaved({
      ...table,
      members: rows.map((r) => ({
        lineUserId: r.lineUserId,
        displayName: r.displayName,
        pictureUrl: r.pictureUrl,
        points: Number(r.pointsStr),
        rank: Number(r.rankStr),
        reportedAt: r.reportedAt ?? new Date().toISOString(),
      })),
      status: "completed",
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-[#231714] mb-1">申告内容の修正</h3>
        <p className="text-xs text-[#231714]/85 mb-4">合計は 100,000 点になる必要があります</p>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.lineUserId} className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-[#231714] truncate">{r.displayName}</span>
              <select
                value={r.rankStr}
                onChange={(e) =>
                  setRows((prev) => prev.map((p, j) => (j === i ? { ...p, rankStr: e.target.value } : p)))
                }
                className="w-20 px-2 py-2 text-sm border border-[#231714]/10 rounded-lg bg-white"
              >
                <option value="">順位</option>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>{n}位</option>
                ))}
              </select>
              <input
                type="number"
                step={100}
                value={r.pointsStr}
                onChange={(e) =>
                  setRows((prev) => prev.map((p, j) => (j === i ? { ...p, pointsStr: e.target.value } : p)))
                }
                placeholder="点数"
                className="w-28 px-3 py-2 text-sm border border-[#231714]/10 rounded-lg text-right"
              />
            </div>
          ))}
        </div>

        <div className={`mt-3 text-right text-xs font-medium ${total === 100000 ? "text-[#231714]/85" : "text-red-500"}`}>
          合計: {total.toLocaleString()} 点
        </div>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium text-[#231714]/80 border border-[#231714]/10 rounded-xl hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            className="flex-1 py-2.5 text-sm font-bold text-[#231714] bg-[#B0E401] rounded-xl hover:opacity-90"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
