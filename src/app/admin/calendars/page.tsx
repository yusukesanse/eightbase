"use client";

import { useCallback, useEffect, useState } from "react";
import type { Facility, FacilityType } from "@/types";
import TimePicker from "@/components/ui/TimePicker";

/* ───────── 型定義 ───────── */

interface FacilityForm {
  name: string;
  calendarId: string;
  type: FacilityType;
  capacity: string;
  openTime: string;
  closeTime: string;
  availableDays: number[];
}

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

const EMPTY_FORM: FacilityForm = {
  name: "",
  calendarId: "",
  type: "meeting_room",
  capacity: "",
  openTime: "09:00",
  closeTime: "18:00",
  availableDays: [1, 2, 3, 4, 5],
};

/* ───────── メインコンポーネント ───────── */

export default function CalendarsPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // モーダル制御
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FacilityForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);

  // 削除確認
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* ───────── データ取得 ───────── */

  const fetchFacilities = useCallback(async (migrate = false) => {
    setLoading(true);
    setError("");
    try {
      const url = migrate
        ? "/api/admin/facilities?migrate=true"
        : "/api/admin/facilities";
      const res = await fetch(url, { credentials: "same-origin" });
      const data = await res.json();
      if (data.migrated) {
        setSuccess(`${data.migrated}件の既存施設をFirestoreに移行しました`);
        // 移行後に再取得
        const res2 = await fetch("/api/admin/facilities", { credentials: "same-origin" });
        const data2 = await res2.json();
        setFacilities(data2.facilities ?? []);
      } else {
        setFacilities(data.facilities ?? []);
      }
    } catch {
      setError("施設情報の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 初回は移行チェック付きで取得
    fetchFacilities(true);
  }, [fetchFacilities]);

  /* ───────── モーダル操作 ───────── */

  function openAddModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  }

  function openEditModal(facility: Facility) {
    setEditingId(facility.id);
    setForm({
      name: facility.name,
      calendarId: facility.calendarId,
      type: facility.type,
      capacity: String(facility.capacity),
      openTime: facility.openTime ?? "09:00",
      closeTime: facility.closeTime ?? "18:00",
      availableDays: facility.availableDays ?? [1, 2, 3, 4, 5],
    });
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  /* ───────── 保存（作成 / 更新） ───────── */

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.availableDays.length === 0) {
      setError("利用可能曜日を1日以上選択してください");
      return;
    }
    if (form.openTime >= form.closeTime) {
      setError("利用終了時刻は開始時刻より後に設定してください");
      return;
    }
    setSubmitting(true);
    setError("");
    setSuccess("");

    try {
      if (editingId) {
        // 更新
        const res = await fetch("/api/admin/facilities", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            id: editingId,
            ...form,
            capacity: Number(form.capacity),
          }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "更新に失敗しました");
        }
        setSuccess("施設情報を更新しました");
      } else {
        // 新規作成
        const res = await fetch("/api/admin/facilities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ ...form, capacity: Number(form.capacity) }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "作成に失敗しました");
        }
        setSuccess("新しい施設を追加しました");
      }
      closeModal();
      fetchFacilities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "エラーが発生しました");
    } finally {
      setSubmitting(false);
    }
  }

  /* ───────── 削除 ───────── */

  async function handleDelete(id: string) {
    setError("");
    setSuccess("");
    try {
      const res = await fetch("/api/admin/facilities", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "削除に失敗しました");
      }
      setSuccess("施設を削除しました");
      setDeletingId(null);
      fetchFacilities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "削除エラー");
    }
  }

  /* ───────── 有効/無効切り替え ───────── */

  async function toggleActive(facility: Facility) {
    try {
      await fetch("/api/admin/facilities", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ id: facility.id, active: !facility.active }),
      });
      fetchFacilities();
    } catch {
      setError("状態の変更に失敗しました");
    }
  }

  /* ───────── レンダリング ───────── */

  return (
    <div className="p-6 lg:p-10 max-w-5xl">
      {/* ヘッダー */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">カレンダー連携</h1>
          <p className="text-sm text-gray-500 mt-1">
            Googleカレンダーと連携する施設を管理します
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-2"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          カレンダーを追加
        </button>
      </div>

      {/* 通知メッセージ */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
          {success}
        </div>
      )}

      {/* ローディング */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-gray-800 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : facilities.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <svg width="48" height="48" viewBox="0 0 16 16" fill="none" className="mx-auto mb-4 text-gray-300">
            <rect x="1" y="2" width="14" height="13" rx="2" stroke="currentColor" strokeWidth="1.2" />
            <path d="M5 1v2M11 1v2M1 7h14" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <p className="text-sm">連携中のカレンダーはありません</p>
          <button onClick={openAddModal} className="mt-3 text-sm text-blue-600 hover:underline">
            最初のカレンダーを追加する
          </button>
        </div>
      ) : (
        /* ───────── 施設カード一覧 ───────── */
        <div className="space-y-3">
          {facilities.map((f) => (
            <div
              key={f.id}
              className={`bg-white border rounded-xl p-5 transition-colors ${
                f.active === false ? "opacity-50 border-gray-200" : "border-gray-200"
              }`}
            >
              <div className="flex items-start justify-between">
                {/* 左側: 施設情報 */}
                <div className="flex items-start gap-4">
                  {/* タイプアイコン */}
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0 ${
                      f.type === "meeting_room" ? "bg-blue-500" : "bg-emerald-500"
                    }`}
                  >
                    {f.type === "meeting_room" ? (
                      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                        <rect x="2" y="4" width="12" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="6" r="3" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M4 14c0-2.2 1.8-4 4-4s4 1.8 4 4" stroke="currentColor" strokeWidth="1.2" />
                      </svg>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-gray-900">{f.name}</h3>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-medium rounded-full ${
                          f.type === "meeting_room"
                            ? "bg-blue-50 text-blue-600"
                            : "bg-emerald-50 text-emerald-600"
                        }`}
                      >
                        {f.type === "meeting_room" ? "会議室" : "ブース"}
                      </span>
                      {f.active === false && (
                        <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-gray-100 text-gray-500">
                          無効
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      定員: {f.capacity}名
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      🕐 {f.openTime ?? "09:00"} 〜 {f.closeTime ?? "18:00"}

                      {(f.availableDays ?? [1, 2, 3, 4, 5])
                        .map((d) => DAY_LABELS[d])
                        .join("・")}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 font-mono break-all">
                      📅 {f.calendarId}
                    </p>
                  </div>
                </div>

                {/* 右側: アクションボタン */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* 有効/無効トグル */}
                  <button
                    onClick={() => toggleActive(f)}
                    className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                      f.active !== false
                        ? "bg-green-50 text-green-700 hover:bg-green-100"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                  >
                    {f.active !== false ? "有効" : "無効"}
                  </button>

                  {/* 編集 */}
                  <button
                    onClick={() => openEditModal(f)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    title="編集"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {/* 削除 */}
                  <button
                    onClick={() => setDeletingId(f.id)}
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                    title="削除"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M3 4h10M6 4V3h4v1M5 4v8a1 1 0 001 1h4a1 1 0 001-1V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ───────── 追加/編集モーダル ───────── */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                {editingId ? "施設を編集" : "カレンダーを追加"}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {/* 施設名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  施設名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例: 会議室 D"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  required
                />
              </div>

              {/* GoogleカレンダーID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GoogleカレンダーID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.calendarId}
                  onChange={(e) => setForm({ ...form, calendarId: e.target.value })}
                  placeholder="例: abc123@group.calendar.google.com"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  required
                />
                <p className="text-xs text-gray-400 mt-1">
                  Googleカレンダーの設定 → カレンダーID からコピーしてください
                </p>
              </div>

              {/* 施設タイプ */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  施設タイプ <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value as FacilityType })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                >
                  <option value="meeting_room">会議室</option>
                  <option value="booth">ブース</option>
                </select>
              </div>

              {/* 定員 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  定員 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.capacity}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "");
                    setForm({ ...form, capacity: v });
                  }}
                  placeholder="例: 6"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                  required
                />
              </div>

              {/* 利用時間 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  利用可能時間 <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <TimePicker
                    value={form.openTime}
                    onChange={(v) => setForm({ ...form, openTime: v })}
                    minTime="06:00"
                    maxTime="23:00"
                    step={30}
                    placeholder="開始"
                    required
                    className="flex-1"
                  />
                  <span className="text-sm text-gray-400 shrink-0">〜</span>
                  <TimePicker
                    value={form.closeTime}
                    onChange={(v) => setForm({ ...form, closeTime: v })}
                    minTime="06:00"
                    maxTime="23:30"
                    step={30}
                    placeholder="終了"
                    required
                    className="flex-1"
                  />
                </div>
              </div>

              {/* 利用可能曜日 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  利用可能曜日 <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  {DAY_LABELS.map((label, dayNum) => {
                    const checked = form.availableDays.includes(dayNum);
                    return (
                      <button
                        key={dayNum}
                        type="button"
                        onClick={() => {
                          const next = checked
                            ? form.availableDays.filter((d) => d !== dayNum)
                            : [...form.availableDays, dayNum].sort((a, b) => a - b);
                          setForm({ ...form, availableDays: next });
                        }}
                        className={`w-9 h-9 rounded-full text-sm font-medium transition-colors ${
                          checked
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                {form.availableDays.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">1日以上選択してください</p>
                )}
              </div>

              {/* ボタン */}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 px-4 py-2.5 border border-gray-300 text-sm text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {submitting
                    ? "保存中..."
                    : editingId
                      ? "更新する"
                      : "追加する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────── 削除確認モーダル ───────── */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">施設を削除</h3>
            <p className="text-sm text-gray-600 mb-6">
              この施設を削除すると、関連するカレンダー連携が解除されます。この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeletingId(null)}
                className="flex-1 px-4 py-2.5 border border-gray-300 text-sm text-gray-700 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(deletingId)}
                className="flex-1 px-4 py-2.5 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
