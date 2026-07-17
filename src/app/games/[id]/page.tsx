"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { GAME_CATEGORIES } from "@/types";
import type { Game } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  upcoming:         { label: "募集中",   color: "bg-blue-100 text-blue-700" },
  ongoing:          { label: "開催中",   color: "bg-green-100 text-green-700" },
  awaiting_results: { label: "結果待ち", color: "bg-amber-100 text-amber-700" },
  completed:        { label: "完了",     color: "bg-gray-100 text-gray-700" },
};

function getCategoryLabel(category: string, categoryLabel?: string): string {
  if (category === "other" && categoryLabel) return categoryLabel;
  return GAME_CATEGORIES.find((c) => c.id === category)?.label ?? category;
}

export default function GameDetailPage() {
  const router = useRouter();
  const params = useParams();
  const gameId = params.id as string;

  const [game, setGame] = useState<Game | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    // 一覧APIから探さず単体取得（limit に依存しない）
    fetch(`/api/games/${gameId}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Game | null) => {
        setGame(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [gameId]);

  // 参加状態チェック
  useEffect(() => {
    if (!gameId) return;
    fetch(`/api/games/${gameId}/join`, { method: "HEAD", credentials: "include" })
      .catch(() => {});
    // HEAD は未実装なので、参加申込時のエラーレスポンスで判定する
  }, [gameId]);

  async function handleJoin() {
    setJoining(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/join`, {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setJoined(true);
          setError("既に参加申込済みです");
        } else {
          setError(data.error || "参加に失敗しました");
        }
        return;
      }
      setJoined(true);
      setActionMsg("参加申込が完了しました！");
      // 参加者数を更新
      if (game) setGame({ ...game, participantCount: (game.participantCount ?? 0) + 1 });
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setJoining(false);
    }
  }

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch(`/api/games/${gameId}/join`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "キャンセルに失敗しました");
        return;
      }
      setJoined(false);
      setActionMsg("参加をキャンセルしました");
      if (game) setGame({ ...game, participantCount: Math.max(0, (game.participantCount ?? 0) - 1) });
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!game) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-6">
        <p className="text-sm text-[#231714]/80 mb-4">ゲームが見つかりません</p>
        <button onClick={() => router.back()} className="text-sm text-[#4f757e] hover:underline">戻る</button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[game.status] ?? STATUS_CONFIG.upcoming;
  const isFull = (game.participantCount ?? 0) >= game.maxParticipants;
  const isDeadlinePassed = new Date(game.deadline) < new Date();
  const canJoin = game.status === "upcoming" && !isFull && !isDeadlinePassed && !joined;
  const canCancel = joined && !isDeadlinePassed;

  return (
    <div className="min-h-screen bg-gray-50 pb-40">
      {/* ヘッダー画像 or グラデーション */}
      {game.imageUrl ? (
        <div className="relative h-48 overflow-hidden">
          <img src={game.imageUrl} alt="" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <button
            onClick={() => router.back()}
            className="absolute top-4 left-4 w-8 h-8 rounded-full bg-black/30 flex items-center justify-center"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        </div>
      ) : (
        <div className="relative h-36 bg-gradient-to-br from-[#A5C1C8] to-[#8BA8AF]">
          <button
            onClick={() => router.back()}
            className="absolute top-4 left-4 w-8 h-8 rounded-full bg-white/20 flex items-center justify-center"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="absolute bottom-4 left-4">
            <span className="text-white/70 text-xs">{getCategoryLabel(game.category, game.categoryLabel)}</span>
          </div>
        </div>
      )}

      {/* コンテンツ */}
      <div className="px-5 -mt-4 relative z-10">
        {/* タイトルカード */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3">
          <div className="flex items-center gap-2 mb-2">
            <span className={clsx("px-2 py-0.5 rounded-full text-[10px] font-bold", statusCfg.color)}>
              {statusCfg.label}
            </span>
            <span className="px-2 py-0.5 rounded bg-[#A5C1C8]/15 text-[10px] font-medium text-[#231714]/85">
              {getCategoryLabel(game.category, game.categoryLabel)}
            </span>
          </div>
          <h1 className="text-lg font-bold text-[#231714] leading-snug">{game.title}</h1>
        </div>

        {/* 通知 */}
        {actionMsg && (
          <div className="bg-[#B0E401]/15 border border-[#B0E401]/30 rounded-xl px-4 py-3 mb-3">
            <p className="text-xs text-[#231714]">{actionMsg}</p>
          </div>
        )}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-3">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* 詳細情報 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3 space-y-3">
          <InfoRow icon="📅" label="日時" value={
            game.endAt
              ? `${dayjs(game.startAt).format("M月D日(ddd) HH:mm")} 〜 ${dayjs(game.endAt).format("HH:mm")}`
              : dayjs(game.startAt).format("M月D日(ddd) HH:mm") + "〜"
          } />
          <InfoRow icon="📍" label="場所" value={game.location} />
          <InfoRow icon="👥" label="定員" value={`${game.participantCount ?? 0} / ${game.maxParticipants}名`} highlight={isFull} />
          <InfoRow icon="⏰" label="申込締切" value={dayjs(game.deadline).format("M月D日(ddd) HH:mm")} highlight={isDeadlinePassed} />
        </div>

        {/* 説明 */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-3">
          <p className="text-xs font-bold text-[#231714]/80 mb-2">詳細</p>
          <p className="text-sm text-[#231714]/90 whitespace-pre-wrap leading-relaxed">{game.description}</p>
        </div>
      </div>

      {/* フッター */}
      <div className="fixed left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-100 px-5 pt-3 pb-5 safe-area-pb z-20" style={{ bottom: "var(--bottom-nav-height)" }}>
        {canJoin ? (
          <button
            onClick={handleJoin}
            disabled={joining}
            className="w-full py-3.5 rounded-2xl text-sm font-bold bg-[#B0E401] text-[#231714] active:scale-[0.98] transition-all shadow-sm disabled:opacity-50"
          >
            {joining ? "処理中..." : "参加する"}
          </button>
        ) : joined ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2 py-2">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="8" fill="#B0E401"/>
                <path d="M4.5 8l2.5 2.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-sm font-medium text-[#231714]">参加申込済み</span>
            </div>
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-2.5 rounded-xl text-xs font-medium border border-red-200 text-red-500 disabled:opacity-50"
              >
                {cancelling ? "処理中..." : "参加をキャンセル"}
              </button>
            )}
          </div>
        ) : (
          <div className="text-center py-2">
            <p className="text-xs text-[#231714]/80">
              {isFull ? "定員に達しました" : isDeadlinePassed ? "申込締切を過ぎています" : "このゲームは現在募集していません"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── サブコンポーネント ─── */

function InfoRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-base">{icon}</span>
      <div className="flex-1">
        <p className="text-[10px] text-[#231714]/80">{label}</p>
        <p className={clsx("text-sm font-medium", highlight ? "text-red-500" : "text-[#231714]")}>{value}</p>
      </div>
    </div>
  );
}

