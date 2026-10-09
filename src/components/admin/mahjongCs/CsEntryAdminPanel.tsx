"use client";

import { useEffect, useState } from "react";
import DateTimePicker from "@/components/ui/DateTimePicker";
import { isProduction } from "@/lib/env";
import type { MahjongCsEvent } from "@/types/mahjong";
import { csButton, csPrimary, jstInput } from "./CsCreateForm";

const filters = ["すべて", "優先枠", "M3", "キャンセル待ち"] as const;
const tierStyles = {
  M1: "bg-yellow-100 text-yellow-700",
  M2: "bg-sky-100 text-sky-700",
  M3: "bg-orange-50 text-orange-600",
};
// 受付日時を日本時間の表示用文字列に整える。
const displayDate = (value: string) =>
  new Date(value).toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

// CSの参加受付状況と参加者を管理する。
export default function CsEntryAdminPanel({
  event,
  onChanged,
  onError,
}: {
  event: MahjongCsEvent & { csEventId: string };
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [filter, setFilter] = useState<(typeof filters)[number]>("すべて");
  const [editing, setEditing] = useState(false);
  const [capacity, setCapacity] = useState(event.capacity ?? 40);
  const [opens, setOpens] = useState(() => jstInput(event.entryOpensAt ?? new Date()));
  const [closes, setCloses] = useState(() => jstInput(event.entryClosesAt ?? new Date()));
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const entries = [...(event.entries ?? [])].sort(
    (a, b) =>
      Date.parse(a.enteredAt) - Date.parse(b.enteredAt) || a.lineUserId.localeCompare(b.lineUserId),
  );
  const confirmed = entries.filter((e) => e.state === "confirmed").length;
  const waiting = entries.filter((e) => e.state === "waitlisted");
  const priority = new Set(event.priorityUserIds ?? []);
  const remaining = Math.max(0, Math.ceil((Date.parse(event.entryClosesAt ?? "") - now) / 60000));
  const remainingText =
    remaining > 0
      ? `${Math.floor(remaining / 1440)}日 ${Math.floor((remaining % 1440) / 60)}時間 ${remaining % 60}分`
      : "締切を迎えました";

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/admin/mahjong/cs/${event.csEventId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        onError(data.error ?? "更新に失敗しました");
        if (res.status === 409) onChanged();
      } else {
        setEditing(false);
        setConfirmClose(false);
        onChanged();
      }
    } catch {
      onError("更新に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 min-w-0 text-[#231714]">
      <h2 className="text-sm font-bold">参加受付中</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {[
          ["締切まで", remainingText],
          ["参加確定", `${confirmed}/${event.capacity}名`],
          [
            "優先枠 表明済み",
            `${entries.filter((e) => priority.has(e.lineUserId)).length}/${priority.size}名`,
          ],
          ["キャンセル待ち", `${waiting.length}名`],
        ].map(([label, value]) => (
          <div
            key={label}
            className="bg-white rounded-xl border border-[#231714]/10 p-4"
          >
            <p className="text-xs">{label}</p>
            <p className="mt-1 text-sm font-bold">{value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs break-words">
        受付：{event.entryOpensAt && displayDate(event.entryOpensAt)} ～{" "}
        {event.entryClosesAt && displayDate(event.entryClosesAt)}（日本時間）
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          className={csButton}
          onClick={() => {
            setCapacity(event.capacity ?? 40);
            setOpens(jstInput(event.entryOpensAt ?? new Date()));
            setCloses(jstInput(event.entryClosesAt ?? new Date()));
            setEditing(true);
            setConfirmClose(false);
          }}
        >
          期間・定員を変更
        </button>
        <button
          disabled={busy}
          className={csPrimary}
          onClick={() => {
            setConfirmClose(true);
            setEditing(false);
          }}
        >
          今すぐ締め切る
        </button>
      </div>
      {editing && (
        <fieldset
          disabled={busy}
          className="bg-white rounded-xl border border-[#231714]/10 p-4 space-y-3 min-w-0 max-w-lg"
        >
          <label className="block text-xs">
            定員
            <input
              type="number"
              min={4}
              max={200}
              step={1}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value))}
              className="block mt-1 w-24 border border-[#231714]/10 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <div>
            <p className="text-xs mb-1">受付開始（日本時間）</p>
            <DateTimePicker
              value={opens}
              onChange={setOpens}
              className="max-sm:flex-col"
            />
          </div>
          <div>
            <p className="text-xs mb-1">締切（日本時間）</p>
            <DateTimePicker
              value={closes}
              onChange={setCloses}
              className="max-sm:flex-col"
            />
          </div>
          {capacity < confirmed && (
            <p
              role="alert"
              className="rounded-lg bg-orange-50 p-3 text-xs text-orange-800"
            >
              {"定員を減らすと、参加確定のM3の人が" +
                "キャンセル待ちに戻ることがあります（通知は届きません）"}
            </p>
          )}
          <div className="flex gap-2">
            <button
              className={csPrimary}
              onClick={() =>
                patch({
                  action: "updateEntry",
                  capacity,
                  entryOpensAt: `${opens}:00+09:00`,
                  entryClosesAt: `${closes}:00+09:00`,
                })
              }
            >
              保存
            </button>
            <button
              className={csButton}
              onClick={() => setEditing(false)}
            >
              キャンセル
            </button>
          </div>
        </fieldset>
      )}
      {confirmClose && (
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
          <p className="text-xs">今すぐ参加受付を締め切り、参加者を確定しますか？</p>
          <div className="flex gap-2">
            <button
              disabled={busy}
              className={csPrimary}
              onClick={() => patch({ action: "closeNow" })}
            >
              締め切る
            </button>
            <button
              disabled={busy}
              className={csButton}
              onClick={() => setConfirmClose(false)}
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
                      ? e.tier === "M3"
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
                      : `キャンセル待ち${waiting.findIndex((e) => e.lineUserId === entry.lineUserId) + 1}番目`}
                  </td>
                  <td className="p-3">{displayDate(entry.enteredAt)}</td>
                  <td className="p-3">
                    <button
                      disabled={busy}
                      className={csButton}
                      onClick={() => patch({ action: "removeEntry", lineUserId: entry.lineUserId })}
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
      {!isProduction() && (
        <div className="space-y-2">
          <button
            disabled={busy}
            className={csButton}
            onClick={() => patch({ action: "fillDummies" })}
          >
            ダミーで定員まで埋める（検証用）
          </button>
          <p className="text-xs text-[#231714]/80">
            {"優先枠の人が未表明の間は、一部がキャンセル待ちになります" +
              "（締切で繰り上がります）"}
          </p>
        </div>
      )}
      <div className="rounded-xl border border-dashed border-[#231714]/20 bg-gray-50 p-6 text-center text-xs">
        トーナメント編成は参加受付の締切後に組めます
      </div>
    </section>
  );
}
