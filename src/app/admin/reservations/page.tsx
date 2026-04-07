"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";

interface Reservation {
  reservationId: string;
  facilityId: string;
  facilityName: string;
  displayName: string;
  tenantName: string;
  email: string;
  pictureUrl: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  createdAt: string;
}

export default function AdminReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filtered, setFiltered] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // フィルター
  const [filterDate, setFilterDate] = useState("");
  const [filterFacility, setFilterFacility] = useState("");
  const [filterName, setFilterName] = useState("");

  // キャンセル確認
  const [cancelTarget, setCancelTarget] = useState<Reservation | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // 編集モーダル
  const [editTarget, setEditTarget] = useState<Reservation | null>(null);
  const [editForm, setEditForm] = useState({ date: "", startTime: "", endTime: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);


  async function fetchReservations() {
    try {
      const res = await fetch("/api/admin/reservations", {
        credentials: "same-origin",
      });
      const data = await res.json();
      setReservations(data.reservations ?? []);
      setFiltered(data.reservations ?? []);
    } catch {
      setError("予約一覧の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchReservations(); }, []); // eslint-disable-line

  // フィルター適用
  useEffect(() => {
    let result = reservations;
    if (filterDate) result = result.filter((r) => r.date === filterDate);
    if (filterFacility) result = result.filter((r) => r.facilityName.includes(filterFacility));
    if (filterName) result = result.filter((r) => r.displayName.includes(filterName) || r.tenantName.includes(filterName));
    setFiltered(result);
  }, [reservations, filterDate, filterFacility, filterName]);

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelLoading(true);
    try {
      const res = await fetch(`/api/admin/reservations/${cancelTarget.reservationId}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      setActionMsg(`${cancelTarget.displayName} の予約をキャンセルしました`);
      setCancelTarget(null);
      await fetchReservations();
    } catch {
      setActionMsg("キャンセルに失敗しました");
      setCancelTarget(null);
    } finally {
      setCancelLoading(false);
    }
  }

  function openEdit(r: Reservation) {
    setEditTarget(r);
    setEditForm({ date: r.date, startTime: r.startTime, endTime: r.endTime });
    setEditError(null);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setEditError(null);
    setEditLoading(true);
    try {
      const res = await fetch(`/api/admin/reservations/${editTarget.reservationId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error();
      setActionMsg("予約を更新しました");
      setEditTarget(null);
      await fetchReservations();
    } catch {
      setEditError("更新に失敗しました");
    } finally {
      setEditLoading(false);
    }
  }

  const today = dayjs().format("YYYY-MM-DD");

  return (
    <div className="p-8">
      {/* ヘッダー */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">予約管理</h2>
        <p className="text-sm text-gray-400 mt-1">全ユーザーの予約を確認・管理</p>
      </div>

      {/* 成功メッセージ */}
      {actionMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-green-700">{actionMsg}</p>
          <button onClick={() => setActionMsg(null)} className="text-green-500 text-xs hover:text-green-700">✕</button>
        </div>
      )}

      {/* キャンセル確認モーダル */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-2">予約をキャンセルしますか？</h3>
            <div className="bg-gray-50 rounded-xl p-4 text-sm mb-4 space-y-1">
              <p><span className="text-gray-500">予約者:</span> <span className="font-medium">{cancelTarget.displayName}</span></p>
              <p><span className="text-gray-500">施設:</span> {cancelTarget.facilityName}</p>
              <p><span className="text-gray-500">日時:</span> {dayjs(cancelTarget.date).format("M月D日")} {cancelTarget.startTime}〜{cancelTarget.endTime}</p>
            </div>
            <p className="text-xs text-gray-400 mb-4">Google カレンダーのイベントも削除されます。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
              >
                戻る
              </button>
              <button
                onClick={handleCancel}
                disabled={cancelLoading}
                className="flex-1 py-2.5 text-sm bg-red-500 text-white rounded-xl hover:bg-red-600 disabled:opacity-50"
              >
                {cancelLoading ? "処理中..." : "キャンセルする"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 編集モーダル */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-gray-900 mb-1">予約を編集</h3>
            <p className="text-sm text-gray-500 mb-4">{editTarget.displayName} / {editTarget.facilityName}</p>
            <form onSubmit={handleEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">日付</label>
                <input
                  type="date"
                  value={editForm.date}
                  onChange={(e) => setEditForm({ ...editForm, date: e.target.value })}
                  required
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">開始時刻</label>
                  <input
                    type="time"
                    value={editForm.startTime}
                    onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                    required
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-800"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">終了時刻</label>
                  <input
                    type="time"
                    value={editForm.endTime}
                    onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                    required
                    className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:border-gray-800"
                  />
                </div>
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 py-2.5 text-sm bg-gray-900 text-white rounded-xl hover:bg-gray-700 disabled:opacity-50"
                >
                  {editLoading ? "更新中..." : "更新する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* フィルター */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">日付</label>
          <input
            type="date"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-800"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">施設</label>
          <input
            type="text"
            value={filterFacility}
            onChange={(e) => setFilterFacility(e.target.value)}
            placeholder="施設名で絞り込み"
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-800 w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-gray-500 whitespace-nowrap">予約者</label>
          <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="氏名・テナントで絞り込み"
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-800 w-44"
          />
        </div>
        {(filterDate || filterFacility || filterName) && (
          <button
            onClick={() => { setFilterDate(""); setFilterFacility(""); setFilterName(""); }}
            className="px-3 py-2 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded-lg transition-colors"
          >
            リセット
          </button>
        )}
      </div>

      {/* テーブル */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="text-sm text-gray-500">
              {filtered.length} 件
              {filtered.length !== reservations.length && ` / 全 ${reservations.length} 件`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 whitespace-nowrap">日時</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">施設</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">予約者</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">テナント</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">状態</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isPast = r.date < today;
                  return (
                    <tr key={r.reservationId} className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${isPast ? "opacity-60" : ""}`}>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <span className={`font-medium ${r.date === today ? "text-blue-600" : "text-gray-800"}`}>
                          {dayjs(r.date).format("M/D (ddd)")}
                        </span>
                        <span className="text-gray-400 text-xs ml-2">{r.startTime}〜{r.endTime}</span>
                        {r.date === today && (
                          <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-xs rounded-full font-medium">今日</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-gray-600">{r.facilityName}</td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          {r.pictureUrl ? (
                            <img
                              src={r.pictureUrl}
                              alt={r.displayName}
                              className="w-7 h-7 rounded-full object-cover flex-shrink-0"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          ) : (
                            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {r.displayName.charAt(0)}
                            </div>
                          )}
                          <span className="font-medium text-gray-900">{r.displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-gray-500">{r.tenantName || "—"}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.status === "confirmed" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {r.status === "confirmed" ? "確定" : "キャンセル済"}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {r.status === "confirmed" && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEdit(r)}
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 transition-colors"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => setCancelTarget(r)}
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
                            >
                              キャンセル
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="px-6 py-12 text-center text-sm text-gray-400">
                該当する予約がありません
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
