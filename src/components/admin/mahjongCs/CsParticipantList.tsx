"use client";

import { useState } from "react";
import { waitlistPosition } from "@/lib/mahjongCsEntry";
import type { MahjongCsEntry, MahjongCsEvent } from "@/types/mahjong";
import { csButton, csPrimary } from "./CsCreateForm";

const filters = ["すべて", "優先枠", "M3", "キャンセル待ち"] as const;
const tierStyles = {
  M1: "bg-yellow-100 text-yellow-700",
  M2: "bg-sky-100 text-sky-700",
  M3: "bg-orange-50 text-orange-600",
};
// 受付日時を日本時間の表示用文字列に整える。
export const displayDate = (value: string) =>
  new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// 受付中・締切後に共通の参加者一覧と取り消し確認を表示する。
export default function CsParticipantList({ event, onChanged, onError, disabled = false }: {
  event: MahjongCsEvent;
  onChanged: () => void;
  onError: (message: string | null) => void;
  disabled?: boolean;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("すべて");
  const [removeEntry, setRemoveEntry] = useState<MahjongCsEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  const busy = disabled || removing;
  const entries = [...(event.entries ?? [])].sort(
    (a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt) || a.lineUserId.localeCompare(b.lineUserId),
  );
  const priority = new Set(event.priorityUserIds ?? []);

  async function remove() {
    if (!removeEntry) return;
    setRemoving(true);
    onError(null);
    try {
      const res = await fetch(`/api/admin/mahjong/cs/${event.csEventId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "removeEntry", lineUserId: removeEntry.lineUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "更新に失敗しました");
        if (res.status === 404 || res.status === 409) onChanged();
      } else {
        onChanged();
      }
    } catch {
      onError("更新に失敗しました");
    } finally {
      setRemoving(false);
      setRemoveEntry(null);
    }
  }

  return (
    <section className="space-y-4 min-w-0 text-[#231714]">
      {removeEntry && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
          <p className="text-xs">{removeEntry.displayName}さんを参加者から外しますか？</p>
          <div className="flex gap-2">
            <button
              disabled={busy}
              className={csPrimary}
              onClick={remove}
            >
              外す
            </button>
            <button
              disabled={busy}
              className={csButton}
              onClick={() => setRemoveEntry(null)}
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
      <h3 className="text-sm font-bold">参加表明者一覧</h3>
      <div className="flex flex-wrap gap-2">
        {filters.map((value) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`${csButton} ${filter === value ? "bg-[#B0E401]/20" : "bg-white"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto max-w-full bg-white rounded-xl border border-[#231714]/10">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-[#231714]/10">
              {["名前", "リーグ", "状態", "表明日時（日本時間）", "操作"].map((label) => (
                <th
                  key={label}
                  className="text-left p-3"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries
              .filter(
                (e) =>
                  filter === "すべて" ||
                  (filter === "優先枠"
                    ? priority.has(e.lineUserId)
                    : filter === "M3"
                      ? !priority.has(e.lineUserId)
                      : e.state === "waitlisted"),
              )
              .map((entry) => (
                <tr
                  key={entry.lineUserId}
                  className="border-b border-[#231714]/5"
                >
                  <td className="p-3">{entry.displayName}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-1 font-bold ${tierStyles[entry.tier]}`}>
                      {entry.tier}
                    </span>
                  </td>
                  <td className="p-3">
                    {entry.state === "confirmed"
                      ? "参加確定"
                      : `キャンセル待ち${waitlistPosition(event.entries ?? [], entry.lineUserId)}番目`}
                  </td>
                  <td className="p-3">{displayDate(entry.enteredAt)}</td>
                  <td className="p-3">
                    <button
                      disabled={busy}
                      className={csButton}
                      aria-label={`${entry.displayName}さんを外す`}
                      onClick={() => setRemoveEntry(entry)}
                    >
                      外す
                    </button>
                  </td>
                </tr>
              ))}
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="p-4 text-center"
                >
                  参加表明者はまだいません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
