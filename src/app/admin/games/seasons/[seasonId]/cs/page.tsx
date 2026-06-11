"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { CsEvent, CsCandidate, ScoreboardGameId } from "@/types";
import DateTimePicker from "@/components/ui/DateTimePicker";
import { GAME_CATEGORIES } from "@/types";

/* ───────── 定数 ───────── */

const GAME_LABEL: Record<ScoreboardGameId, string> = {
  mahjong: "麻雀",
  poker: "ポーカー",
  billiards: "ビリヤード",
  darts: "ダーツ",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-gray-100 text-gray-600" },
  upcoming: { label: "開催予定", cls: "bg-blue-100 text-blue-700" },
  ongoing: { label: "開催中", cls: "bg-green-100 text-green-700" },
  completed: { label: "完了", cls: "bg-gray-100 text-gray-500" },
};

const CANDIDATE_STATUS: Record<string, { label: string; cls: string }> = {
  active: { label: "参加", cls: "bg-green-100 text-green-700" },
  declined: { label: "辞退", cls: "bg-red-100 text-red-600" },
  promoted: { label: "繰上げ", cls: "bg-yellow-100 text-yellow-700" },
};

/* ───────── メインコンポーネント ───────── */

export default function SeasonCsPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [csEvents, setCsEvents] = useState<CsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  // モーダル
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CsEvent | null>(null);

  /* ───────── CSイベント取得 ───────── */

  const fetchCsEvents = useCallback(async () => {
    if (!seasonId) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/scoreboard/cs?seasonId=${seasonId}`,
        { credentials: "same-origin" }
      );
      const data = await res.json();
      setCsEvents(data.csEvents ?? []);
    } catch {
      setCsEvents([]);
    } finally {
      setLoading(false);
    }
  }, [seasonId]);

  useEffect(() => {
    fetchCsEvents();
  }, [fetchCsEvents]);

  /* ───────── CSイベント作成 ───────── */

  async function handleCreate(form: {
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    location: string;
  }) {
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/scoreboard/cs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ seasonId, ...form }),
      });
      if (res.ok) {
        setShowCreateModal(false);
        fetchCsEvents();
      } else {
        const data = await res.json();
        alert(data.error || "作成に失敗しました");
      }
    } catch {
      alert("作成に失敗しました");
    } finally {
      setActionLoading(false);
    }
  }

  /* ───────── 候補者抽出 ───────── */

  async function handleExtractCandidates(csEventId: string) {
    if (!confirm("年間ランキングから候補者を抽出しますか？\n既存の候補者リストは上書きされます。")) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/admin/scoreboard/cs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ csEventId, seasonId }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`${data.count}名の候補者を抽出しました`);
        fetchCsEvents();
      } else {
        alert(data.error || "抽出に失敗しました");
      }
    } catch {
      alert("抽出に失敗しました");
    } finally {
      setActionLoading(false);
    }
  }

  /* ───────── 辞退処理 ───────── */

  async function handleDecline(csEventId: string, lineUserId: string, gameCategory: ScoreboardGameId) {
    if (!confirm("この候補者を辞退にしますか？次のランクのユーザーが自動的に繰り上げされます。")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/scoreboard/cs/${csEventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "decline", lineUserId, gameCategory }),
      });
      const data = await res.json();
      if (res.ok) {
        if (data.promoted) {
          alert("辞退を処理し、次の候補者を繰り上げました");
        } else {
          alert("辞退を処理しました（繰り上げ対象なし）");
        }
        fetchCsEvents();
      } else {
        alert(data.error || "処理に失敗しました");
      }
    } catch {
      alert("処理に失敗しました");
    } finally {
      setActionLoading(false);
    }
  }

  /* ───────── LINE通知送信 ───────── */

  async function handleNotify(csEventId: string) {
    if (!confirm("アクティブな候補者全員にLINE通知を送信しますか？")) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/admin/scoreboard/cs/${csEventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "notify" }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`${data.notifiedCount}名に通知を送信しました`);
        fetchCsEvents();
      } else {
        alert(data.error || "通知送信に失敗しました");
      }
    } catch {
      alert("通知送信に失敗しました");
    } finally {
      setActionLoading(false);
    }
  }

  /* ───────── 公開切替 ───────── */

  async function handleTogglePublish(csEventId: string, current: boolean) {
    setActionLoading(true);
    try {
      await fetch(`/api/admin/scoreboard/cs/${csEventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "update", published: !current }),
      });
      fetchCsEvents();
    } catch {
      alert("更新に失敗しました");
    } finally {
      setActionLoading(false);
    }
  }

  /* ───────── 削除 ───────── */

  async function handleDelete(csEventId: string) {
    if (!confirm("このCSイベントを削除しますか？")) return;
    setActionLoading(true);
    try {
      await fetch(`/api/admin/scoreboard/cs/${csEventId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      fetchCsEvents();
    } catch {
      alert("削除に失敗しました");
    } finally {
      setActionLoading(false);
    }
  }

  /* ───────── UI ───────── */

  if (loading && csEvents.length === 0) {
    return (
      <div className="p-8 flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-[#231714]">CS管理</h2>
          <p className="text-xs text-[#231714]/40 mt-0.5">チャンピオンシップ候補者の管理・通知</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/90 transition-colors"
        >
          + 新規CS作成
        </button>
      </div>

      {/* CSイベント一覧 */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : csEvents.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
          CSイベントがありません
        </div>
      ) : (
        <div className="space-y-4">
          {csEvents.map((ev) => (
            <CsEventCard
              key={ev.csEventId}
              event={ev}
              actionLoading={actionLoading}
              onExtract={() => handleExtractCandidates(ev.csEventId)}
              onDecline={(uid, gc) => handleDecline(ev.csEventId, uid, gc)}
              onNotify={() => handleNotify(ev.csEventId)}
              onTogglePublish={() => handleTogglePublish(ev.csEventId, ev.published)}
              onDelete={() => handleDelete(ev.csEventId)}
              onSelect={() => setSelectedEvent(selectedEvent?.csEventId === ev.csEventId ? null : ev)}
              isExpanded={selectedEvent?.csEventId === ev.csEventId}
            />
          ))}
        </div>
      )}

      {/* 作成モーダル */}
      {showCreateModal && (
        <CreateCsModal
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
          loading={actionLoading}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   CSイベントカード
   ═══════════════════════════════════════════ */

function CsEventCard({
  event,
  actionLoading,
  onExtract,
  onDecline,
  onNotify,
  onTogglePublish,
  onDelete,
  onSelect,
  isExpanded,
}: {
  event: CsEvent;
  actionLoading: boolean;
  onExtract: () => void;
  onDecline: (uid: string, gc: ScoreboardGameId) => void;
  onNotify: () => void;
  onTogglePublish: () => void;
  onDelete: () => void;
  onSelect: () => void;
  isExpanded: boolean;
}) {
  const statusBadge = STATUS_BADGE[event.status] ?? STATUS_BADGE.draft;
  const activeCandidates = event.candidates.filter((c) => c.status === "active" || c.status === "promoted");
  const declinedCount = event.candidates.filter((c) => c.status === "declined").length;

  // 種目ごとにグループ化
  const grouped: Record<string, CsCandidate[]> = {};
  for (const c of event.candidates) {
    if (!grouped[c.gameCategory]) grouped[c.gameCategory] = [];
    grouped[c.gameCategory].push(c);
  }

  return (
    <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
      {/* ヘッダー */}
      <div
        className="p-4 cursor-pointer hover:bg-[#231714]/[0.02] transition-colors"
        onClick={onSelect}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-bold text-[#231714]">{event.title}</h3>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${statusBadge.cls}`}>
              {statusBadge.label}
            </span>
            {event.published && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">
                公開中
              </span>
            )}
            {event.notifiedCandidates && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-green-100 text-green-700">
                通知済
              </span>
            )}
          </div>
          <svg
            className={`w-4 h-4 text-[#231714]/30 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" />
          </svg>
        </div>
        <div className="flex gap-4 mt-1.5 text-xs text-[#231714]/40">
          <span>{event.startAt}</span>
          <span>{event.location}</span>
          <span>候補者: {activeCandidates.length}名{declinedCount > 0 ? ` (辞退: ${declinedCount})` : ""}</span>
        </div>
      </div>

      {/* 展開部分 */}
      {isExpanded && (
        <div className="border-t border-[#231714]/5">
          {/* アクションバー */}
          <div className="px-4 py-3 bg-gray-50 flex gap-2 flex-wrap">
            <button
              onClick={onExtract}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-[#231714] text-white rounded-lg hover:bg-[#231714]/90 disabled:opacity-40"
            >
              候補者抽出
            </button>
            <button
              onClick={onNotify}
              disabled={actionLoading || event.candidates.length === 0}
              className="px-3 py-1.5 text-xs font-medium bg-[#B0E401] text-[#231714] rounded-lg hover:bg-[#B0E401]/80 disabled:opacity-40"
            >
              LINE通知送信
            </button>
            <button
              onClick={onTogglePublish}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-medium bg-white border border-[#231714]/10 text-[#231714] rounded-lg hover:bg-gray-100 disabled:opacity-40"
            >
              {event.published ? "非公開にする" : "公開する"}
            </button>
            <button
              onClick={onDelete}
              disabled={actionLoading}
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-40 ml-auto"
            >
              削除
            </button>
          </div>

          {/* 候補者一覧 */}
          {event.candidates.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-[#231714]/40">
              候補者がまだ抽出されていません。「候補者抽出」ボタンで年間ランキングから自動抽出できます。
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {GAME_CATEGORIES.map((gc) => {
                const cats = grouped[gc.id];
                if (!cats || cats.length === 0) return null;
                return (
                  <div key={gc.id}>
                    <h4 className="text-xs font-bold text-[#231714]/60 mb-2">{gc.label}</h4>
                    <div className="space-y-1.5">
                      {cats
                        .sort((a, b) => a.annualRank - b.annualRank)
                        .map((c) => {
                          const cStatus = CANDIDATE_STATUS[c.status] ?? CANDIDATE_STATUS.active;
                          return (
                            <div
                              key={`${c.lineUserId}-${c.gameCategory}`}
                              className="flex items-center gap-3 py-2 px-3 rounded-lg bg-gray-50"
                            >
                              <span className="w-6 h-6 rounded-full bg-[#231714]/10 flex items-center justify-center text-[10px] font-bold text-[#231714]/60 shrink-0">
                                {c.annualRank}
                              </span>
                              {c.pictureUrl ? (
                                <img src={c.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#A5C1C8] shrink-0">
                                  {c.displayName.charAt(0)}
                                </div>
                              )}
                              <span className="text-sm font-medium text-[#231714] flex-1">{c.displayName}</span>
                              <span className="text-xs text-[#231714]/40">{c.annualScore.toLocaleString()}pt</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${cStatus.cls}`}>
                                {cStatus.label}
                              </span>
                              {c.status === "active" && (
                                <button
                                  onClick={() => onDecline(c.lineUserId, c.gameCategory)}
                                  disabled={actionLoading}
                                  className="px-2 py-1 text-[10px] text-red-500 hover:bg-red-50 rounded disabled:opacity-40"
                                >
                                  辞退
                                </button>
                              )}
                            </div>
                          );
                        })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════
   作成モーダル
   ═══════════════════════════════════════════ */

