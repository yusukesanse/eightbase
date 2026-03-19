"use client";

import { useState, useEffect } from "react";
import { TopBar } from "@/components/ui/TopBar";
import { getLineUserId } from "@/lib/liff";
import type { Quest, UserQuestProgress } from "@/types";

interface QuestWithProgress extends Quest {
  progress?: UserQuestProgress;
}

export default function QuestsPage() {
  const [quests, setQuests] = useState<QuestWithProgress[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getLineUserId()
      .then((id) =>
        fetch("/api/quests", { headers: { "x-line-user-id": id } })
      )
      .then((r) => r.json())
      .then((d) => {
        setQuests(d.quests ?? []);
        setPoints(d.totalPoints ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

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
                  <QuestCard key={q.questId} quest={q} />
                ))}
              </>
            )}
            {completed.length > 0 && (
              <>
                <p className="text-xs font-medium text-gray-400 pt-1">達成済み</p>
                {completed.map((q) => (
                  <QuestCard key={q.questId} quest={q} completed />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QuestCard({
  quest: q,
  completed = false,
}: {
  quest: QuestWithProgress;
  completed?: boolean;
}) {
  const current = q.progress?.currentCount ?? 0;
  const pct = Math.min(100, Math.round((current / q.requiredCount) * 100));

  return (
    <div className={`bg-white rounded-xl border border-gray-100 p-3 flex gap-3 ${completed ? "opacity-60" : ""}`}>
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
  );
}
