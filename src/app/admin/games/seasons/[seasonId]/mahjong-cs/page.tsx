"use client";

import { useEffect, useState, useCallback } from "react";
import DatePicker from "@/components/ui/DatePicker";
import type { MahjongCsEvent, MahjongCsMatch, MahjongLeagueTier } from "@/types";
import { todayJst } from "@/lib/date";

const TIER_STYLES: Record<MahjongLeagueTier, string> = {
  M1: "bg-yellow-100 text-yellow-700",
  M2: "bg-sky-100 text-sky-700",
  M3: "bg-orange-50 text-orange-600",
};
// リーグ未参加の自己エントリー者（tier 未設定）用の表示。
const NON_LEAGUE_TIER_STYLE = "bg-gray-100 text-gray-600";

export default function SeasonMahjongCsPage() {
  const [events, setEvents] = useState<MahjongCsEvent[]>([]);
  const [selected, setSelected] = useState<MahjongCsEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("チャンピオンシップ");
  const [eventDate, setEventDate] = useState(todayJst());
  const [editMatch, setEditMatch] = useState<MahjongCsMatch | null>(null);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/mahjong/cs`, { credentials: "same-origin" });
      const data = await res.json();
      setEvents(data.events ?? []);
      // 選択中イベントを更新
      setSelected((cur) => {
        if (!cur) return data.events?.[0] ?? null;
        return (data.events ?? []).find((e: MahjongCsEvent) => e.csEventId === cur.csEventId) ?? null;
      });
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  async function createEvent() {
    const res = await fetch(`/api/admin/mahjong/cs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ name, eventDate }),
    });
    const data = await res.json();
    if (!res.ok) alert(data.error ?? "作成に失敗しました");
    else {
      setSelected(data.event);
      fetchEvents();
    }
  }

  async function resetBracket() {
    if (!selected) return;
    if (!confirm("進行をリセットします（試合結果・優勝者を破棄し、確定日に予選から再生成）。よろしいですか？")) return;
    const res = await fetch(`/api/admin/mahjong/cs/${selected.csEventId}/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "resetBracket" }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "リセットに失敗しました");
    } else fetchEvents();
  }

  async function deleteEvent() {
    if (!selected || !confirm("このCSを削除しますか？")) return;
    const res = await fetch(`/api/admin/mahjong/cs/${selected.csEventId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (res.ok) {
      setSelected(null);
      fetchEvents();
    }
  }

  async function removeEntrant(lineUserId: string) {
    if (!selected) return;
    await fetch(`/api/admin/mahjong/cs/${selected.csEventId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ removeUserId: lineUserId }),
    });
    fetchEvents();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  const seedCount = selected?.entrants.filter((e) => e.seed).length ?? 0;

  return (
    <div className="p-4 sm:p-8 space-y-8">
      {/* CS作成 */}
      <section className="bg-white rounded-xl border border-[#231714]/10 p-4">
        <h2 className="text-sm font-bold text-[#231714] mb-3">チャンピオンシップを作成</h2>
        <p className="text-xs text-[#231714]/65 mb-3">
          CSは誰でも参加可（資格制限なし）。最新の確定リーグ編成にいる全員を参戦者として取り込みます。
          <b>開催日を指定して作成すると、その確定日になった時点でリーグ順位シード（M1）付きの予選が自動生成されます。</b>
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-[#231714]/60 mb-1">大会名</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg"
            />
          </div>
          <div className="w-40">
            <label className="block text-xs text-[#231714]/60 mb-1">開催日</label>
            <DatePicker value={eventDate} onChange={setEventDate} placeholder="開催日を選択" />
          </div>
          <button
            onClick={createEvent}
            className="px-4 py-2 text-xs font-bold text-[#231714] bg-[#B0E401] rounded-lg hover:opacity-90"
          >
            作成
          </button>
        </div>
      </section>

      {/* イベント選択 */}
      {events.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {events.map((ev) => (
            <button
              key={ev.csEventId}
              onClick={() => setSelected(ev)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${
                selected?.csEventId === ev.csEventId
                  ? "bg-[#231714] text-white border-[#231714]"
                  : "bg-white text-[#231714]/60 border-[#231714]/10"
              }`}
            >
              {ev.name}（{ev.eventDate}）
            </button>
          ))}
        </div>
      )}

      {selected && (
        <>
          {/* ヘッダー */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[#231714]">{selected.name}</h2>
              <p className="text-xs text-[#231714]/65 mt-0.5">
                {selected.eventDate}・参戦{selected.entrants.length}名（シードM1 {seedCount}名）・
                {selected.status === "setup" ? "確定日待ち（当日に自動生成）" : selected.status === "running" ? "進行中" : "終了"}
              </p>
            </div>
            <div className="flex gap-2">
              {selected.rounds.length > 0 && (
                <button
                  onClick={resetBracket}
                  className="px-3 py-2 text-xs font-medium text-[#a1502c] border border-[#f0c9b0] rounded-lg hover:bg-[#fff4ec]"
                >
                  進行をリセット
                </button>
              )}
              <button
                onClick={deleteEvent}
                className="px-3 py-2 text-xs font-medium text-red-500 border border-red-200 rounded-lg hover:bg-red-50"
              >
                削除
              </button>
            </div>
          </div>

          {/* 優勝者 */}
          {selected.championId && (
            <div className="bg-gradient-to-r from-yellow-50 to-white border border-yellow-300 rounded-xl p-4 text-center">
              <div className="text-xs text-yellow-700 font-medium">優勝</div>
              <div className="text-lg font-bold text-[#231714] mt-1">
                {selected.entrants.find((e) => e.lineUserId === selected.championId)?.displayName ??
                  "—"}
              </div>
            </div>
          )}

          {/* 参戦者（setup中のみ編集可） */}
          {selected.status === "setup" && (
            <section>
              <h3 className="text-sm font-bold text-[#231714] mb-2">参戦者</h3>
              {selected.entrants.length === 0 ? (
                <p className="text-xs text-[#231714]/60">
                  参戦者がまだいません。利用者はポータル側から自己エントリーできます。
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selected.entrants
                    .slice()
                    .sort((a, b) => a.rank - b.rank)
                    .map((e) => (
                      <span
                        key={e.lineUserId}
                        className="inline-flex items-center gap-2 bg-white border border-[#231714]/10 rounded-full pl-2 pr-2 py-1.5 text-sm text-[#231714]"
                      >
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${e.tier ? TIER_STYLES[e.tier] : NON_LEAGUE_TIER_STYLE}`}>
                          {e.tier ?? "一般"}
                        </span>
                        {e.displayName}
                        <button
                          onClick={() => removeEntrant(e.lineUserId)}
                          className="text-[#231714]/55 hover:text-red-500"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                </div>
              )}
            </section>
          )}

          {/* ブラケット */}
          <section className="space-y-5">
            {selected.rounds.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/60">
                まだトーナメントが生成されていません
              </div>
            ) : (
              selected.rounds.map((round, ri) => (
                <div key={ri}>
                  <div className="text-xs font-bold text-[#231714]/65 mb-2">
                    {round.label}（各卓 上位{round.advanceCount}名通過）
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {round.matches.map((m) => (
                      <div key={m.matchId} className="bg-white rounded-xl border border-[#231714]/10 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-[#231714]">{m.label}</span>
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                m.status === "completed"
                                  ? "bg-[#B0E401]/20 text-[#231714]"
                                  : "bg-orange-50 text-orange-600"
                              }`}
                            >
                              {m.status === "completed" ? "確定" : "結果待ち"}
                            </span>
                            <button
                              onClick={() => setEditMatch(m)}
                              className="px-2 py-1 text-xs font-medium text-[#231714]/60 border border-[#231714]/10 rounded-lg hover:bg-gray-50"
                            >
                              {m.status === "completed" ? "修正" : "結果入力"}
                            </button>
                          </div>
                        </div>
                        <div className="space-y-1">
                          {[...m.players]
                            .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                            .map((p) => (
                              <div key={p.lineUserId} className="flex items-center justify-between text-sm">
                                <span className="text-[#231714]">{p.displayName}</span>
                                <span className="text-xs text-[#231714]/65">
                                  {p.rank !== null ? `${p.rank}位 / ${p.points?.toLocaleString()}` : "—"}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </section>
        </>
      )}

      {editMatch && selected && (
        <MatchResultModal
          csEventId={selected.csEventId}
          match={editMatch}
          onClose={() => setEditMatch(null)}
          onSaved={() => {
            setEditMatch(null);
            fetchEvents();
          }}
        />
      )}
    </div>
  );
}

/* ───────── 結果入力モーダル ───────── */

function MatchResultModal({
  csEventId,
  match,
  onClose,
  onSaved,
}: {
  csEventId: string;
  match: MahjongCsMatch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState(
    match.players.map((p) => ({
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      points: p.points != null ? String(p.points) : "",
      rank: p.rank != null ? String(p.rank) : "",
    }))
  );
  const wasCompleted = match.status === "completed";
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const total = rows.reduce((s, r) => s + (Number(r.points) || 0), 0);
  const is4 = match.players.length === 4;

  async function save() {
    setError(null);
    if (rows.some((r) => r.points === "" || r.rank === "")) {
      setError("全員の点数と順位を入力してください");
      return;
    }
    if (is4 && total !== 100000) {
      setError(`合計が ${total.toLocaleString()} 点です（100,000点になる必要があります）`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/mahjong/cs/${csEventId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "editMatch",
          matchId: match.matchId,
          results: rows.map((r) => ({
            lineUserId: r.lineUserId,
            points: Number(r.points),
            rank: Number(r.rank),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "保存に失敗しました");
      else onSaved();
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-[#231714] mb-1">
          {match.label} の{wasCompleted ? "結果修正" : "結果入力"}
        </h3>
        <p className="text-xs text-[#231714]/65 mb-2">
          {is4 ? "合計100,000点・" : ""}順位は1〜{match.players.length}を1人ずつ
        </p>
        {wasCompleted && (
          <div className="rounded-lg bg-[#fff4ec] border border-[#f0c9b0] px-3 py-2 text-xs font-bold text-[#a1502c] mb-3">
            ⚠️ 確定済みの試合を修正すると、この試合に依存する<b>以降のラウンドは破棄</b>され組み直しになります。
          </div>
        )}
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
                {match.players.map((_, n) => (
                  <option key={n + 1} value={n + 1}>{n + 1}位</option>
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
        {is4 && (
          <div className={`mt-3 text-right text-xs font-medium ${total === 100000 ? "text-[#231714]/65" : "text-red-500"}`}>
            合計: {total.toLocaleString()} 点
          </div>
        )}
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
            {saving ? "保存中..." : "確定"}
          </button>
        </div>
      </div>
    </div>
  );
}