function CreateCsModal({
  onClose,
  onCreate,
  loading,
}: {
  onClose: () => void;
  onCreate: (form: {
    title: string;
    description: string;
    startAt: string;
    endAt: string;
    location: string;
  }) => void;
  loading: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [location, setLocation] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !startAt || !location.trim()) {
      alert("タイトル、開始日時、会場は必須です");
      return;
    }
    onCreate({ title, description, startAt, endAt, location });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-[#231714]/10">
          <h3 className="text-lg font-bold text-[#231714]">新規CSイベント作成</h3>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#231714]/60 mb-1">タイトル *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]"
              placeholder="例: 2026年度 チャンピオンシップ"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#231714]/60 mb-1">説明</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714] resize-none"
              rows={3}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#231714]/60 mb-1">開始日時 *</label>
              <DateTimePicker
                value={startAt}
                onChange={(v) => setStartAt(v)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#231714]/60 mb-1">終了日時</label>
              <DateTimePicker
                value={endAt}
                onChange={(v) => setEndAt(v)}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#231714]/60 mb-1">会場 *</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]"
              placeholder="例: EIGHT BASE UNGA メインフロア"
            />
          </div>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium bg-gray-100 text-[#231714] rounded-lg hover:bg-gray-200"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium bg-[#231714] text-white rounded-lg hover:bg-[#231714]/90 disabled:opacity-40"
            >
              {loading ? "作成中..." : "作成"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
