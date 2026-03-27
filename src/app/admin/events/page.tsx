"use client";

import { useEffect, useState, useRef } from "react";
import dayjs from "dayjs";

interface EventItem {
  eventId: string;
  title: string;
  category: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
  imageUrl?: string;
  published: boolean;
  scheduledAt?: string;
  createdAt?: string;
  goodCount?: number;
}

const EMPTY_FORM: Omit<EventItem, "eventId" | "createdAt"> = {
  title: "",
  category: "",
  description: "",
  startAt: "",
  endAt: "",
  location: "",
  imageUrl: "",
  published: false,
  scheduledAt: "",
};

type PublishMode = "immediate" | "draft" | "scheduled";

function getPublishMode(item: Omit<EventItem, "eventId" | "createdAt">): PublishMode {
  if (item.published) return "immediate";
  if (item.scheduledAt) return "scheduled";
  return "draft";
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EventItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [publishMode, setPublishMode] = useState<PublishMode>("draft");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  async function fetchEvents() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/events", {
        credentials: "same-origin",
      });
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchEvents(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setPublishMode("draft");
    setImageFile(null);
    setImagePreview("");
    setModalOpen(true);
  }

  function openEdit(ev: EventItem) {
    setEditing(ev);
    setForm({
      title: ev.title,
      category: ev.category,
      description: ev.description,
      startAt: ev.startAt ? dayjs(ev.startAt).format("YYYY-MM-DDTHH:mm") : "",
      endAt: ev.endAt ? dayjs(ev.endAt).format("YYYY-MM-DDTHH:mm") : "",
      location: ev.location,
      imageUrl: ev.imageUrl ?? "",
      published: ev.published,
      scheduledAt: ev.scheduledAt ? dayjs(ev.scheduledAt).format("YYYY-MM-DDTHH:mm") : "",
    });
    setPublishMode(getPublishMode(ev));
    setImageFile(null);
    setImagePreview(ev.imageUrl ?? "");
    setModalOpen(true);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function uploadImage(): Promise<string | null> {
    if (!imageFile) return form.imageUrl || null;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", imageFile);
      fd.append("folder", "events");
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        credentials: "same-origin",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.url as string;
    } catch (e) {
      alert(`画像アップロードに失敗しました: ${e}`);
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const imageUrl = await uploadImage();

      const payload: Record<string, unknown> = {
        ...form,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : "",
        endAt: form.endAt ? new Date(form.endAt).toISOString() : "",
        imageUrl: imageUrl ?? "",
        published: publishMode === "immediate",
        scheduledAt: publishMode === "scheduled" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : null,
      };

      let res: Response;
      if (editing) {
        payload.eventId = editing.eventId;
        res = await fetch("/api/admin/events", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/admin/events", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }

      setModalOpen(false);
      await fetchEvents();
    } catch (e) {
      alert(`保存に失敗しました: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(eventId: string) {
    try {
      const res = await fetch("/api/admin/events", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ eventId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? `削除に失敗しました (${res.status})`);
      }
      setDeleteTarget(null);
      await fetchEvents();
    } catch (e) {
      alert(`削除に失敗しました: ${e instanceof Error ? e.message : e}`);
    }
  }

  function statusBadge(ev: EventItem) {
    if (ev.published) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">公開中</span>;
    }
    if (ev.scheduledAt) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">予約投稿</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">下書き</span>;
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">イベント管理</h2>
          <p className="text-sm text-gray-400 mt-1">イベントの作成・編集・削除</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-700 transition-colors"
        >
          ＋ 新規作成
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : events.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          イベントがありません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">タイトル</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">カテゴリ</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">開始日時</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">グッド</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">予約時刻</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {events.map((ev, i) => (
                <tr
                  key={ev.eventId}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}
                >
                  <td className="px-6 py-3 font-medium text-gray-800">{ev.title}</td>
                  <td className="px-6 py-3 text-gray-500">{ev.category}</td>
                  <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
                    {ev.startAt ? dayjs(ev.startAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-1 text-sm text-gray-700">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#06C755" stroke="#06C755" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 10v12" />
                        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                      </svg>
                      {ev.goodCount ?? 0}
                    </span>
                  </td>
                  <td className="px-6 py-3">{statusBadge(ev)}</td>
                  <td className="px-6 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {ev.scheduledAt ? dayjs(ev.scheduledAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(ev)}
                      className="text-xs text-blue-600 hover:underline mr-3"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => setDeleteTarget(ev.eventId)}
                      className="text-xs text-red-500 hover:underline"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 削除確認ダイアログ */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-900 mb-2">削除の確認</h3>
            <p className="text-sm text-gray-500 mb-5">このイベントを削除しますか？この操作は取り消せません。</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
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

      {/* 作成・編集モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-900">
                {editing ? "イベントを編集" : "新規イベント作成"}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">タイトル *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="イベントタイトル"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ *</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="例：ワークショップ / セミナー"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">開始日時 *</label>
                  <input
                    type="datetime-local"
                    value={form.startAt}
                    onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">終了日時 *</label>
                  <input
                    type="datetime-local"
                    value={form.endAt}
                    onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">場所 *</label>
                <input
                  type="text"
                  value={form.location}
                  onChange={(e) => setForm({ ...form, location: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  placeholder="場所・会場名"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">説明 *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                  placeholder="イベントの説明"
                />
              </div>

              {/* 画像アップロード */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">画像</label>
                <div
                  className="border-2 border-dashed border-gray-200 rounded-lg p-4 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" className="mx-auto max-h-40 object-contain rounded" />
                  ) : (
                    <div className="text-gray-400 text-sm py-4">
                      クリックして画像を選択（5MB以下）
                    </div>
                  )}
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
                {imagePreview && (
                  <button
                    type="button"
                    onClick={() => { setImageFile(null); setImagePreview(""); setForm({ ...form, imageUrl: "" }); }}
                    className="mt-1 text-xs text-red-500 hover:underline"
                  >
                    画像を削除
                  </button>
                )}
              </div>

              {/* 公開設定 */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">公開設定</label>
                <div className="flex gap-3">
                  {(["immediate", "draft", "scheduled"] as PublishMode[]).map((mode) => (
                    <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="publishMode"
                        value={mode}
                        checked={publishMode === mode}
                        onChange={() => setPublishMode(mode)}
                        className="accent-gray-900"
                      />
                      <span className="text-sm text-gray-700">
                        {mode === "immediate" ? "即時公開" : mode === "draft" ? "下書き" : "タイマー投稿"}
                      </span>
                    </label>
                  ))}
                </div>

                {publishMode === "scheduled" && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">公開予約日時</label>
                    <input
                      type="datetime-local"
                      value={form.scheduledAt ?? ""}
                      onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      設定した日時に自動で公開されます（毎時チェック）
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving || uploading}
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving || uploading ? "保存中…" : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
