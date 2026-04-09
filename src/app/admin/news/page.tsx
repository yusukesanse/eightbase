"use client";

import { useEffect, useState, useRef } from "react";
import dayjs from "dayjs";
import DateTimePicker from "@/components/ui/DateTimePicker";

interface NewsItem {
  newsId: string;
  title: string;
  body: string;
  category: string;
  publishedAt: string;
  imageUrl?: string;
  priority?: string;
  published: boolean;
  scheduledAt?: string;
}

const NEWS_CATEGORIES = ["info", "facility", "community"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  info: "お知らせ",
  facility: "施設",
  community: "コミュニティ",
};

const PRIORITY_OPTIONS = ["high", "medium", "normal"] as const;
const PRIORITY_LABELS: Record<string, { label: string; color: string }> = {
  high:   { label: "高（Breaking News）", color: "bg-red-100 text-red-700" },
  medium: { label: "中（Top Stories）",   color: "bg-amber-100 text-amber-700" },
  normal: { label: "通常（Recent）",      color: "bg-gray-100 text-[#414141]/60" },
};

const EMPTY_FORM = {
  title: "",
  body: "",
  category: "info",
  publishedAt: "",
  imageUrl: "",
  priority: "normal",
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


  async function fetchNews() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/news", {
        credentials: "same-origin",
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
      priority: item.priority ?? "normal",
      published: item.published,
      scheduledAt: item.scheduledAt ? dayjs(item.scheduledAt).format("YYYY-MM-DDTHH:mm") : "",
    });
    setPublishMode(getPublishMode({
      ...item,
      imageUrl: item.imageUrl ?? "",
      priority: item.priority ?? "normal",
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
        publishedAt: form.publishedAt ? new Date(form.publishedAt).toISOString() : new Date().toISOString(),
        imageUrl: imageUrl ?? "",
        priority: form.priority || "normal",
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
          },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/admin/news", {
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
        },
        credentials: "same-origin",
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
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-[#414141]/60">下書き</span>;
  }

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#414141]">ニュース管理</h2>
          <p className="text-sm text-[#414141]/40 mt-1">ニュースの作成・編集・削除</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[#414141] text-white text-sm font-medium rounded-lg hover:bg-[#414141]/80 transition-colors"
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
        <div className="bg-white rounded-xl border border-[#414141]/10 p-10 text-center text-sm text-[#414141]/40">
          ニュースがありません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#414141]/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#414141]/5 border-b border-[#414141]/5">
                <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">タイトル</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">カテゴリ</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">重要度</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">投稿日時</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">ステータス</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#414141]/60">予約時刻</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {newsList.map((item, i) => (
                <tr
                  key={item.newsId}
                  className={`border-b border-[#414141]/5 hover:bg-[#414141]/5 transition-colors ${i % 2 === 0 ? "" : "bg-[#414141]/5"}`}
                >
                  <td className="px-6 py-3 font-medium text-[#414141]">{item.title}</td>
                  <td className="px-6 py-3 text-[#414141]/60">{CATEGORY_LABELS[item.category] ?? item.category}</td>
                  <td className="px-6 py-3">
                    {(() => {
                      const p = PRIORITY_LABELS[item.priority ?? "normal"] ?? PRIORITY_LABELS.normal;
                      return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.color}`}>{p.label.split("（")[0]}</span>;
                    })()}
                  </td>
                  <td className="px-6 py-3 text-[#414141]/60 whitespace-nowrap">
                    {item.publishedAt ? dayjs(item.publishedAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3">{statusBadge(item)}</td>
                  <td className="px-6 py-3 text-[#414141]/40 text-xs whitespace-nowrap">
                    {item.scheduledAt ? dayjs(item.scheduledAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(item)}
                      className="text-xs text-[#A5C1C8] hover:underline mr-3"
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
            <h3 className="text-base font-semibold text-[#414141] mb-2">削除の確認</h3>
            <p className="text-sm text-[#414141]/60 mb-5">このニュースを削除しますか？この操作は取り消せません。</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm border border-[#414141]/10 rounded-lg hover:bg-gray-50"
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
              <h3 className="text-base font-semibold text-[#414141]">
                {editing ? "ニュースを編集" : "新規ニュース作成"}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">タイトル *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-[#414141]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#414141]"
                  placeholder="ニュースタイトル"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">カテゴリ *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-[#414141]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#414141] bg-white"
                >
                  {NEWS_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-2">重要度 *</label>
                <div className="flex gap-2">
                  {PRIORITY_OPTIONS.map((p) => {
                    const info = PRIORITY_LABELS[p];
                    const isSelected = form.priority === p;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setForm({ ...form, priority: p })}
                        className={`flex-1 px-3 py-2.5 rounded-lg border text-xs font-medium text-center transition-all ${
                          isSelected
                            ? p === "high"
                              ? "bg-red-50 border-red-300 text-red-700 ring-2 ring-red-200"
                              : p === "medium"
                              ? "bg-amber-50 border-amber-300 text-amber-700 ring-2 ring-amber-200"
                              : "bg-gray-100 border-gray-300 text-[#414141] ring-2 ring-gray-200"
                            : "bg-white border-[#414141]/10 text-[#414141]/60 hover:bg-gray-50"
                        }`}
                      >
                        {info.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">投稿日時</label>
                <DateTimePicker
                  value={form.publishedAt}
                  onChange={(v) => setForm({ ...form, publishedAt: v })}
                />
                <p className="text-xs text-[#414141]/40 mt-1">空欄の場合は保存時の日時が使用されます</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">本文 *</label>
                <textarea
                  value={form.body}
                  onChange={(e) => setForm({ ...form, body: e.target.value })}
                  rows={6}
                  className="w-full border border-[#414141]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#414141] resize-none"
                  placeholder="ニュース本文"
                />
              </div>

              {/* 画像アップロード */}
              <div>
                <label className="block text-xs font-medium text-[#414141]/60 mb-1">画像</label>
                <div
                  className="border-2 border-dashed border-[#414141]/10 rounded-lg p-4 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" className="mx-auto max-h-40 object-contain rounded" />
                  ) : (
                    <div className="text-[#414141]/40 text-sm py-4">
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
                <label className="block text-xs font-medium text-[#414141]/60 mb-2">公開設定</label>
                <div className="flex gap-3">
                  {(["immediate", "draft", "scheduled"] as PublishMode[]).map((mode) => (
                    <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="publishMode"
                        value={mode}
                        checked={publishMode === mode}
                        onChange={() => setPublishMode(mode)}
                        className="accent-[#414141]"
                      />
                      <span className="text-sm text-[#414141]">
                        {mode === "immediate" ? "即時公開" : mode === "draft" ? "下書き" : "タイマー投稿"}
                      </span>
                    </label>
                  ))}
                </div>

                {publishMode === "scheduled" && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-[#414141]/60 mb-1">公開予約日時</label>
                    <DateTimePicker
                      value={form.scheduledAt ?? ""}
                      onChange={(v) => setForm({ ...form, scheduledAt: v })}
                    />
                    <p className="text-xs text-[#414141]/40 mt-1">
                      設定した日時に自動で公開されます（毎時チェック）
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm border border-[#414141]/10 rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving || uploading}
                className="px-4 py-2 text-sm bg-[#414141] text-white rounded-lg hover:bg-[#414141]/80 disabled:opacity-50 disabled:cursor-not-allowed"
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
