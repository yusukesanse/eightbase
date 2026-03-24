"use client";

import { useState, useEffect, useCallback } from "react";
import { TopBar } from "@/components/ui/TopBar";
import { getLineUserId } from "@/lib/liff";
import type { Quest, UserQuestProgress } from "@/types";

interface QuestWithProgress extends Quest {
  progress?: UserQuestProgress;
  goodCount: number;
  liked: boolean;
}

export default function QuestsPage() {
  const [quests, setQuests] = useState<QuestWithProgress[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const id = await getLineUserId();
        setUserId(id);
        const res = await fetch("/api/quests", {
          headers: { "x-line-user-id": id },
        });
        const d = await res.json();
        setQuests(d.quests ?? []);
        setPoints(d.totalPoints ?? 0);
      } catch {
        // 未ログイン
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggleGood = useCallback(
    async (questId: string) => {
      if (!userId) return;

      // 楽観的UI更新
      setQuests((prev) =>
        prev.map((q) =>
          q.questId === questId
            ? {
                ...q,
                liked: !q.liked,
                goodCount: q.liked ? q.goodCount - 1 : q.goodCount + 1,
              }
            : q
        )
      );

      try {
        const res = await fetch(`/api/quests/${questId}/good`, {
          method: "POST",
          headers: { "x-line-user-id": userId },
        });
        if (!res.ok) throw new Error();
      } catch {
        // 失敗時はロールバック
        setQuests((prev) =>
          prev.map((q) =>
            q.questId === questId
              ? {
                  ...q,
                  liked: !q.liked,
                  goodCount: q.liked ? q.goodCount - 1 : q.goodCount + 1,
                }
              : q
          )
        );
      }
    },
    [userId]
  );

  const active    = quests.filter((q) => !q.progress?.completed);
  const completed = quests.filter((q) => q.progress?.completed);

  return (
    <div>
      <TopBar title="クエスト情報" subtitle="ミッションをクリアしてポイントを獲得" color="bg-[#BA7517]" />

      <div className="p-3 space-y-3">
        {/* ポイントバッジ */}
        <div className="bg-white rounded-xl border border-gray-100 p-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center flex-shrink-0">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2l1.8 5h5.2l-4.2 3.1 1.6 5L10 12l-4.4 3.1 1.6-5L3 7h5.2L10 2z" fill="#EF9F27"/>
            </svg>
          </div>
          <div>
            <p className="text-[10px] text-gray-400">現在のポイント</p>
            <p className="text-xl font-medium text-amber-700">{points.toLocaleString()} pt</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-sm text-gray-400">読み込み中...</div>
        ) : (
          <>
            {active.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-400">進行中のクエスト</p>
                {active.map((q) => (
                  <QuestCard
                    key={q.questId}
                    quest={q}
                    onToggleGood={handleToggleGood}
                    canGood={!!userId}
                  />
                ))}
              </>
            )}
            {completed.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-400 pt-1">達成済み</p>
                {completed.map((q) => (
                  <QuestCard
                    key={q.questId}
                    quest={q}
                    completed
                    onToggleGood={handleToggleGood}
                    canGood={!!userId}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ───────── グッドアイコン表示 ───────── */

function GoodIcon({ filled, size = 14 }: { filled?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "#BA7517" : "none"}
      stroke={filled ? "#BA7517" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 10v12" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
  );
}

function GoodDisplay({ count }: { count: number }) {
  if (count === 0) return null;

  const displayCount = Math.min(count, 10);
  const overflow = count > 10 ? count - 10 : 0;

  return (
    <div className="flex items-center gap-0.5 mt-1.5">
      <div className="flex -space-x-1">
        {Array.from({ length: displayCount }).map((_, i) => (
          <span key={i} className="inline-block">
            <GoodIcon filled size={12} />
          </span>
        ))}
      </div>
      {overflow > 0 && (
        <span className="text-[10px] font-medium text-amber-700 ml-1">
          +{overflow}
        </span>
      )}
    </div>
  );
}

/* ───────── クエストカード ───────── */

function QuestCard({
  quest: q,
  completed = false,
  onToggleGood,
  canGood,
}: {
  quest: QuestWithProgress;
  completed?: boolean;
  onToggleGood: (questId: string) => void;
  canGood: boolean;
}) {
  const current = q.progress?.currentCount ?? 0;
  const pct = Math.min(100, Math.round((current / q.requiredCount) * 100));

  return (
    <div className={`bg-white rounded-xl border border-gray-100 p-3 ${completed ? "opacity-60" : ""}`}>
      <div className="flex gap-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${completed ? "bg-green-50" : "bg-amber-50"}`}>
          {completed ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M4 9l3.5 3.5L14 6" stroke="#3B6D11" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="3" y="3" width="12" height="12" rx="2" stroke="#854F0B" strokeWidth="1.3"/>
              <path d="M6 9h6M9 6v6" stroke="#854F0B" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{q.title}</p>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-snug">{q.description}</p>
          <div className="mt-2 h-1.5 bg-gray-100 rounded-full">
            <div
              className={`h-1.5 rounded-full transition-all ${completed ? "bg-green-400" : "bg-amber-400"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className={`text-[10px] mt-1 ${completed ? "text-green-600" : "text-amber-700"}`}>
            {completed
              ? `達成済み +${q.rewardPoints}pt`
              : `${current}/${q.requiredCount} 達成 — 完了で +${q.rewardPoints}pt`}
          </p>
        </div>
      </div>

      {/* グッドボタン + 表示 */}
      <div className="mt-2 pl-12">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onToggleGood(q.questId)}
            disabled={!canGood}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
              q.liked
                ? "bg-amber-50 text-amber-700 border border-amber-200"
                : "bg-gray-50 text-gray-400 border border-gray-100 hover:bg-gray-100"
            } ${!canGood ? "opacity-50 cursor-default" : ""}`}
          >
            <GoodIcon filled={q.liked} size={14} />
            <span>{q.goodCount}</span>
          </button>
        </div>
        <GoodDisplay count={q.goodCount} />
      </div>
    </div>
  );
}
