"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Season, ScoreboardGameId } from "@/types";

/* ───────── 定数 ───────── */

const GAME_LABELS: Record<ScoreboardGameId, string> = {
  mahjong: "麻雀",
  poker: "ポーカー",
  billiards: "ビリヤード",
  darts: "ダーツ",
};

const GAME_IDS: ScoreboardGameId[] = ["mahjong", "poker", "billiards", "darts"];

/* ───────── メインコンポーネント ───────── */

export default function SeasonOverviewPage() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const router = useRouter();

  const [season, setSeason] = useState<Season | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 編集モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
    csConfigMahjong: "3",
    csConfigPoker: "3",
    csConfigBilliards: "3",
    csConfigDarts: "3",
  });
  const [saving, setSaving] = useState(false);

  // 削除確認
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  /* ───────── データ取得 ───────── */

  async function fetchSeason() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/scoreboard/seasons", {
        credentials: "same-origin",
      });
      const data = await res.json();
      const found = (data.seasons ?? []).find(
        (s: Season) => s.seasonId === seasonId
      );
      if (found) {
        setSeason(found);
      } else {
        setError("シーズンが見つかりません");
      }
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchSeason();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonId]);

  /* ───────── 編集モーダル操作 ───────── */

  function openEdit() {
    if (!season) return;
    setForm({
      name: season.name,
      startDate: season.startDate,
      endDate: season.endDate,
      csConfigMahjong: String(season.csConfig?.mahjong?.topN ?? 3),
      csConfigPoker: String(season.csConfig?.poker?.topN ?? 3),
      csConfigBilliards: String(season.csConfig?.billiards?.topN ?? 3),
      csConfigDarts: String(season.csConfig?.darts?.topN ?? 3),
    });
    setModalOpen(true);
  }

  /* ───────── 保存 ───────── */

  async function handleSave() {
    setSaving(true);
    try {
      const csConfig: Record<string, { topN: number }> = {
        mahjong: { topN: Number(form.csConfigMahjong) || 3 },
        poker: { topN: Number(form.csConfigPoker) || 3 },
        billiards: { topN: Number(form.csConfigBilliards) || 3 },
        darts: { topN: Number(form.csConfigDarts) || 3 },
      };

      const payload = {
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        csConfig,
      };

      const res = await fetch(
        `/api/admin/scoreboard/seasons/${seasonId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "保存に失敗しました");
      }

      setModalOpen(false);
      await fetchSeason();
    } catch (e) {
      alert(`保存に失敗しました: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  /* ───────── active 切り替え ───────── */

  async function toggleActive() {
    if (!season) return;
    try {
      const res = await fetch(
        `/api/admin/scoreboard/seasons/${seasonId}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ active: !season.active }),
        }
      );
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchSeason();
    } catch (e) {
      alert(`更新に失敗しました: ${e}`);
    }
  }

  /* ───────── 削除 ───────── */

  async function handleDelete() {
    try {
      const res = await fetch(
        `/api/admin/scoreboard/seasons/${seasonId}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      router.push("/admin/games/seasons");
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    }
  }

  /* ───────── UI classes ───────── */

  const inputClass =
    "w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]";
  const labelClass = "block text-xs font-medium text-[#231714]/60 mb-1";

  /* ───────── ローディング・エラー ───────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !season) {
    return (
      <div className="p-8">
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">
          {error ?? "シーズンが見つかりません"}
        </div>
      </div>
    );
  }

  /* ───────── メインUI ───────── */

  return (
    <div className="p-6 space-y-6">
      {/* ── 基本情報カード ── */}
      <div className="bg-white rounded-xl border border-[#231714]/10 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-[#231714] mb-3">
              基本情報
            </h2>

            <div className="space-y-3">
              <div>
                <span className="text-xs font-medium text-[#231714]/50">
                  シーズン名
                </span>
                <p className="text-sm font-semibold text-[#231714] mt-0.5">
                  {season.name}
                </p>
              </div>

              <div>
                <span className="text-xs font-medium text-[#231714]/50">
                  期間
                </span>
                <p className="text-sm text-[#231714] mt-0.5">
                  {season.startDate} 〜 {season.endDate}
                </p>
              </div>

              <div>
                <span className="text-xs font-medium text-[#231714]/50">
                  ステータス
                </span>
                <div className="mt-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      season.active
                        ? "bg-[#B0E401]/20 text-green-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {season.active ? "有効" : "無効"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* アクションボタン群 */}
          <div className="flex flex-col gap-2 shrink-0">
            <button
              onClick={openEdit}
              className="px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/80 transition-colors"
            >
              編集
            </button>
            <button
              onClick={toggleActive}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                season.active
                  ? "border border-gray-200 text-[#231714]/60 hover:bg-gray-50"
                  : "bg-[#B0E401]/20 text-green-700 hover:bg-[#B0E401]/30"
              }`}
            >
              {season.active ? "無効にする" : "有効にする"}
            </button>
            <button
              onClick={() => setDeleteConfirm(true)}
              className="px-4 py-2 text-sm font-medium rounded-lg text-red-500 border border-red-200 hover:bg-red-50 transition-colors"
            >
              削除
            </button>
          </div>
        </div>
      </div>

      {/* ── CS設定カード ── */}
      <div className="bg-white rounded-xl border border-[#231714]/10 p-6">
        <h2 className="text-lg font-bold text-[#231714] mb-1">
          CS候補者設定
        </h2>
        <p className="text-xs text-[#231714]/40 mb-4">
          各種目の年間ランキング上位何名をCS候補とするかの設定
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {GAME_IDS.map((gid) => (
            <div
              key={gid}
              className="flex items-center justify-between rounded-lg border border-[#231714]/5 bg-[#A5C1C8]/5 px-4 py-3"
            >
              <span className="text-sm font-medium text-[#231714]">
                {GAME_LABELS[gid]}
              </span>
              <span className="text-sm text-[#231714]/70">
                上位{" "}
                <span className="font-bold text-[#231714]">
                  {season.csConfig?.[gid]?.topN ?? 3}
                </span>{" "}
                名
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── メタ情報 ── */}
      <div className="bg-white rounded-xl border border-[#231714]/10 p-6">
        <h2 className="text-lg font-bold text-[#231714] mb-3">
          メタ情報
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs font-medium text-[#231714]/50">
              シーズンID
            </span>
            <p className="text-[#231714]/70 mt-0.5 font-mono text-xs break-all">
              {season.seasonId}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-[#231714]/50">
              作成日
            </span>
            <p className="text-[#231714]/70 mt-0.5">
              {season.createdAt
                ? new Date(season.createdAt).toLocaleString("ja-JP")
                : "-"}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium text-[#231714]/50">
              最終更新
            </span>
            <p className="text-[#231714]/70 mt-0.5">
              {season.updatedAt
                ? new Date(season.updatedAt).toLocaleString("ja-JP")
                : "-"}
            </p>
          </div>
        </div>
      </div>

      {/* ───── 削除確認モーダル ───── */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#231714] mb-2">
              削除の確認
            </h3>
            <p className="text-sm text-[#231714]/60 mb-5">
              このシーズンを削除しますか？スコアが登録済みの場合は削除できません。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ───── 編集モーダル ───── */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-5 border-b border-[#231714]/5">
              <h3 className="text-base font-semibold text-[#231714]">
                シーズンを編集
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* シーズン名 */}
              <div>
                <label className={labelClass}>シーズン名 *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  className={inputClass}
                  placeholder="2026年度シーズン"
                />
              </div>

              {/* 期間 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>開始日 *</label>
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(e) =>
                      setForm({ ...form, startDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>終了日 *</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) =>
                      setForm({ ...form, endDate: e.target.value })
                    }
                    className={inputClass}
                  />
                </div>
              </div>

              {/* CS候補者数 */}
              <div>
                <label className={labelClass}>CS候補者数（種目別）</label>
                <p className="text-[10px] text-[#231714]/40 mb-2">
                  各種目で年間ランキング上位何名をCS候補とするか設定
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {GAME_IDS.map((gid) => {
                    const key =
                      `csConfig${gid.charAt(0).toUpperCase() + gid.slice(1)}` as keyof typeof form;
                    return (
                      <div key={gid} className="flex items-center gap-2">
                        <span className="text-xs text-[#231714]/60 w-20">
                          {GAME_LABELS[gid]}
                        </span>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={form[key]}
                          onChange={(e) =>
                            setForm({ ...form, [key]: e.target.value })
                          }
                          className={`${inputClass} w-20 text-center`}
                        />
                        <span className="text-xs text-[#231714]/40">名</span>
                      </div>
                    );
                  })}
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
