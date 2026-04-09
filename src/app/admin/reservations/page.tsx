"use client";

import { useEffect, useState } from "react";
import dayjs from "dayjs";
import TimePicker from "@/components/ui/TimePicker";
import DatePicker from "@/components/ui/DatePicker";

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
        <h2 className="text-2xl font-bold text-[#414141]">予約管理</h2>
        <p className="text-sm text-[#414141]/40 mt-1">全ユーザーの予約を確認・管理</p>
      </div>

      {/* 成功メッセージ */}
      {actionMsg && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
          <p className="text-sm text-[#414141]">{actionMsg}</p>
          <button onClick={() => setActionMsg(null)} className="text-green-500 text-xs hover:text-[#414141]">✕</button>
        </div>
      )}

      {/* キャンセル確認モーダル */}
      {cancelTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-[#414141] mb-2">予約をキャンセルしますか？</h3>
            <div className="bg-gray-50 rounded-xl p-4 text-sm mb-4 space-y-1">
              <p><span className="text-[#414141]/60">予約者:</span> <span className="font-medium">{cancelTarget.displayName}</span></p>
              <p><span className="text-[#414141]/60">施設:</span> {cancelTarget.facilityName}</p>
              <p><span className="text-[#414141]/60">日時:</span> {dayjs(cancelTarget.date).format("M月D日")} {cancelTarget.startTime}〜{cancelTarget.endTime}</p>
            </div>
            <p className="text-xs text-[#414141]/40 mb-4">Google カレンダーのイベントも削除されます。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setCancelTarget(null)}
                className="flex-1 py-2.5 text-sm border border-[#414141]/10 rounded-xl text-[#414141]/60 hover:bg-gray-50"
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
            <h3 className="text-base font-semibold text-[#414141] mb-1">予約を編集</h3>
            <p className="text-sm text-[#414141]/60 mb-4">{editTarget.displayName} / {editTarget.facilityName}</p>
            <form onSubmit={handleEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">日付</label>
                <DatePicker
                  value={editForm.date}
                  onChange={(v) => setEditForm({ ...editForm, date: v })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-[#414141]/60 mb-1">開始時刻</label>
                  <TimePicker
                    value={editForm.startTime}
                    onChange={(v) => setEditForm({ ...editForm, startTime: v })}
                    minTime="06:00"
                    maxTime="23:00"
                    step={30}
                    placeholder="開始"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#414141]/60 mb-1">終了時刻</label>
                  <TimePicker
                    value={editForm.endTime}
                    onChange={(v) => setEditForm({ ...editForm, endTime: v })}
                    minTime="06:00"
                    maxTime="23:30"
                    step={30}
                    placeholder="終了"
                    required
                  />
                </div>
              </div>
              {editError && <p className="text-xs text-red-600">{editError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 text-sm border border-[#414141]/10 rounded-xl text-[#414141]/60 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  className="flex-1 py-2.5 text-sm bg-[#414141] text-white rounded-xl hover:bg-[#414141]/80 disabled:opacity-50"
                >
                  {editLoading ? "更新中..." : "更新する"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* フィルター */}
      <div className="bg-white rounded-xl border border-[#414141]/10 p-4 mb-4 flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[#414141]/60 whitespace-nowrap">日付</label>
          <DatePicker
            value={filterDate}
            onChange={(v) => setFilterDate(v)}
            placeholder="日付で絞込"
            className="w-[180px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[#414141]/60 whitespace-nowrap">施設</label>
          <input
            type="text"
            value={filterFacility}
            onChange={(e) => setFilterFacility(e.target.value)}
            placeholder="施設名で絞り込み"
            className="px-3 py-2 text-sm border border-[#414141]/10 rounded-lg focus:outline-none focus:border-[#414141] w-40"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-[#414141]/60 whitespace-nowrap">予約者</label>
          <input
            type="text"
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            placeholder="氏名・テナントで絞り込み"
            className="px-3 py-2 text-sm border border-[#414141]/10 rounded-lg focus:outline-none focus:border-[#414141] w-44"
          />
        </div>
        {(filterDate || filterFacility || filterName) && (
          <button
            onClick={() => { setFilterDate(""); setFilterFacility(""); setFilterName(""); }}
            className="px-3 py-2 text-xs text-[#414141]/60 hover:text-[#414141] border border-[#414141]/10 rounded-lg transition-colors"
          >
            リセット
          </button>
        )}
      </div>

      {/* テーブル */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-[#414141]/20 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : (
        <div className="bg-white rounded-xl border border-[#414141]/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <p className="text-sm text-[#414141]/60">
              {filtered.length} 件
              {filtered.length !== reservations.length && ` / 全 ${reservations.length} 件`}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#414141]/5 border-b border-[#414141]/5">
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60 whitespace-nowrap">日時</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">施設</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">予約者</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">テナント</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">状態</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isPast = r.date < today;
                  return (
                    <tr key={r.reservationId} className={`border-b border-[#414141]/5 hover:bg-[#414141]/5 transition-colors ${isPast ? "opacity-60" : ""}`}>
                      <td className="px-6 py-3 whitespace-nowrap">
                        <span className={`font-medium ${r.date === today ? "text-[#A5C1C8]" : "text-[#414141]"}`}>
                          {dayjs(r.date).format("M/D (ddd)")}
                        </span>
                        <span className="text-[#414141]/40 text-xs ml-2">{r.startTime}〜{r.endTime}</span>
                        {r.date === today && (
                          <span className="ml-2 px-1.5 py-0.5 bg-[#A5C1C8]/20 text-[#A5C1C8] text-xs rounded-full font-medium">今日</span>
                        )}
                      </td>
                      <td className="px-6 py-3 text-[#414141]/60">{r.facilityName}</td>
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
                            <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 text-[#A5C1C8] flex items-center justify-center text-xs font-bold flex-shrink-0">
                              {r.displayName.charAt(0)}
                            </div>
                          )}
                          <span className="font-medium text-[#414141]">{r.displayName}</span>
                        </div>
                      </td>
                      <td className="px-6 py-3 text-[#414141]/60">{r.tenantName || "—"}</td>
                      <td className="px-6 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          r.status === "confirmed" ? "bg-[#B0E401]/20 text-[#414141]" : "bg-gray-100 text-[#414141]/60"
                        }`}>
                          {r.status === "confirmed" ? "確定" : "キャンセル済"}
                        </span>
                      </td>
                      <td className="px-6 py-3">
                        {r.status === "confirmed" && (
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => openEdit(r)}
                              className="px-2.5 py-1.5 text-xs rounded-lg border border-[#A5C1C8]/40 text-[#A5C1C8] hover:bg-[#A5C1C8]/10 transition-colors"
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
              <div className="px-6 py-12 text-center text-sm text-[#414141]/40">
                該当する予約がありません
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
