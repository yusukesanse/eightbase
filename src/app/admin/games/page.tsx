"use client";

import { useEffect, useState, useRef } from "react";
import { GAME_CATEGORIES } from "@/types";
import type { GameStatus } from "@/types";
import DateTimePicker from "@/components/ui/DateTimePicker";
import dayjs from "dayjs";

/* ───────── 型 ───────── */

interface GameItem {
  gameId: string;
  title: string;
  category: string;
  categoryLabel?: string;
  description: string;
  startAt: string;
  endAt?: string;
  location: string;
  imageUrl?: string;
  maxParticipants: number;
  deadline: string;
  calendarId?: string;
  googleEventId?: string;
  status: GameStatus;
  participantCount: number;
  published: boolean;
  scheduledAt?: string;
}

interface Participant {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  joinedAt: string;
}

/* ───────── フォーム初期値 ───────── */

const EMPTY_FORM = {
  title: "",
  category: "",
  categoryLabel: "",
  description: "",
  startAt: "",
  endAt: "",
  location: "",
  imageUrl: "",
  maxParticipants: "8",
  deadline: "",
  published: false,
  scheduledAt: "",
};

type PublishMode = "immediate" | "draft" | "scheduled";

const STATUS_LABELS: Record<GameStatus, { label: string; color: string }> = {
  upcoming:         { label: "募集中",     color: "bg-blue-100 text-blue-700" },
  ongoing:          { label: "開催中",     color: "bg-green-100 text-green-700" },
  awaiting_results: { label: "結果待ち",   color: "bg-amber-100 text-amber-700" },
  completed:        { label: "完了",       color: "bg-gray-100 text-gray-600" },
  cancelled:        { label: "中止",       color: "bg-red-100 text-red-600" },
};

