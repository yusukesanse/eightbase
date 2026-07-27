"use client";

import { useState } from "react";

/**
 * 当日GMの自己選出バナー（ダーツ / ビリヤード）。
 * GMは**シーズン固定ではなく開催日ごとに決める**ので、当日タブの先頭で
 * 「まだ誰もGMをやっていない」ことと「GMをやる」導線を必ず見せる。
 * 担当が帰ってしまうと進行が詰むため**交代も可**（確認ダイアログを挟む）。
 * サーバー側の資格判定（支払い済み参加者のみ）は POST /api/{game}/day/gm が行う。
 */
export function DayGmBanner({
  game,
  eventDate,
  isGameMaster,
  gameMasterName,
  finished,
  onChanged,
}: {
  game: "darts" | "billiards";
  eventDate: string;
  isGameMaster: boolean;
  gameMasterName: string | null;
  finished: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (finished) return null;

  const claim = async (takeover: boolean) => {
    if (takeover && !confirm(`現在のゲームマスターは${gameMasterName}さんです。あなたが交代しますか？`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/${game}/day/gm`, {
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

  if (isGameMaster) {
    return (
      <div className="rounded-2xl bg-[#eef4dd] px-4 py-2.5 text-[12.5px] font-bold text-[#5f7d1e]">
        あなたが本日のゲームマスターです。下の進行パネルから操作してください。
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-extrabold text-[#231714]">
            {gameMasterName ? `本日のゲームマスター: ${gameMasterName}さん` : "本日のゲームマスターが未定です"}
          </div>
          <div className="text-[11px] text-[#3c4f54] mt-0.5">
            {gameMasterName
              ? "進行担当が不在の場合は交代できます。"
              : "誰かがゲームマスターになると受付を締め切って開始できます。"}
          </div>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => claim(!!gameMasterName)}
          className="shrink-0 rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
          style={{ background: "#2f7d57" }}
        >
          {busy ? "設定中…" : gameMasterName ? "交代する" : "GMをやる"}
        </button>
      </div>
      {error && <p className="text-[11.5px] font-bold text-[#d8533a]">{error}</p>}
    </div>
  );
}
