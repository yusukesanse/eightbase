"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import type { Quest, UserQuestProgress } from "@/types";
import clsx from "clsx";

/* ─── localStorage ─── */
const GOOD_KEY = "quest_goods";
function getGoodSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(GOOD_KEY) ?? "[]")); } catch { return new Set(); }
}
function saveGoodSet(s: Set<string>) { localStorage.setItem(GOOD_KEY, JSON.stringify(Array.from(s))); }

interface QuestWithProgress extends Quest { progress?: UserQuestProgress; goodCount: number; liked: boolean }

export default function QuestsPage() {
  const router = useRouter();
  const [quests, setQuests] = useState<QuestWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/quests");
        const d = await res.json();
        const goodSet = getGoodSet();
        const list: QuestWithProgress[] = (d.quests ?? []).map(
          (q: Quest & { goodCount?: number; progress?: UserQuestProgress }) => ({
            ...q, goodCount: q.goodCount ?? 0, liked: goodSet.has(q.questId),
          })
        );
        setQuests(list);
      } catch { /* */ } finally { setLoading(false); }
    })();
  }, []);

  const handleToggleGood = useCallback(async (e: React.MouseEvent, questId: string) => {
    e.stopPropagation();
    const goodSet = getGoodSet();
    const wasLiked = goodSet.has(questId);
    const action = wasLiked ? "remove" : "add";

    setQuests(prev => prev.map(q =>
      q.questId === questId
        ? { ...q, liked: !wasLiked, goodCount: wasLiked ? Math.max(0, q.goodCount - 1) : q.goodCount + 1 }
        : q
    ));
    if (wasLiked) goodSet.delete(questId); else goodSet.add(questId);
    saveGoodSet(goodSet);

    try {
      const res = await fetch(`/api/quests/${questId}/good`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setQuests(prev => prev.map(q => q.questId === questId ? { ...q, goodCount: data.goodCount } : q));
      }
    } catch {
      if (wasLiked) goodSet.add(questId); else goodSet.delete(questId);
      saveGoodSet(goodSet);
      setQuests(prev => prev.map(q =>
        q.questId === questId
          ? { ...q, liked: wasLiked, goodCount: wasLiked ? q.goodCount + 1 : Math.max(0, q.goodCount - 1) }
          : q
      ));
    }
  }, []);

  const active    = quests.filter(q => !q.progress?.completed);
  const completed = quests.filter(q => q.progress?.completed);

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      <TopBar title="クエスト" subtitle="ミッションをクリアしよう" />

      <div className="p-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-gray-200 border-t-[#A5C1C8] rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-5">
            {active.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">進行中</p>
                <div className="space-y-3">
                  {active.map(q => (
                    <QuestCard key={q.questId} quest={q} onToggleGood={handleToggleGood} onClick={() => router.push(`/quests/${q.questId}`)} />
                  ))}
                </div>
              </div>
            )}
            {completed.length > 0 && (
              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">達成済み</p>
                <div className="space-y-3">
                  {completed.map(q => (
                    <QuestCard key={q.questId} quest={q} completed onToggleGood={handleToggleGood} onClick={() => router.push(`/quests/${q.questId}`)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── グッドアイコン横並び表示 ─── */
function GoodIcons({ count, liked, color }: { count: number; liked: boolean; color: string }) {
  const display = Math.min(count, 10);
  const overflow = count > 10 ? count - 10 : 0;
  const fillColor = liked ? color : "none";
  const strokeColor = liked ? color : "#9CA3AF";

  if (count === 0) {
    return (
      <span className="flex items-center gap-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </svg>
      </span>
    );
  }

  return (
    <span className="flex items-center">
      {Array.from({ length: display }).map((_, i) => (
        <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={fillColor} stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: i === 0 ? 0 : -3 }}>
          <path d="M7 10v12" /><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
        </svg>
      ))}
      {overflow > 0 && (
        <span className="text-[10px] font-bold ml-0.5" style={{ color: liked ? color : "#9CA3AF" }}>+{overflow}</span>
      )}
    </span>
  );
}

/* ─── クエストカード ─── */
function QuestCard({ quest: q, completed = false, onToggleGood, onClick }: {
  quest: QuestWithProgress;
  completed?: boolean;
  onToggleGood: (e: React.MouseEvent, id: string) => void;
  onClick: () => void;
}) {
  const current = q.progress?.currentCount ?? 0;
  const pct = Math.min(100, Math.round((current / q.requiredCount) * 100));

  return (
    <div
      onClick={onClick}
      className={clsx(
        "bg-white rounded-xl overflow-hidden shadow-sm border border-gray-100 active:scale-[0.98] transition-transform cursor-pointer",
        completed && "opacity-60"
      )}
    >
      <div className="flex">
        {/* サムネイル */}
        {q.imageUrl ? (
          <div className="w-24 flex-shrink-0 overflow-hidden bg-gray-100">
            <img src={q.imageUrl} alt={q.title} className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className={`w-24 flex-shrink-0 flex items-center justify-center ${completed ? "bg-[#B0E401]/10" : "bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF]"}`}>
            {completed ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#7BA801" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4 12 14.01l-3-3" />
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 20 20" fill="none">
                <path d="M10 2l1.8 5h5.2l-4.2 3.1 1.6 5L10 12l-4.4 3.1 1.6-5L3 7h5.2L10 2z" fill="white" opacity="0.8"/>
              </svg>
            )}
          </div>
        )}

        <div className="flex-1 p-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-[#A5C1C8]/15 text-[#414141]">
              {q.category}
            </span>
          </div>
          <h3 className="text-sm font-bold text-[#414141] mt-1 leading-snug line-clamp-2">
            {q.title}
          </h3>

          {/* プログレスバー */}
          <div className="mt-2">
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-1.5 rounded-full transition-all ${completed ? "bg-[#B0E401]" : "bg-[#A5C1C8]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className={`text-[10px] font-medium ${completed ? "text-[#7BA801]" : "text-[#A5C1C8]"}`}>
                {current}/{q.requiredCount}
              </span>
              <button
                onClick={(e) => onToggleGood(e, q.questId)}
                className="flex items-center gap-0.5 flex-shrink-0"
              >
                <GoodIcons count={q.goodCount} liked={q.liked} color="#B0E401" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
