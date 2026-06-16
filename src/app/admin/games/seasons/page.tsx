"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Season, ScoreboardGameId } from "@/types";
import DatePicker from "@/components/ui/DatePicker";

/* ───────── 定数 ───────── */

const GAME_LABELS: Record<ScoreboardGameId, string> = {
  mahjong: "麻雀",
  poker: "ポーカー",
  billiards: "ビリヤード",
  darts: "ダーツ",
};

const GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

const EMPTY_FORM = {
  name: "",
  gameCategory: "mahjong" as ScoreboardGameId,
  startDate: "",
  endDate: "",
};

/* ───────── メインコンポーネント ───────── */

export default function SeasonsPage() {
  const router = useRouter();
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Season | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // 削除確認
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  /* ───────── データ取得 ───────── */

  async function fetchSeasons() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/scoreboard/seasons", { credentials: "same-origin" });
      const data = await res.json();
      setSeasons(data.seasons ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSeasons();
  }, []);

  /* ───────── モーダル操作 ───────── */

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setModalOpen(true);
  }

  function openEdit(s: Season) {
    setEditing(s);
    setForm({
      name: s.name,
      gameCategory: s.gameCategory ?? "mahjong",
      startDate: s.startDate,
      endDate: s.endDate,
    });
    setModalOpen(true);
  }

  /* ───────── 保存 ───────── */

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        gameCategory: form.gameCategory,
        startDate: form.startDate,
        endDate: form.endDate,
      };

      const url = editing
        ? `/api/admin/scoreboard/seasons/${editing.seasonId}`
        : "/api/admin/scoreboard/seasons";
      const method = editing ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存に失敗しました");
      }

      setModalOpen(false);
      await fetchSeasons();
    } catch (e) {
      alert(`保存に失敗しました: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  /* ───────── active 切り替え ───────── */

  async function toggleActive(s: Season) {
    try {
      const res = await fetch(`/api/admin/scoreboard/seasons/${s.seasonId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ active: !s.active }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchSeasons();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    }
  }

  /* ───────── 削除 ───────── */

  async function handleDelete(seasonId: string) {
    try {
      const res = await fetch(`/api/admin/scoreboard/seasons/${seasonId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      setDeleteTarget(null);
      await fetchSeasons();
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    }
  }

  /* ───────── UI ───────── */

  const inputClass = "w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]";
  const labelClass = "block text-xs font-medium text-[#231714]/60 mb-1";

  return (
    <div className="p-8">
      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#231714]">シーズン管理</h2>
          <p className="text-sm text-[#231714]/40 mt-1">ランキング集計期間の作成・管理</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/80 transition-colors"
        >
          ＋ 新規作成
        </button>
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : seasons.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
          シーズンがまだ作成されていません
        </div>
      ) : (
        <div className="space-y-3">
          {seasons.map((s) => (
            <div
              key={s.seasonId}
              className="bg-white rounded-xl border border-[#231714]/10 p-5 hover:shadow-sm hover:border-[#A5C1C8]/50 transition-all cursor-pointer"
              onClick={() => router.push(`/admin/games/seasons/${s.seasonId}`)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2 py-0.5 rounded bg-[#231714] text-white text-[10px] font-bold shrink-0">
                      {GAME_LABELS[s.gameCategory ?? "mahjong"]}
                    </span>
                    <h3 className="text-base font-semibold text-[#231714] truncate">{s.name}</h3>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        s.active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {s.active ? "有効" : "無効"}
                    </span>
                  </div>
                  <p className="text-sm text-[#231714]/50">
                    {s.startDate} 〜 {s.endDate}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-2 py-0.5 rounded bg-[#A5C1C8]/15 text-[10px] font-medium text-[#231714]/70">
                      CS上位{s.csConfig?.[s.gameCategory ?? "mahjong"]?.topN ?? 3}名
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button
                    onClick={() => toggleActive(s)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      s.active
                        ? "border border-gray-200 text-[#231714]/60 hover:bg-gray-50"
                        : "bg-green-50 text-green-700 hover:bg-green-100"
                    }`}
                  >
                    {s.active ? "無効化" : "有効化"}
                  </button>
                  <button
                    onClick={() => openEdit(s)}
                    className="px-3 py-1.5 text-xs text-[#A5C1C8] hover:underline"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => setDeleteTarget(s.seasonId)}
                    className="px-3 py-1.5 text-xs text-red-500 hover:underline"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ───── 削除確認 ───── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#231714] mb-2">削除の確認</h3>
            <p className="text-sm text-[#231714]/60 mb-5">
              このシーズンを削除しますか？スコアが登録済みの場合は削除できません。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── 作成・編集モーダル ───── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-5 border-b border-[#231714]/5">
              <h3 className="text-base font-semibold text-[#231714]">
                {editing ? "シーズンを編集" : "新規シーズン作成"}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* 種目 */}
              <div>
                <label className={labelClass}>種目 *</label>
                <select
                  value={form.gameCategory}
                  onChange={(e) =>
                    setForm({ ...form, gameCategory: e.target.value as ScoreboardGameId })
                  }
                  disabled={!!editing}
                  className={inputClass}
                >
                  {GAME_IDS.map((gid) => (
                    <option key={gid} value={gid}>
                      {GAME_LABELS[gid]}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-[#231714]/40 mt-1">
                  シーズンは種目ごとに作成します（麻雀・ダーツ・ビリヤード・ポーカー）。
                </p>
              </div>

              {/* シーズン名 */}
              <div>
                <label className={labelClass}>シーズン名 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className={inputClass}
                  placeholder="2026年度シーズン"
                />
              </div>

              {/* 期間 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>開始日 *</label>
                  <DatePicker
                    value={form.startDate}
                    onChange={(v) => setForm({ ...form, startDate: v })}
                    placeholder="開始日を選択"
                    required
                  />
                </div>
                <div>
                  <label className={labelClass}>終了日 *</label>
                  <DatePicker
                    value={form.endDate}
                    onChange={(v) => setForm({ ...form, endDate: v })}
                    placeholder="終了日を選択"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm bg-[#231714] text-white rounded-lg hover:bg-[#231714]/80 disabled:opacity-50"
              >
                {saving ? "保存中…" : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
