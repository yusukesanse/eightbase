"use client";

import { useEffect, useState, useCallback } from "react";
import type { MahjongEntry, MahjongTable, MahjongScheduleEntry } from "@/types";

interface AdminUser {
  lineUserId: string | null;
  displayName: string;
  pictureUrl?: string | null;
}

function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export default function SeasonMatchingPage() {
  const [eventDate, setEventDate] = useState(todayJst());
  const [entries, setEntries] = useState<MahjongEntry[]>([]);
  const [tables, setTables] = useState<MahjongTable[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [leagueDates, setLeagueDates] = useState<MahjongScheduleEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [lastSpectators, setLastSpectators] = useState<{ displayName: string }[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, rRes] = await Promise.all([
        fetch(`/api/admin/mahjong/entries?eventDate=${eventDate}`, { credentials: "same-origin" }),
        fetch(`/api/admin/mahjong/rounds?eventDate=${eventDate}`, { credentials: "same-origin" }),
      ]);
      const eData = await eRes.json();
      const rData = await rRes.json();
      setEntries(eData.entries ?? []);
      setTables(rData.tables ?? []);
    } catch {
      setEntries([]);
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, [eventDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetch(`/api/admin/users`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) =>
        setUsers(
          (d.users ?? [])
            .filter((u: AdminUser & { lineUserId?: string | null }) => u.lineUserId)
            .map((u: { lineUserId: string; lineDisplayName?: string; displayName: string; pictureUrl?: string | null }) => ({
              lineUserId: u.lineUserId,
              displayName: u.lineDisplayName || u.displayName,
              pictureUrl: u.pictureUrl,
            }))
        )
      )
      .catch(() => {});

    fetch(`/api/admin/mahjong/schedule`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) =>
        setLeagueDates(
          (d.schedule ?? []).filter((s: MahjongScheduleEntry) => s.type === "league")
        )
      )
      .catch(() => {});
  }, []);

  async function addEntry(lineUserId: string) {
    await fetch(`/api/admin/mahjong/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ eventDate, lineUserId }),
    });
    fetchData();
  }

  async function removeEntry(lineUserId: string) {
    await fetch(`/api/admin/mahjong/entries?eventDate=${eventDate}&lineUserId=${lineUserId}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    fetchData();
  }

  async function generateNextRound() {
    setGenerating(true);
    setLastSpectators(null);
    try {
      const res = await fetch(`/api/admin/mahjong/rounds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ eventDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "卓組みに失敗しました");
      } else {
        setLastSpectators(data.spectators ?? []);
        fetchData();
      }
    } catch {
      alert("卓組みに失敗しました");
    } finally {
      setGenerating(false);
    }
  }

  // ラウンドごとにグループ化
  const rounds = Array.from(new Set(tables.map((t) => t.round))).sort(
    (a, b) => (b ?? 0) - (a ?? 0)
  );
  const enteredIds = new Set(entries.map((e) => e.lineUserId));
  const candidates = users.filter((u) => u.lineUserId && !enteredIds.has(u.lineUserId));

  return (
    <div className="p-4 sm:p-8 space-y-8">
      {/* 開催日選択 */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-[#231714]">開催日</label>
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="px-3 py-2 text-sm border border-[#231714]/10 rounded-lg"
          />
        </div>
        {leagueDates.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-[#231714]/40 self-center mr-1">リーグ戦日:</span>
            {leagueDates.map((s) => (
              <button
                key={s.scheduleId}
                onClick={() => setEventDate(s.date)}
                className={`px-2.5 py-1 text-xs rounded-lg border ${
                  eventDate === s.date
                    ? "bg-[#231714] text-white border-[#231714]"
                    : "bg-white text-[#231714]/60 border-[#231714]/10 hover:bg-gray-50"
                }`}
              >
                {s.date.slice(5)}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {/* 参加者 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[#231714]">
                参加表明者（{entries.length}名）
              </h2>
              <button
                onClick={() => setShowPicker((v) => !v)}
                className="px-3 py-1.5 text-xs font-medium text-[#231714]/60 hover:text-[#231714] border border-[#231714]/10 rounded-lg hover:bg-gray-50"
              >
                {showPicker ? "閉じる" : "＋ 参加者を追加"}
              </button>
            </div>

            {showPicker && (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-3 mb-3 max-h-56 overflow-y-auto">
                {candidates.length === 0 ? (
                  <p className="text-xs text-[#231714]/40 py-4 text-center">
                    追加できるユーザーがいません
                  </p>
                ) : (
                  <div className="space-y-1">
                    {candidates.map((u) => (
                      <button
                        key={u.lineUserId}
                        onClick={() => addEntry(u.lineUserId!)}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 text-left"
                      >
                        <span className="text-sm text-[#231714]">{u.displayName}</span>
                        <span className="ml-auto text-xs text-[#A5C1C8]">追加 +</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {entries.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
                まだ参加表明がありません
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {entries.map((e) => (
                  <span
                    key={e.lineUserId}
                    className="inline-flex items-center gap-2 bg-white border border-[#231714]/10 rounded-full pl-3 pr-2 py-1.5 text-sm text-[#231714]"
                  >
                    {e.displayName}
                    <button
                      onClick={() => removeEntry(e.lineUserId)}
                      className="text-[#231714]/30 hover:text-red-500"
                      aria-label="削除"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* 卓組み生成 */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[#231714]">ラウンド別 卓組み</h2>
              <button
                onClick={generateNextRound}
                disabled={generating || entries.length < 4}
                className="px-4 py-2 text-xs font-bold text-[#231714] bg-[#B0E401] rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                {generating ? "生成中..." : "次のラウンドを生成"}
              </button>
            </div>

            {lastSpectators && lastSpectators.length > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-3 text-xs text-orange-700">
                このラウンドの見学者: {lastSpectators.map((s) => s.displayName).join("、")}
              </div>
            )}

            {rounds.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/40">
                まだ卓が組まれていません。参加者を4人以上にして「次のラウンドを生成」を押してください
              </div>
            ) : (
              <div className="space-y-5">
                {rounds.map((r) => (
                  <div key={r}>
                    <div className="text-xs font-bold text-[#231714]/50 mb-2">第{r}ラウンド</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {tables
                        .filter((t) => t.round === r)
                        .map((t) => (
                          <div key={t.tableId} className="bg-white rounded-xl border border-[#231714]/10 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-bold text-[#231714]">卓 {t.tableLabel}</span>
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
                            <div className="space-y-1">
                              {t.members.map((m) => (
                                <div key={m.lineUserId} className="flex items-center justify-between text-sm">
                                  <span className="text-[#231714]">{m.displayName}</span>
                                  <span className="text-xs text-[#231714]/50">
                                    {m.points !== null ? `${m.rank}位 / ${m.points.toLocaleString()}` : "未申告"}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
