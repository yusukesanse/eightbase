"use client";

import { useEffect, useState, useRef } from "react";
import dayjs from "dayjs";
import DateTimePicker from "@/components/ui/DateTimePicker";

interface QuestItem {
  questId: string;
  title: string;
  description: string;
  category: string;
  imageUrl?: string;
  published?: boolean;
  scheduledAt?: string;
  goodCount?: number;
}

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "",
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

export default function AdminQuestsPage() {
  const [quests, setQuests] = useState<QuestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<QuestItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [publishMode, setPublishMode] = useState<PublishMode>("draft");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [statusTab, setStatusTab] = useState<"all" | "published" | "draft" | "scheduled">("all");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);


  async function fetchQuests() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/quests", {
        credentials: "same-origin",
      });
      const data = await res.json();
      setQuests(data.quests ?? []);
    } catch {
      setError("データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchQuests(); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setPublishMode("draft");
    setImageFile(null);
    setImagePreview("");
    setModalOpen(true);
  }

  function openEdit(q: QuestItem) {
    setEditing(q);
    setForm({
      title: q.title,
      description: q.description,
      category: q.category,
      imageUrl: q.imageUrl ?? "",
      published: q.published ?? false,
      scheduledAt: q.scheduledAt ? dayjs(q.scheduledAt).format("YYYY-MM-DDTHH:mm") : "",
    });
    setPublishMode(getPublishMode({
      ...EMPTY_FORM,
      published: q.published ?? false,
      scheduledAt: q.scheduledAt ?? "",
    }));
    setImageFile(null);
    setImagePreview(q.imageUrl ?? "");
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
      fd.append("folder", "quests");
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
        imageUrl: imageUrl ?? "",
        published: publishMode === "immediate",
        scheduledAt: publishMode === "scheduled" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString()
          : null,
      };

      let res: Response;
      if (editing) {
        payload.questId = editing.questId;
        res = await fetch("/api/admin/quests", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/admin/quests", {
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
      await fetchQuests();
    } catch (e) {
      alert(`保存に失敗しました: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(questId: string) {
    try {
      const res = await fetch("/api/admin/quests", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        body: JSON.stringify({ questId }),
      });
      if (!res.ok) throw new Error("削除に失敗しました");
      setDeleteTarget(null);
      await fetchQuests();
    } catch (e) {
      alert(`削除に失敗しました: ${e}`);
    }
  }

  function statusBadge(q: QuestItem) {
    if (q.published) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">公開中</span>;
    }
    if (q.scheduledAt) {
      return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">予約投稿</span>;
    }
    return <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-[#231714]/60">下書き</span>;
  }

  const Q_TABS = [
    { key: "all" as const, label: "すべて", count: quests.length },
    { key: "published" as const, label: "公開済み", count: quests.filter(q => q.published).length },
    { key: "draft" as const, label: "下書き", count: quests.filter(q => !q.published && !q.scheduledAt).length },
    { key: "scheduled" as const, label: "タイマー設定", count: quests.filter(q => !q.published && !!q.scheduledAt).length },
  ];

  const filteredQuests = quests.filter((q) => {
    if (statusTab === "published") return q.published;
    if (statusTab === "draft") return !q.published && !q.scheduledAt;
    if (statusTab === "scheduled") return !q.published && !!q.scheduledAt;
    return true;
  });

  return (
    <div className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#231714]">クエスト管理</h2>
          <p className="text-sm text-[#231714]/40 mt-1">クエストの作成・編集・削除</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/80 transition-colors"
        >
          ＋ 新規作成
        </button>
      </div>

      {/* ステータスタブ */}
      <div className="flex gap-1 mb-5 bg-[#231714]/5 rounded-xl p-1">
        {Q_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              statusTab === tab.key
                ? "bg-white text-[#231714] shadow-sm"
                : "text-[#231714]/40 hover:text-[#231714]/60"
            }`}
          >
            {tab.label}
            <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
              statusTab === tab.key ? "bg-[#231714] text-white" : "bg-[#231714]/10 text-[#231714]/40"
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : filteredQuests.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
          {statusTab === "all" ? "クエストがありません" : "該当するクエストがありません"}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#231714]/5 border-b border-[#231714]/5">
                <th className="text-left px-6 py-3 text-xs font-medium text-[#231714]/60">タイトル</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#231714]/60">カテゴリ</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#231714]/60">グッド</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#231714]/60">ステータス</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-[#231714]/60">予約時刻</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {filteredQuests.map((q, i) => (
                <tr
                  key={q.questId}
                  className={`border-b border-[#231714]/5 hover:bg-[#231714]/5 transition-colors ${i % 2 === 0 ? "" : "bg-[#231714]/5"}`}
                >
                  <td className="px-6 py-3 font-medium text-[#231714]">{q.title}</td>
                  <td className="px-6 py-3 text-[#231714]/60">{q.category}</td>
                  <td className="px-6 py-3">
                    <span className="inline-flex items-center gap-1 text-sm text-[#231714]">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="#BA7517" stroke="#BA7517" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M7 10v12" />
                        <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
                      </svg>
                      {q.goodCount ?? 0}
                    </span>
                  </td>
                  <td className="px-6 py-3">{statusBadge(q)}</td>
                  <td className="px-6 py-3 text-[#231714]/40 text-xs whitespace-nowrap">
                    {q.scheduledAt ? dayjs(q.scheduledAt).format("YYYY/M/D HH:mm") : "—"}
                  </td>
                  <td className="px-6 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEdit(q)}
                      className="text-xs text-[#8BB5BF] hover:underline mr-3"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => setDeleteTarget(q.questId)}
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
            <h3 className="text-base font-semibold text-[#231714] mb-2">削除の確認</h3>
            <p className="text-sm text-[#231714]/60 mb-5">このクエストを削除しますか？この操作は取り消せません。</p>
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

      {/* 作成・編集モーダル */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-5 border-b border-gray-100">
              <h3 className="text-base font-semibold text-[#231714]">
                {editing ? "クエストを編集" : "新規クエスト作成"}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">タイトル *</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]"
                  placeholder="クエストタイトル"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">カテゴリ *</label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className="w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]"
                  placeholder="例：予約 / 交流 / 利用"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">説明 *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={3}
                  className="w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714] resize-none"
                  placeholder="クエストの説明"
                />
              </div>

              {/* 画像アップロード */}
              <div>
                <label className="block text-xs font-medium text-[#231714]/60 mb-1">画像</label>
                <div
                  className="border-2 border-dashed border-[#231714]/10 rounded-lg p-4 text-center cursor-pointer hover:border-gray-400 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" className="mx-auto max-h-40 object-contain rounded" />
                  ) : (
                    <div className="text-[#231714]/40 text-sm py-4">
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
                <label className="block text-xs font-medium text-[#231714]/60 mb-2">公開設定</label>
                <div className="flex gap-3">
                  {(["immediate", "draft", "scheduled"] as PublishMode[]).map((mode) => (
                    <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="publishMode"
                        value={mode}
                        checked={publishMode === mode}
                        onChange={() => setPublishMode(mode)}
                        className="accent-[#231714]"
                      />
                      <span className="text-sm text-[#231714]">
                        {mode === "immediate" ? "即時公開" : mode === "draft" ? "下書き" : "タイマー投稿"}
                      </span>
                    </label>
                  ))}
                </div>

                {publishMode === "scheduled" && (
                  <div className="mt-3">
                    <label className="block text-xs font-medium text-[#231714]/60 mb-1">公開予約日時</label>
                    <DateTimePicker
                      value={form.scheduledAt ?? ""}
                      onChange={(v) => setForm({ ...form, scheduledAt: v })}
                    />
                    <p className="text-xs text-[#231714]/40 mt-1">
                      設定した日時に自動で公開されます（毎時チェック）
                    </p>
                  </div>
                )}
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
                disabled={saving || uploading}
                className="px-4 py-2 text-sm bg-[#231714] text-white rounded-lg hover:bg-[#231714]/80 disabled:opacity-50 disabled:cursor-not-allowed"
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
