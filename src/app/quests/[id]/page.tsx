"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { RichText } from "@/components/ui/RichText";
import type { Quest, UserQuestProgress } from "@/types";

/* ─── localStorage ─── */
const GOOD_KEY = "quest_goods";
function getGoodSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(GOOD_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveGoodSet(s: Set<string>) { localStorage.setItem(GOOD_KEY, JSON.stringify(Array.from(s))); }

interface QuestDetail extends Quest { goodCount: number; progress?: UserQuestProgress }

export default function QuestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/quests");
        const d = await res.json();
        const found = (d.quests ?? []).find((q: QuestDetail) => q.questId === id);
        if (found) {
          setQuest(found);
          setLiked(getGoodSet().has(found.questId));
        }
      } finally { setLoading(false); }
    })();
  }, [id]);

  const handleToggleGood = useCallback(async () => {
    if (!quest) return;
    const goodSet = getGoodSet();
    const wasLiked = goodSet.has(quest.questId);
    const action = wasLiked ? "remove" : "add";

    setLiked(!wasLiked);
    setQuest(prev => prev ? { ...prev, goodCount: wasLiked ? Math.max(0, prev.goodCount - 1) : prev.goodCount + 1 } : prev);
    if (wasLiked) goodSet.delete(quest.questId); else goodSet.add(quest.questId);
    saveGoodSet(goodSet);

    try {
      const res = await fetch(`/api/quests/${quest.questId}/good`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setQuest(prev => prev ? { ...prev, goodCount: data.goodCount } : prev);
      }
    } catch {
      if (wasLiked) goodSet.add(quest.questId); else goodSet.delete(quest.questId);
      saveGoodSet(goodSet);
      setLiked(wasLiked);
    }
  }, [quest]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gray-200 border-t-[#A5C1C8] rounded-full animate-spin" />
      </div>
    );
  }

  if (!quest) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-3">
        <p className="text-gray-400 text-sm">クエストが見つかりません</p>
        <button onClick={() => router.back()} className="text-sm text-[#A5C1C8]">戻る</button>
      </div>
    );
  }

  const current = quest.progress?.currentCount ?? 0;
  const pct = Math.min(100, Math.round((current / quest.requiredCount) * 100));
  const isCompleted = quest.progress?.completed ?? false;

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* ヘッダー画像 / カラーヒーロー */}
      <div className="relative">
        {quest.imageUrl ? (
          <div className="aspect-[16/9] w-full overflow-hidden bg-gray-100">
            <img src={quest.imageUrl} alt={quest.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="aspect-[16/9] w-full bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF] flex items-center justify-center">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" opacity="0.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
        )}

        <button
          onClick={() => router.back()}
          className="absolute top-3 left-3 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>

      {/* コンテンツ */}
      <div className="relative -mt-5 bg-white rounded-t-2xl px-5 pt-6 pb-24">
        {/* カテゴリバッジ */}
        <span className="inline-block text-[11px] px-3 py-1 rounded-full font-medium bg-[#A5C1C8]/15 text-[#231714]">
          {quest.category}
        </span>

        <h1 className="text-xl font-bold text-[#231714] mt-3 leading-tight">
          {quest.title}
        </h1>

        {/* 進捗カード */}
        <div className={`mt-4 rounded-2xl p-4 ${isCompleted ? "bg-[#B0E401]/10 border border-[#B0E401]/20" : "bg-[#A5C1C8]/10 border border-[#A5C1C8]/20"}`}>
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-bold ${isCompleted ? "text-[#7BA801]" : "text-[#231714]"}`}>
              {isCompleted ? "達成済み!" : "進行中"}
            </span>
            <span className={`text-xs font-medium ${isCompleted ? "text-[#7BA801]" : "text-[#231714]/70"}`}>
              {current} / {quest.requiredCount}
            </span>
          </div>
          <div className="h-2.5 bg-white rounded-full overflow-hidden">
            <div
              className={`h-2.5 rounded-full transition-all ${isCompleted ? "bg-[#B0E401]" : "bg-[#A5C1C8]"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* 区切り */}
        <hr className="my-5 border-gray-100" />

        {/* 説明文 */}
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">詳細</h2>
        <RichText
          text={quest.description}
          className="text-sm text-gray-700 leading-relaxed"
        />

        {/* グッドボタン */}
        <div className="mt-8 flex items-center gap-3">
          <button
            onClick={handleToggleGood}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
              liked
                ? "bg-[#B0E401]/10 text-[#231714] border border-[#B0E401]/30"
                : "bg-gray-50 text-gray-500 border border-gray-200"
            }`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill={liked ? "#B0E401" : "none"} stroke={liked ? "#B0E401" : "currentColor"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
            </svg>
            いいね {quest.goodCount}
          </button>
        </div>
      </div>
    </div>
  );
}
