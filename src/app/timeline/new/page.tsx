"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { prependPostCache } from "@/lib/timelineCache";

export default function NewPostPage() {
  const router = useRouter();
  const [type, setType] = useState<"offer" | "request">("offer");
  const [content, setContent] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function addTag() {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed) && tags.length < 5) {
      setTags((prev) => [...prev, trimmed]);
      setTagInput("");
    }
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  async function handleSubmit() {
    if (!content.trim()) {
      setError("内容を入力してください");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, content: content.trim(), tags }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "投稿に失敗しました");
        return;
      }

      // 投稿を一覧キャッシュの先頭へ即時反映（著者名等は遷移先の裏更新で補完される）。
      // postId を一致させることで、timelineで新着バナーではなく静かな差し替えになる。
      const { postId } = await res.json().catch(() => ({ postId: "" }));
      if (postId) {
        prependPostCache({
          postId,
          authorId: "",
          authorName: "",
          authorPictureUrl: "",
          type,
          content: content.trim(),
          tags,
          likes: [],
          commentCount: 0,
          createdAt: new Date().toISOString(),
        });
      }

      router.push("/timeline");
      router.refresh();
    } catch {
      setError("投稿に失敗しました");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* ヘッダー */}
      <header className="bg-white pt-12 pb-4 px-5 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4l-6 6 6 6" stroke="#231714" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <h1 className="text-[15px] font-medium text-[#231714]">新しい投稿</h1>
        </div>
        <button
          onClick={handleSubmit}
          disabled={submitting || !content.trim()}
          className="px-4 py-1.5 text-[13px] font-medium rounded-full bg-[#4f757e] text-white disabled:opacity-40 transition-opacity"
        >
          {submitting ? "投稿中..." : "投稿する"}
        </button>
      </header>

      {/* 投稿タイプ選択 */}
      <div className="bg-white px-5 py-4 border-b border-gray-100">
        <p className="text-[12px] text-[#231714]/85 mb-2">投稿タイプ</p>
        <div className="flex gap-3">
          <button
            onClick={() => setType("offer")}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium border transition-colors ${
              type === "offer"
                ? "bg-[#B0E401]/15 border-[#B0E401] text-[#7A9E00]"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            できます
          </button>
          <button
            onClick={() => setType("request")}
            className={`flex-1 py-2.5 rounded-lg text-[13px] font-medium border transition-colors ${
              type === "request"
                ? "bg-[#F5A623]/15 border-[#F5A623] text-[#C4841D]"
                : "bg-white border-gray-200 text-gray-700"
            }`}
          >
            探してます
          </button>
        </div>
      </div>

      {/* 本文入力 */}
      <div className="bg-white px-5 py-4 border-b border-gray-100">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={
            type === "offer"
              ? "あなたができること、提供できるサービスを書いてみましょう"
              : "探していること、お願いしたいことを書いてみましょう"
          }
          maxLength={500}
          rows={6}
          className="w-full text-[14px] text-[#231714] bg-transparent resize-none focus:outline-none leading-relaxed placeholder:text-gray-700"
        />
        <p className="text-[10px] text-gray-700 text-right mt-1">
          {content.length}/500
        </p>
      </div>

      {/* タグ */}
      <div className="bg-white px-5 py-4 border-b border-gray-100">
        <p className="text-[12px] text-[#231714]/85 mb-2">タグ（最大5個）</p>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {tags.map((tag) => (
              <button
                key={tag}
                onClick={() => removeTag(tag)}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full bg-[#A5C1C8]/10 text-[#4f757e]"
              >
                #{tag}
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="#A5C1C8" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        )}

        {tags.length < 5 && (
          <div className="flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addTag())}
              placeholder="タグを入力"
              className="flex-1 px-3 py-2 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
            />
            <button
              onClick={addTag}
              disabled={!tagInput.trim()}
              className="px-3 py-2 text-[12px] rounded-lg bg-gray-100 text-[#231714]/85 disabled:opacity-40"
            >
              追加
            </button>
          </div>
        )}
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="mx-5 mt-3 px-4 py-2.5 bg-red-50 rounded-lg">
          <p className="text-[12px] text-red-500">{error}</p>
        </div>
      )}
    </div>
  );
}
