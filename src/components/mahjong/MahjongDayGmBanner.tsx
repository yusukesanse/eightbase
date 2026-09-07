"use client";

import { useState } from "react";
import { Button, GlassCard } from "@/components/ui/eb";

interface MahjongDayGmBannerProps {
  eventDate: string;
  dayGm: {
    eligible: boolean;
    needsClaim: boolean;
    implicit: boolean;
    gmDisplayName: string | null;
    isMe: boolean;
    candidates: string[];
  };
  finished: boolean;
  onChanged: () => void;
}

/** 麻雀の資格者向け当日GM選出・交代バナー。 */
export function MahjongDayGmBanner({
  eventDate,
  dayGm,
  finished,
  onChanged,
}: MahjongDayGmBannerProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!dayGm.eligible || finished) return null;

  const claim = async (takeover: boolean) => {
    if (
      takeover &&
      !confirm(`現在のゲームマスターは${dayGm.gmDisplayName}さんです。あなたが交代しますか？`)
    ) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mahjong/day/gm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "ゲームマスターの登録に失敗しました");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ゲームマスターの登録に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (dayGm.isMe || dayGm.implicit) {
    return (
      <GlassCard tone="green" padding="md">
        <p className="text-[13px] font-bold text-[color:var(--eb-green-text)]">
          あなたが本日のゲームマスターです。下の進行パネルから操作してください。
          {dayGm.implicit ? "（参加しているGMはあなただけです）" : ""}
        </p>
      </GlassCard>
    );
  }

  if (dayGm.gmDisplayName) {
    return (
      <GlassCard padding="md">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 truncate text-[13px] font-extrabold text-[color:var(--eb-ink)]">
            本日のゲームマスター: {dayGm.gmDisplayName}さん
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => claim(true)}
            className="shrink-0 whitespace-nowrap rounded-xl bg-white/60 px-3.5 py-2 text-[13px] font-bold text-[color:var(--eb-ink)] disabled:opacity-50"
          >
            {busy ? "設定中…" : "交代する"}
          </button>
        </div>
        {error && <p className="mt-2 text-[13px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}
      </GlassCard>
    );
  }

  if (dayGm.needsClaim) {
    return (
      <GlassCard padding="md" className="bg-[rgba(217,169,58,.18)]">
        <div className="flex flex-col gap-3">
          <div className="min-w-0 text-[13px] font-extrabold text-[color:var(--eb-ink)]">
            参加しているゲームマスターが{dayGm.candidates.length}名います（{dayGm.candidates.join("、")}）。本日の担当を決めてください。
          </div>
          <Button variant="primary" disabled={busy} onClick={() => claim(false)}>
            {busy ? "設定中…" : "GMをやる（本日の進行を担当する）"}
          </Button>
        </div>
        {error && <p className="mt-2 text-[13px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}
      </GlassCard>
    );
  }

  return null;
}
