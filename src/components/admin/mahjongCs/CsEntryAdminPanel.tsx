"use client";

import { useEffect, useRef, useState } from "react";
import DateTimePicker from "@/components/ui/DateTimePicker";
import { rebalanceEntries } from "@/lib/mahjongCsEntry";
import { isProduction } from "@/lib/env";
import { jstDateFromIso } from "@/lib/date";
import type { MahjongCsEvent } from "@/types/mahjong";
import { clampCapacity, csButton, csPrimary, jstInput } from "./CsCreateForm";
import CsParticipantList, { displayDate } from "./CsParticipantList";

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
  const [editing, setEditing] = useState(false);
  const [capacityInput, setCapacityInput] = useState(String(event.capacity ?? 40));
  const capacity = clampCapacity(capacityInput);
  const capacityMissing = capacityInput.trim() === "";
  const [opens, setOpens] = useState(() => jstInput(event.entryOpensAt ?? new Date()));
  const [closes, setCloses] = useState(() => jstInput(event.entryClosesAt ?? new Date()));
  const [confirmClose, setConfirmClose] = useState(false);
  const notifiedDeadline = useRef<string | null>(null);
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
  useEffect(() => {
    const deadline = `${event.csEventId}:${event.entryClosesAt}`;
    if (remaining === 0 && notifiedDeadline.current !== deadline) {
      notifiedDeadline.current = deadline;
      onChanged();
    }
  }, [remaining, event.csEventId, event.entryClosesAt, onChanged]);
  const preview = rebalanceEntries(entries, {
    capacity,
    priorityUserIds: event.priorityUserIds ?? [],
    phase: "entry",
  });
  const additionalWaiting = Math.max(
    0,
    preview.filter((entry) => entry.state === "waitlisted").length - waiting.length,
  );
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
        if (res.status === 404 || res.status === 409) onChanged();
      } else {
        onError(null);
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
            onError(null);
            setCapacityInput(String(event.capacity ?? 40));
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
            onError(null);
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
              value={capacityInput}
              onChange={(e) => setCapacityInput(e.target.value)}
              onBlur={() => {
                if (!capacityMissing) setCapacityInput(String(capacity));
              }}
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
          {capacityMissing && <p className="text-xs text-red-600">定員を入力してください</p>}
          {additionalWaiting > 0 && (
            <p
              role="alert"
              className="rounded-lg bg-orange-50 p-3 text-xs text-orange-800"
            >
              {`定員を減らすと、参加確定のM3の人が${additionalWaiting}名` +
                "キャンセル待ちに戻ります（通知は届きません）"}
            </p>
          )}
          <div className="flex gap-2">
            <button
              className={csPrimary}
              disabled={capacityMissing}
              onClick={() => {
                if (capacityMissing) return;
                onError(null);
                if (event.eventDate < jstDateFromIso(`${closes}+09:00`)) {
                  onError("開催日は参加受付の締切日以降にしてください");
                  return;
                }
                void patch({
                  action: "updateEntry",
                  capacity,
                  entryOpensAt: `${opens}:00+09:00`,
                  entryClosesAt: `${closes}:00+09:00`,
                });
              }}
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
      <CsParticipantList event={event} onChanged={onChanged} onError={onError} disabled={busy} />
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
