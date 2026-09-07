"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { prependPostCache } from "@/lib/timelineCache";
import { Button, GlassCard, PageBg, PageHeading, inputClass } from "@/components/ui/eb";

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
    <PageBg>
      <div className="flex items-center justify-between gap-3 px-5 pt-[52px] pb-2">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-1">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M13 4l-6 6 6 6" stroke="var(--eb-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <PageHeading title="新しい投稿" />
        </div>
      </div>

      <div className="flex flex-col gap-4 px-5 pt-4 pb-10">
        {/* 投稿タイプ選択 */}
        <GlassCard>
          <p className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">投稿タイプ</p>
          <div className="flex gap-2">
            <button
              onClick={() => setType("offer")}
              className={clsx(
                "h-12 flex-1 rounded-[14px] text-[14px] font-bold transition-colors",
                type === "offer" ? "border-2 text-white" : "border bg-white/60 text-[color:var(--eb-ink)]"
              )}
              style={
                type === "offer"
                  ? { background: "var(--eb-green)", borderColor: "var(--eb-green)" }
                  : { borderColor: "var(--eb-line)" }
              }
            >
              できます
            </button>
            <button
              onClick={() => setType("request")}
              className={clsx(
                "h-12 flex-1 rounded-[14px] text-[14px] font-bold transition-colors",
                type === "request" ? "border-2 text-white" : "border bg-white/60 text-[color:var(--eb-ink)]"
              )}
              style={
                type === "request"
                  ? { background: "var(--eb-gold)", borderColor: "var(--eb-gold)", color: "var(--eb-ink)" }
                  : { borderColor: "var(--eb-line)" }
              }
            >
              探してます
            </button>
          </div>
        </GlassCard>

        {/* 本文入力 */}
        <GlassCard>
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
            style={{ fontSize: "16px" }}
            className="h-40 w-full resize-none rounded-2xl border border-[color:var(--eb-line)] bg-white px-4 py-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)] focus:outline-none focus:border-2 focus:border-[color:var(--eb-green)]"
          />
          <p className="mt-1 text-right text-[12px] text-[color:var(--eb-ink-muted)]">
            {content.length}/500
          </p>
        </GlassCard>

        {/* タグ */}
        <GlassCard>
          <p className="mb-2 text-[13px] font-bold text-[color:var(--eb-ink-muted)]">タグ（最大5個）</p>

          {tags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => removeTag(tag)}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-bold"
                  style={{ background: "rgba(35,147,94,.14)", color: "var(--eb-green-text)" }}
                >
                  #{tag}
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
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
                className={clsx("flex-1", inputClass)}
              />
              <Button
                type="button"
                variant="ghost"
                fullWidth={false}
                className="w-20"
                disabled={!tagInput.trim()}
                onClick={addTag}
              >
                追加
              </Button>
            </div>
          )}
        </GlassCard>

        {/* エラー表示 */}
        {error && (
          <GlassCard tone="coral" padding="md">
            <p className="text-[13px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>
          </GlassCard>
        )}

        <Button
          type="button"
          variant="primary"
          loading={submitting}
          disabled={!content.trim()}
          onClick={handleSubmit}
        >
          投稿する
        </Button>
      </div>
    </PageBg>
  );
}
