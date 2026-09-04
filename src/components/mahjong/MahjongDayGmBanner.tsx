"use client";

import { useState } from "react";

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
      <div className="rounded-2xl bg-[#eef4dd] px-4 py-2.5 text-[12.5px] font-bold text-[#5f7d1e]">
        あなたが本日のゲームマスターです。下の進行パネルから操作してください。
        {dayGm.implicit ? "（参加しているGMはあなただけです）" : ""}
      </div>
    );
  }

  if (dayGm.gmDisplayName) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-[13px] font-extrabold text-[#231714]">
            本日のゲームマスター: {dayGm.gmDisplayName}さん
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => claim(true)}
            className="shrink-0 rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
            style={{ background: "#2f7d57" }}
          >
            {busy ? "設定中…" : "交代する"}
          </button>
        </div>
        {error && <p className="text-[11.5px] font-bold text-[#d8533a]">{error}</p>}
      </div>
    );
  }

  if (dayGm.needsClaim) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 text-[13px] font-extrabold text-[#231714]">
            参加しているゲームマスターが{dayGm.candidates.length}名います（{dayGm.candidates.join("、")}）。本日の担当を決めてください。
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => claim(false)}
            className="shrink-0 rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
            style={{ background: "#2f7d57" }}
          >
            {busy ? "設定中…" : "GMをやる"}
          </button>
        </div>
        {error && <p className="text-[11.5px] font-bold text-[#d8533a]">{error}</p>}
      </div>
    );
  }

  return null;
}
