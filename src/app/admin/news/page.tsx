"use client";

import { useEffect, useState, useRef } from "react";
import dayjs from "dayjs";

interface NewsItem {
  newsId: string;
  title: string;
  body: string;
  category: string;
  publishedAt: string;
  imageUrl?: string;
  published: boolean;
  scheduledAt?: string;
}

const NEWS_CATEGORIES = ["important", "info", "facility", "community"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  important: "重要",
  info: "お知らせ",
  facility: "施設",
  community: "コミュニティ",
};

const EMPTY_FORM = {
  title: "",
  body: "",
  category: "info",
  publishedAt: "",
  imageUrl: "",
  published: false,
  scheduledAt: "",
};

type PublishMode = "immediate" | "draft" | "scheduled";

function getPublishMode(item: typeof EMPTY_FORM): PublishMode {
  if (item.published) return "immediate";
  if (item.scheduledAt) return "scheduled";
  return "draft";
}

export default function AdminNewsPage() {
  const [newsList, setNewsList] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<NewsItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [publishMode, setPublishMode] = useState<PublishMode>("draft");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function getToken() {
    return sessionStorage.getItem("admin_token") ?? "";
  }

  async function fetchNews() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/news", {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      setNewsList(data.news ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchNews(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setPublishMode("draft");
    setImageFile(null);
    setImagePreview("");
    setModalOpen(true);
  }

  function openEdit(item: NewsItem) {
    setEditing(item);
    setForm({
      title: item.title,
      body: item.body,
      category: item.category,
      publishedAt: item.publishedAt ? dayjs(item.publishedAt).format("YYYY-MM-DDTHH:mm") : "",
      imageUrl: item.imageUrl ?? "",
      published: item.published,
      scheduledAt: item.scheduledAt ? dayjs(item.scheduledAt).format("YYYY-MM-DDTHH:mm") : "",
    });
    setPublishMode(getPublishMode({
      ...item,
      imageUrl: item.imageUrl ?? "",
      scheduledAt: item.scheduledAt ?? "",
      publishedAt: item.publishedAt,
    }));
    setImageFile(null);
    setImagePreview(item.imageUrl ?? "");
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
      fd.append("folder", "news");
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
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
        publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : new Date().toISOString(),
        imageUrl: imageUrl ?? "",
        published: publishMode === "immediate",
        scheduledAt: publishMode === "scheduled" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : null,
      };

      let res: Response;
      if (editing) {
        payload.newsId = editing.newsId;
        res = await fetch("/api/admin/news", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/admin/news", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getToken()}`,
          },
          body: JSON.stringify(payload),
        });
      }

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error);
      }

      setModalOpen(false);
      await fetchNews();
    } catch (e) {
      alert(`保存に失敗しました: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(newsId: string) {
    try {
      const res = await fetch("/api/admin/news", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ newsId }),
      });
      if (!res.ok) throw new Error("削除に失敗しました");
      setDeleteTarget(null);
      await fetchNews();
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    }
  }

  function statusBadge(item: NewsItem) {
    if (item.published) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">公開中</span>;
    }
    if (item.scheduledAt) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">予約投稿</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">下書き</span>;
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">ニュース管理</h2>
          <p className="text-sm text-gray-400 mt-1">ニュースの作成・編集・削除</p>
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
      ) : newsList.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-sm text-gray-400">
          ニュースがありません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">タイトル</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">カテゴリ</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">投稿日時</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">ステータス</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500">予約時刻</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {newsList.map((item, i) => (
                <tr
                  key={item.newsId}
                  className={`border-b border-gray-50 hover:bg-gray-50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}
                >
                  <td className="px-6 py-3 font-medium text-gray-800">{item.title}</td>
                  <td className="px-6 py-3 text-gray-500">{CATEGORY_LABELS[item.category] ?? item.category}</td>
                  <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
                    {item.publishedAt ? dayjs(item.publishedAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3">{statusBadge(item)}</td>
                  <td className="px-6 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {item.scheduledAt ? dayjs(item.scheduledAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-xs text-blue-600 hover:underline mr-3"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => setDeleteTarget(item.newsId)}
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

      {/* 削除確認 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-gray-900 mb-2">削除の確認</h3>
            <p className="text-sm text-gray-500 mb-5">このニュースを削除しますか？この操作は取り消せません。</p>
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
                {editing ? "ニュースを編集" : "新規ニュース作成"}
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
                  placeholder="ニュースタイトル"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white"
                >
                  {NEWS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">投稿日時</label>
                <input
                  type="datetime-local"
                  value={form.publishedAt}
                  onChange={(e) => setForm({ ...form, publishedAt: e.target.value })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                />
                <p className="text-xs text-gray-400 mt-1">空欄の場合は保存時の日時が使用されます</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">本文 *</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={6}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
                  placeholder="ニュース本文"
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