function getCategoryLabel(category: string, categoryLabel?: string): string {
  if (category === "other" && categoryLabel) return categoryLabel;
  return GAME_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

/* ───────── メインコンポーネント ───────── */

export default function AdminGamesPage() {
  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // モーダル
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GameItem | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [publishMode, setPublishMode] = useState<PublishMode>("draft");
  const [saving, setSaving] = useState(false);

  // 画像
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 削除
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  // 参加者モーダル
  const [participantsGameId, setParticipantsGameId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  // フィルター
  const [statusFilter, setStatusFilter] = useState<"all" | GameStatus>("all");

  /* ───────── データ取得 ───────── */

  async function fetchGames() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/games", { credentials: "same-origin" });
      const data = await res.json();
      setGames(data.games ?? []);
    } catch { setError("データの取得に失敗しました"); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchGames(); }, []);

  /* ───────── 参加者取得 ───────── */

  async function openParticipants(gameId: string) {
    setParticipantsGameId(gameId);
    setLoadingParticipants(true);
    try {
      const res = await fetch(`/api/admin/games/${gameId}/participants`, { credentials: "same-origin" });
      const data = await res.json();
      setParticipants(data.participants ?? []);
    } catch { setParticipants([]); }
    finally { setLoadingParticipants(false); }
  }

  /* ───────── モーダル操作 ───────── */

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM });
    setPublishMode("draft");
    setImageFile(null);
    setImagePreview("");
    setModalOpen(true);
  }

  function openEdit(g: GameItem) {
    setEditing(g);
    setForm({
      title: g.title,
      category: g.category,
      categoryLabel: g.categoryLabel ?? "",
      description: g.description,
      startAt: g.startAt ? dayjs(g.startAt).format("YYYY-MM-DDTHH:mm") : "",
      endAt: g.endAt ? dayjs(g.endAt).format("YYYY-MM-DDTHH:mm") : "",
      location: g.location,
      imageUrl: g.imageUrl ?? "",
      maxParticipants: String(g.maxParticipants),
      deadline: g.deadline ? dayjs(g.deadline).format("YYYY-MM-DDTHH:mm") : "",
      published: g.published,
      scheduledAt: g.scheduledAt ? dayjs(g.scheduledAt).format("YYYY-MM-DDTHH:mm") : "",
    });
    setPublishMode(g.published ? "immediate" : g.scheduledAt ? "scheduled" : "draft");
    setImageFile(null);
    setImagePreview(g.imageUrl ?? "");
    setModalOpen(true);
  }

  /* ───────── 画像 ───────── */

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
      fd.append("folder", "games");
      const res = await fetch("/api/admin/upload", { method: "POST", credentials: "same-origin", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      return data.url as string;
    } catch (e) { alert(`画像アップロードに失敗しました: ${e}`); return null; }
    finally { setUploading(false); }
  }

  /* ───────── 保存 ───────── */

  async function handleSave() {
    setSaving(true);
    try {
      const imageUrl = await uploadImage();
      const payload: Record<string, unknown> = {
        title: form.title,
        category: form.category,
        description: form.description,
        startAt: form.startAt ? new Date(form.startAt).toISOString() : "",
        endAt: form.endAt ? new Date(form.endAt).toISOString() : "",
        location: form.location,
        imageUrl: imageUrl ?? "",
        maxParticipants: Number(form.maxParticipants) || 8,
        deadline: form.deadline ? new Date(form.deadline).toISOString() : "",
        published: publishMode === "immediate",
        scheduledAt: publishMode === "scheduled" && form.scheduledAt
          ? new Date(form.scheduledAt).toISOString() : null,
      };

      const method = editing ? "PUT" : "POST";
      if (editing) payload.gameId = editing.gameId;

      const res = await fetch("/api/admin/games", {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error);

      setModalOpen(false);
      await fetchGames();
    } catch (e) { alert(`保存に失敗しました: ${e}`); }
    finally { setSaving(false); }
  }

  /* ───────── 削除 ───────── */

  async function handleDelete(gameId: string) {
    try {
      const res = await fetch("/api/admin/games", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ gameId }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setDeleteTarget(null);
      await fetchGames();
    } catch (e) { alert(`削除に失敗しました: ${e}`); }
  }

  /* ───────── ステータス更新 ───────── */

  async function updateStatus(gameId: string, status: GameStatus) {
    try {
      const res = await fetch("/api/admin/games", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ gameId, status }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      await fetchGames();
    } catch (e) { alert(`ステータス更新に失敗しました: ${e}`); }
  }

  /* ───────── フィルター ───────── */

  const filteredGames = statusFilter === "all"
    ? games
    : games.filter((g) => g.status === statusFilter);

  const inputClass = "w-full border border-[#231714]/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#231714]";
  const labelClass = "block text-xs font-medium text-[#231714]/60 mb-1";

  /* ───────── レンダリング ───────── */

  return (
    <div className="p-8">
      {/* ヘッダー */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-[#231714]">ゲーム管理</h2>
          <p className="text-sm text-[#231714]/40 mt-1">大会・トーナメントの作成・管理</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-[#231714] text-white text-sm font-medium rounded-lg hover:bg-[#231714]/80 transition-colors">
          ＋ 新規作成
        </button>
      </div>

      {/* ステータスフィルター */}
      <div className="flex gap-1 mb-5 bg-[#231714]/5 rounded-xl p-1 overflow-x-auto">
        {[
          { key: "all" as const, label: "すべて" },
          { key: "upcoming" as const, label: "募集中" },
          { key: "ongoing" as const, label: "開催中" },
          { key: "awaiting_results" as const, label: "結果待ち" },
          { key: "completed" as const, label: "完了" },
        ].map((tab) => {
          const count = tab.key === "all" ? games.length : games.filter((g) => g.status === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                statusFilter === tab.key
                  ? "bg-white text-[#231714] shadow-sm"
                  : "text-[#231714]/40 hover:text-[#231714]/60"
              }`}
            >
              {tab.label}
              <span className={`min-w-[18px] h-[18px] flex items-center justify-center rounded-full text-[10px] font-bold ${
                statusFilter === tab.key ? "bg-[#231714] text-white" : "bg-[#231714]/10 text-[#231714]/40"
              }`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* 一覧 */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-sm text-red-600">{error}</div>
      ) : filteredGames.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/40">
          該当するゲームがありません
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-[#231714]/5">
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#231714]/60 whitespace-nowrap">タイトル</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#231714]/60 whitespace-nowrap">種目</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#231714]/60 whitespace-nowrap">開催日時</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#231714]/60 whitespace-nowrap">参加</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#231714]/60 whitespace-nowrap">締切</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#231714]/60 whitespace-nowrap">ステータス</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {filteredGames.map((g) => (
                  <tr key={g.gameId} className="border-b border-[#231714]/5 hover:bg-[#231714]/[0.02] transition-colors">
                    <td className="px-5 py-3 font-medium text-[#231714]">{g.title}</td>
                    <td className="px-5 py-3 text-[#231714]/60 whitespace-nowrap">{getCategoryLabel(g.category, g.categoryLabel)}</td>
                    <td className="px-5 py-3 text-[#231714]/60 whitespace-nowrap">
                      {g.startAt ? dayjs(g.startAt).format("M/D HH:mm") : "—"}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <button onClick={() => openParticipants(g.gameId)} className="text-[#A5C1C8] hover:underline">
                        {g.participantCount ?? 0}/{g.maxParticipants}名
                      </button>
                    </td>
                    <td className="px-5 py-3 text-[#231714]/40 text-xs whitespace-nowrap">
                      {g.deadline ? dayjs(g.deadline).format("M/D HH:mm") : "—"}
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_LABELS[g.status]?.color ?? "bg-gray-100 text-gray-600"}`}>
                        {STATUS_LABELS[g.status]?.label ?? g.status}
                      </span>
                      {!g.published && <span className="ml-1.5 text-[10px] text-[#231714]/30">非公開</span>}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      {/* ステータス遷移ボタン */}
                      {g.status === "upcoming" && (
                        <button onClick={() => updateStatus(g.gameId, "ongoing")} className="text-xs text-green-600 hover:underline mr-2">開始</button>
                      )}
                      {g.status === "ongoing" && (
                        <button onClick={() => updateStatus(g.gameId, "awaiting_results")} className="text-xs text-amber-600 hover:underline mr-2">終了</button>
                      )}
                      {g.status === "awaiting_results" && (
                        <button onClick={() => updateStatus(g.gameId, "completed")} className="text-xs text-blue-600 hover:underline mr-2">完了</button>
                      )}
                      <button onClick={() => openEdit(g)} className="text-xs text-[#A5C1C8] hover:underline mr-2">編集</button>
                      <button onClick={() => setDeleteTarget(g.gameId)} className="text-xs text-red-600 hover:underline">削除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ───── 削除確認 ───── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="text-base font-semibold text-[#231714] mb-2">削除の確認</h3>
            <p className="text-sm text-[#231714]/60 mb-5">このゲームを削除しますか？参加者データも削除されます。</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50">キャンセル</button>
              <button onClick={() => handleDelete(deleteTarget)} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">削除する</button>
            </div>
          </div>
        </div>
      )}

      {/* ───── 参加者一覧 / 結果登録モーダル ───── */}
      {participantsGameId && (
        <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8">
            <div className="px-6 py-5 border-b border-[#231714]/5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-[#231714]">参加者一覧</h3>
                <p className="text-xs text-[#231714]/40 mt-0.5">{participants.length}名参加</p>
              </div>
              <button onClick={() => setParticipantsGameId(null)} className="px-3 py-1.5 text-xs border border-[#231714]/10 rounded-lg hover:bg-gray-50">
                閉じる
              </button>
            </div>
            <div className="px-6 py-4">
              {loadingParticipants ? (
                <div className="flex justify-center py-8">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
                </div>
              ) : participants.length === 0 ? (
                <p className="text-sm text-[#231714]/40 text-center py-8">まだ参加者がいません</p>
              ) : (
                <div className="space-y-2">
                  {participants.map((p, i) => (
                    <div key={p.lineUserId} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50">
                      <span className="text-xs font-bold text-[#231714]/30 w-5 text-right">{i + 1}</span>
                      {p.pictureUrl ? (
                        <img src={p.pictureUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-xs font-bold text-[#A5C1C8]">
                          {p.displayName.charAt(0)}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#231714] truncate">{p.displayName}</p>
                        <p className="text-[10px] text-[#231714]/30">{dayjs(p.joinedAt).format("M/D HH:mm")} 申込</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                {editing ? "ゲームを編集" : "新規ゲーム作成"}
              </h3>
            </div>

            <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* タイトル */}
              <div>
                <label className={labelClass}>タイトル *</label>
                <input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputClass} placeholder="第1回麻雀トーナメント" />
              </div>

              {/* カテゴリ */}
              <div>
                <label className={labelClass}>種目 *</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className={`${inputClass} bg-white`}
                >
                  <option value="" disabled>種目を選択</option>
                  {GAME_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>

              {/* 日時 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>開催日時 *</label>
                  <DateTimePicker value={form.startAt} onChange={(v) => setForm({ ...form, startAt: v })} required />
                </div>
                <div>
                  <label className={labelClass}>終了日時</label>
                  <DateTimePicker value={form.endAt} onChange={(v) => setForm({ ...form, endAt: v })} />
                </div>
              </div>

              {/* 場所 */}
              <div>
                <label className={labelClass}>場所 *</label>
                <input type="text" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={inputClass} placeholder="EIGHT BASE UNGA 3F" />
              </div>

              {/* 定員・締切 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>定員（名） *</label>
                  <input type="number" min="2" value={form.maxParticipants} onChange={(e) => setForm({ ...form, maxParticipants: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>申込締切 *</label>
                  <DateTimePicker value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })} required />
                </div>
              </div>

              {/* 説明 */}
              <div>
                <label className={labelClass}>説明 *</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={4} className={`${inputClass} resize-none`} placeholder="ゲームの詳細を入力" />
              </div>

              {/* 画像 */}
              <div>
                <label className={labelClass}>画像</label>
                <div className="border-2 border-dashed border-[#231714]/10 rounded-lg p-4 text-center cursor-pointer hover:border-gray-400 transition-colors" onClick={() => fileInputRef.current?.click()}>
                  {imagePreview ? (
                    <img src={imagePreview} alt="preview" className="mx-auto max-h-32 object-contain rounded" />
                  ) : (
                    <div className="text-[#231714]/40 text-sm py-3">クリックして画像を選択</div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
                {imagePreview && (
                  <button type="button" onClick={() => { setImageFile(null); setImagePreview(""); setForm({ ...form, imageUrl: "" }); }} className="mt-1 text-xs text-red-600 hover:underline">画像を削除</button>
                )}
              </div>

              {/* 公開設定 */}
              <div>
                <label className={labelClass}>公開設定</label>
                <div className="flex gap-3">
                  {(["immediate", "draft", "scheduled"] as PublishMode[]).map((mode) => (
                    <label key={mode} className="flex items-center gap-1.5 cursor-pointer">
                      <input type="radio" name="publishMode" value={mode} checked={publishMode === mode} onChange={() => setPublishMode(mode)} className="accent-[#231714]" />
                      <span className="text-sm text-[#231714]">
                        {mode === "immediate" ? "即時公開" : mode === "draft" ? "下書き" : "タイマー投稿"}
                      </span>
                    </label>
                  ))}
                </div>
                {publishMode === "scheduled" && (
                  <div className="mt-3">
                    <DateTimePicker value={form.scheduledAt} onChange={(v) => setForm({ ...form, scheduledAt: v })} />
                    <p className="text-xs text-[#231714]/40 mt-1">設定した日時に自動で公開されます</p>
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm border border-[#231714]/10 rounded-lg hover:bg-gray-50">キャンセル</button>
              <button onClick={handleSave} disabled={saving || uploading} className="px-4 py-2 text-sm bg-[#231714] text-white rounded-lg hover:bg-[#231714]/80 disabled:opacity-50">
                {saving || uploading ? "保存中…" : "保存する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
