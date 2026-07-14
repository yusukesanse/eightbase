"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import type {
  MahjongStanding,
  MahjongTable,
  MahjongLeagueTier,
  MahjongLeagueAssignment,
  MahjongDayState,
} from "@/types";

/* ───────── 定数 ───────── */

const TIER_STYLES: Record<MahjongLeagueTier, string> = {
  M1: "bg-yellow-100 text-yellow-700",
  M2: "bg-gray-100 text-gray-600",
  M3: "bg-orange-50 text-orange-600",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** "YYYY-MM-DD" を "M/D（曜）" に整形（日付部品から Date を作るのでTZの影響を受けない）。 */
function formatEventDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return d;
  const wd = WEEKDAYS[new Date(y, m - 1, day).getDay()];
  return `${m}/${day}（${wd}）`;
}

/* ───────── メインコンポーネント ───────── */

export default function SeasonMahjongPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [standings, setStandings] = useState<MahjongStanding[]>([]);
  const [tables, setTables] = useState<MahjongTable[]>([]);
  const [assignments, setAssignments] = useState<MahjongLeagueAssignment[]>([]);
  const [dayStates, setDayStates] = useState<MahjongDayState[]>([]);
  const [loading, setLoading] = useState(true);
  const [editTable, setEditTable] = useState<MahjongTable | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [viewAssignment, setViewAssignment] = useState<MahjongLeagueAssignment | null>(null);
  const [tab, setTab] = useState<"standings" | "tables" | "rotation" | "history">("standings");
  // 卓一覧タブ: 選択中の開催日（日付を選ぶとその日の卓だけ表示する）
  const [tableDate, setTableDate] = useState<string | null>(null);

  // 卓が存在する開催日（新しい順）。日付セレクタの選択肢に使う。
  const tableDates = useMemo(
    () => Array.from(new Set(tables.map((t) => t.eventDate))).sort((a, b) => b.localeCompare(a)),
    [tables]
  );
  // 既定は最新の開催日。選択が消えた（データ更新で無くなった）場合も最新へ寄せる。
  useEffect(() => {
    if (tableDates.length === 0) {
      if (tableDate !== null) setTableDate(null);
    } else if (!tableDate || !tableDates.includes(tableDate)) {
      setTableDate(tableDates[0]);
    }
  }, [tableDates, tableDate]);

  // 選択日の卓（半荘→卓ラベル順）。手動作成卓(round=undefined)は末尾にまとめる。
  const dayTables = useMemo(() => {
    if (!tableDate) return [];
    return tables
      .filter((t) => t.eventDate === tableDate)
      .sort((a, b) => {
        const ra = a.round ?? Number.MAX_SAFE_INTEGER;
        const rb = b.round ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return (a.tableLabel ?? "").localeCompare(b.tableLabel ?? "");
      });
  }, [tables, tableDate]);

  // silent=true はバックグラウンド更新（ポーリング）。loading を触らず全画面スピナーを出さない。
  const fetchAll = useCallback(async (silent = false) => {
    if (!seasonId) return;
    if (!silent) setLoading(true);
    try {
      const [sRes, tRes, lRes, dRes] = await Promise.all([
        fetch(`/api/admin/mahjong/standings?seasonId=${seasonId}`, { credentials: "same-origin" }),
        fetch(`/api/admin/mahjong/tables?seasonId=${seasonId}`, { credentials: "same-origin" }),
        fetch(`/api/admin/mahjong/leagues?seasonId=${seasonId}`, { credentials: "same-origin" }),
        fetch(`/api/admin/mahjong/day-states?seasonId=${seasonId}`, { credentials: "same-origin" }),
      ]);
      const sData = await sRes.json();
      const tData = await tRes.json();
      const lData = await lRes.json();
      const dData = await dRes.json();
      setStandings(sData.standings ?? []);
      setTables(tData.tables ?? []);
      setAssignments(lData.assignments ?? []);
      setDayStates(dData.dayStates ?? []);
    } catch {
      setStandings([]);
      setTables([]);
      setAssignments([]);
      setDayStates([]);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
  // 当日進行（抜け番）などを追従（15秒ポーリング＋復帰時）。ポーリングはサイレント更新。
  useAutoRefresh(() => fetchAll(true), 15000);

  async function resetDay(eventDate: string) {
    if (!confirm(`${eventDate} の当日進行（卓・待機・交代）をリセットします。\n開催日に支払い済み参加者から自動で組み直されます。よろしいですか？`)) return;
    const res = await fetch(`/api/admin/mahjong/day-states?seasonId=${seasonId}&eventDate=${eventDate}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "リセットに失敗しました");
    } else fetchAll();
  }

  async function confirmLeague() {
    if (
      !confirm(
        "現時点の通算順位でリーグ編成（M1/M2/M3）を確定します。\n確定内容は履歴として保存され、次回の卓組み・CSシードの基準になります。よろしいですか？"
      )
    )
      return;
    setConfirming(true);
    try {
      const res = await fetch(`/api/admin/mahjong/leagues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) alert(data.error ?? "確定に失敗しました");
      else fetchAll();
    } catch {
      alert("確定に失敗しました");
    } finally {
      setConfirming(false);
    }
  }

  async function deleteAssignment(assignmentId: string) {
    if (!confirm("この確定済みリーグ編成を取り消しますか？")) return;
    const res = await fetch(`/api/admin/mahjong/leagues/${assignmentId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) fetchAll();
    else alert("取消に失敗しました");
  }

  async function deleteTable(tableId: string) {
    if (!confirm("この卓を削除しますか？（集計からも除外されます）")) return;
    const res = await fetch(`/api/admin/mahjong/tables/${tableId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) fetchAll();
    else alert("削除に失敗しました");
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  const TABS = [
    { id: "standings" as const, label: "通算アベレージ順位表" },
    { id: "tables" as const, label: "卓一覧" },
    { id: "rotation" as const, label: "当日進行（抜け番）" },
    { id: "history" as const, label: "リーグ確定履歴" },
  ];

  return (
    <div className="p-4 sm:p-8 space-y-6">
      {/* ───── 内部タブ切替 ───── */}
      <div className="flex gap-1 border-b border-[#231714]/10">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? "border-[#231714] text-[#231714]"
                : "border-transparent text-[#231714]/40 hover:text-[#231714]/70"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ───── 通算アベレージ順位表 ───── */}
      <section className={tab === "standings" ? "" : "hidden"}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-[#231714]">
            通算アベレージ順位表（リーグ別）
          </h2>
          <button
            onClick={confirmLeague}
            disabled={confirming || standings.length === 0}
            className="px-4 py-2 text-xs font-bold text-[#231714] bg-[#B0E401] rounded-lg hover:opacity-90 disabled:opacity-40"
          >
            {confirming ? "確定中..." : "この順位でリーグを確定"}
          </button>
        </div>
        {standings.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
            集計済みの卓がまだありません
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-[#231714]/5">
                  <th className="text-center px-4 py-2.5 text-xs font-medium text-[#231714]/60 w-14">順位</th>
                  <th className="text-center px-2 py-2.5 text-xs font-medium text-[#231714]/60 w-16">リーグ</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-[#231714]/60">プレイヤー</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-[#231714]/60">アベレージ</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-[#231714]/60 w-20">試合数</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((s) => (
                  <tr key={s.lineUserId} className="border-b border-[#231714]/5 hover:bg-[#231714]/[0.02]">
                    <td className="px-4 py-3 text-center text-sm text-[#231714]/70 font-medium">{s.rank}</td>
                    <td className="px-2 py-3 text-center">
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${TIER_STYLES[s.tier]}`}>
                        {s.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {s.pictureUrl ? (
                          <img src={s.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#A5C1C8]">
                            {s.displayName.charAt(0)}
                          </div>
                        )}
                        <span className="text-sm font-medium text-[#231714]">{s.displayName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-[#231714]">{s.average.toLocaleString()}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-[#231714]/50">{s.gamesPlayed}試合</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ───── 卓一覧（日付を選ぶとその日の卓だけ表示） ───── */}
      <section className={tab === "tables" ? "" : "hidden"}>
        <h2 className="text-sm font-bold text-[#231714] mb-3">卓一覧（申告状況）</h2>
        {tables.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
            卓がまだ作成されていません
          </div>
        ) : (
          <>
            {/* 開催日セレクタ（卓のある日だけ・新しい順） */}
            <div className="mb-4">
              <div className="text-[11px] font-bold text-[#231714]/50 mb-1.5">開催日</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {tableDates.map((d) => {
                  const active = d === tableDate;
                  const n = tables.filter((t) => t.eventDate === d).length;
                  return (
                    <button
                      key={d}
                      onClick={() => setTableDate(d)}
                      className={`shrink-0 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        active
                          ? "bg-[#231714] text-white border-[#231714]"
                          : "bg-white text-[#231714]/70 border-[#231714]/10 hover:bg-gray-50"
                      }`}
                    >
                      {formatEventDate(d)}
                      <span className={`ml-1.5 text-xs ${active ? "text-white/60" : "text-[#231714]/35"}`}>{n}卓</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {dayTables.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
                この開催日の卓はありません
              </div>
            ) : (
              <div className="space-y-3">
                {dayTables.map((t) => (
                  <div key={t.tableId} className="bg-white rounded-xl border border-[#231714]/10 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[#231714]">
                          {t.round != null ? `第${t.round}半荘` : "手動作成"}
                          {t.tableLabel ? ` ・ ${t.tableLabel}卓` : ""}
                        </span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            t.status === "completed"
                              ? "bg-[#B0E401]/20 text-[#231714]"
                              : "bg-orange-50 text-orange-600"
                          }`}
                        >
                          {t.status === "completed" ? "集計済み" : "申告待ち"}
                        </span>
                        {t.needsReview && (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-red-50 text-red-600">
                            要確認
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditTable(t)}
                          className="px-3 py-1.5 text-xs font-medium text-[#231714]/60 hover:text-[#231714] border border-[#231714]/10 rounded-lg hover:bg-gray-50"
                        >
                          修正
                        </button>
                        <button
                          onClick={() => deleteTable(t.tableId)}
                          className="px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {t.members.map((m) => (
                        <div key={m.lineUserId} className="bg-gray-50 rounded-lg p-2.5">
                          <div className="text-xs font-medium text-[#231714] truncate">{m.displayName}</div>
                          {m.points !== null ? (
                            <div className="mt-1 text-xs text-[#231714]/60">
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
            )}
          </>
        )}
      </section>

      {/* ───── 当日進行（抜け番） ───── */}
      <section className={tab === "rotation" ? "" : "hidden"}>
        <h2 className="text-sm font-bold text-[#231714] mb-1">当日進行（抜け番）</h2>
        <p className="text-xs text-[#231714]/50 mb-3">
          利用者アプリと同じ mahjongDayState を表示しています（現ラウンド・待機順・直近の交代）。
        </p>
        {dayStates.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
            進行中の開催日はありません（参加者から自動で卓が組まれると表示されます）
          </div>
        ) : (
          <div className="space-y-3">
            {dayStates.map((d) => (
              <div key={d.eventDate} className="bg-white rounded-xl border border-[#231714]/10 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold text-[#231714]">{d.eventDate}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-[#A5C1C8]/20 text-[#231714]">
                      第{d.round}半荘・{(d.tableLabels ?? []).length}卓
                    </span>
                    <button
                      onClick={() => resetDay(d.eventDate)}
                      className="text-[11px] font-medium text-[#a1502c] border border-[#f0c9b0] rounded-lg px-2 py-1 hover:bg-[#fff4ec]"
                    >
                      進行をリセット
                    </button>
                  </div>
                </div>

                <div className="text-[11px] font-bold text-[#231714]/50 mb-1">待機順（先頭が次にIN）</div>
                {(d.waiting ?? []).length === 0 ? (
                  <div className="text-xs text-[#231714]/40 mb-3">待機者なし</div>
                ) : (
                  <ol className="flex flex-wrap gap-1.5 mb-3">
                    {d.waiting.map((w, i) => (
                      <li key={w.lineUserId} className="text-xs bg-gray-50 border border-[#231714]/10 rounded-full px-2.5 py-1">
                        {i + 1}. {w.displayName}
                      </li>
                    ))}
                  </ol>
                )}

                {d.lastSwap ? (
                  <div className="rounded-lg bg-gray-50 p-2.5">
                    <div className="text-[11px] font-bold text-[#231714]/60 mb-1">
                      直近の交代（第{d.lastSwap.round}半荘 → 第{d.lastSwap.round + 1}半荘）
                    </div>
                    {d.lastSwap.reason && (
                      <div className="text-[11px] font-bold text-[#b48f13] mb-1">{d.lastSwap.reason}</div>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <span className="text-[#c0563c] font-bold">OUT: {d.lastSwap.out.map((p) => p.displayName).join("、") || "なし"}</span>
                      <span className="text-[#6f9023] font-bold">IN: {d.lastSwap.in.map((p) => p.displayName).join("、") || "なし"}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-[#231714]/40">まだ交代はありません（第1半荘）</div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ───── リーグ確定履歴 ───── */}
      <section className={tab === "history" ? "" : "hidden"}>
        <div className="mb-3">
          <h2 className="text-sm font-bold text-[#231714]">
            リーグ確定履歴
          </h2>
          <p className="text-xs text-[#231714]/50 mt-1">
            「リーグを確定」した時点の順位（M1/M2/M3）をスナップショットとして記録します。次回の卓組みやCSのシード権の基準になります。
          </p>
        </div>
        {assignments.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
            まだリーグが確定されていません
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => {
              const counts = a.entries.reduce(
                (acc, e) => {
                  acc[e.tier] += 1;
                  return acc;
                },
                { M1: 0, M2: 0, M3: 0 } as Record<MahjongLeagueTier, number>
              );
              return (
                <div
                  key={a.assignmentId}
                  className="bg-white rounded-xl border border-[#231714]/10 p-4 flex items-center justify-between"
                >
                  <div>
                    <div className="text-sm font-medium text-[#231714]">
                      {a.eventDate} 終了時点で確定
                    </div>
                    <div className="text-xs text-[#231714]/50 mt-0.5">
                      M1 {counts.M1}名 / M2 {counts.M2}名 / M3 {counts.M3}名・
                      対象{a.tableCount}卓・
                      {new Date(a.confirmedAt).toLocaleString("ja-JP")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setViewAssignment(a)}
                      className="px-3 py-1.5 text-xs font-medium text-[#231714]/60 hover:text-[#231714] border border-[#231714]/10 rounded-lg hover:bg-gray-50"
                    >
                      内容
                    </button>
                    <button
                      onClick={() => deleteAssignment(a.assignmentId)}
                      className="px-3 py-1.5 text-xs font-medium text-red-500 hover:text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                    >
                      取消
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editTable && (
        <EditTableModal
          table={editTable}
          onClose={() => setEditTable(null)}
          onSaved={() => {
            setEditTable(null);
            fetchAll();
          }}
        />
      )}

      {viewAssignment && (
        <AssignmentModal
          assignment={viewAssignment}
          onClose={() => setViewAssignment(null)}
        />
      )}
    </div>
  );
}

/* ───────── 編成スナップショット閲覧モーダル ───────── */

function AssignmentModal({
  assignment,
  onClose,
}: {
  assignment: MahjongLeagueAssignment;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#231714] mb-1">確定リーグ編成</h3>
        <p className="text-xs text-[#231714]/50 mb-4">
          {assignment.eventDate} 終了時点 /{" "}
          {new Date(assignment.confirmedAt).toLocaleString("ja-JP")}
        </p>
        <div className="space-y-1.5">
          {assignment.entries.map((e) => (
            <div key={e.lineUserId} className="flex items-center gap-3 text-sm">
              <span className="w-7 text-right text-[#231714]/40 text-xs">{e.rank}</span>
              <span
                className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold ${TIER_STYLES[e.tier]}`}
              >
                {e.tier}
              </span>
              <span className="flex-1 text-[#231714] truncate">{e.displayName}</span>
              <span className="text-[#231714]/60 text-xs">{e.average.toLocaleString()}</span>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full py-2.5 text-sm font-medium text-[#231714]/60 border border-[#231714]/10 rounded-xl hover:bg-gray-50"
        >
          閉じる
        </button>
      </div>
    </div>
  );
}

/* ───────── 修正モーダル ───────── */

function EditTableModal({
  table,
  onClose,
  onSaved,
}: {
  table: MahjongTable;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState(
    table.members.map((m) => ({
      lineUserId: m.lineUserId,
      displayName: m.displayName,
      points: m.points !== null ? String(m.points) : "",
      rank: m.rank !== null ? String(m.rank) : "",
    }))
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = rows.reduce((sum, r) => sum + (Number(r.points) || 0), 0);

  async function save() {
    setError(null);
    for (const r of rows) {
      if (r.points === "" || r.rank === "") {
        setError("全員の点数と順位を入力してください");
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/mahjong/tables/${table.tableId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          members: rows.map((r) => ({
            lineUserId: r.lineUserId,
            points: Number(r.points),
            rank: Number(r.rank),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "更新に失敗しました");
      } else if (!data.validation?.ok) {
        setError(`保存しましたが検証未通過です: ${data.validation?.error ?? ""}`);
        onSaved();
      } else {
        onSaved();
      }
    } catch {
      setError("更新に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#231714] mb-1">申告内容の修正</h3>
        <p className="text-xs text-[#231714]/50 mb-4">
          {table.eventDate} の卓 / 合計は 100,000 点になる必要があります
        </p>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={r.lineUserId} className="flex items-center gap-2">
              <span className="flex-1 text-sm font-medium text-[#231714] truncate">{r.displayName}</span>
              <select
                value={r.rank}
                onChange={(e) =>
                  setRows((prev) => prev.map((p, j) => (j === i ? { ...p, rank: e.target.value } : p)))
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
                value={r.points}
                onChange={(e) =>
                  setRows((prev) => prev.map((p, j) => (j === i ? { ...p, points: e.target.value } : p)))
                }
                placeholder="点数"
                className="w-28 px-3 py-2 text-sm border border-[#231714]/10 rounded-lg text-right"
              />
            </div>
          ))}
        </div>

        <div className={`mt-3 text-right text-xs font-medium ${total === 100000 ? "text-[#231714]/50" : "text-red-500"}`}>
          合計: {total.toLocaleString()} 点
        </div>

        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium text-[#231714]/60 border border-[#231714]/10 rounded-xl hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-bold text-[#231714] bg-[#B0E401] rounded-xl hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
