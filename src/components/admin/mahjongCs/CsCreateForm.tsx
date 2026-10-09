"use client";

import { useState } from "react";
import DatePicker from "@/components/ui/DatePicker";
import DateTimePicker from "@/components/ui/DateTimePicker";
import type { MahjongCsEvent } from "@/types/mahjong";

/** DateTimePicker の値は常に日本時間で組み立てる。 */
export function jstInput(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

export const csButton =
  "px-3 py-2 text-xs font-medium text-[#231714] border " +
  "border-[#231714]/10 rounded-lg hover:bg-gray-50 disabled:opacity-50";
export const csPrimary =
  "px-4 py-2 text-xs font-bold text-[#231714] bg-[#B0E401] rounded-lg hover:opacity-90 disabled:opacity-50";

// CSの大会名・定員・受付期間を入力して作成する。
export default function CsCreateForm({
  priorityPreviewCount,
  onCreated,
}: {
  priorityPreviewCount: number;
  onCreated: (event: MahjongCsEvent) => void;
}) {
  const [name, setName] = useState("チャンピオンシップ");
  const [eventDate, setEventDate] = useState(() => jstInput(new Date()).split("T")[0]);
  const [capacity, setCapacity] = useState(40);
  const [opens, setOpens] = useState(() => jstInput(new Date()));
  const [closes, setCloses] = useState(() => jstInput(new Date(Date.now() + 7 * 86400000)));
  const [deadlineEdited, setDeadlineEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    if (!name.trim() || !eventDate || !opens || !closes) {
      setError("すべての項目を入力してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/mahjong/cs", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          eventDate,
          capacity,
          entryOpensAt: `${opens}:00+09:00`,
          entryClosesAt: `${closes}:00+09:00`,
        }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "作成に失敗しました");
      else onCreated(data.event);
    } catch {
      setError("作成に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-[#231714]/10 p-4 space-y-4 text-[#231714] min-w-0">
      <div>
        <h2 className="text-sm font-bold">CS作成</h2>
        <p className="text-xs mt-1">人数と受付期間だけ決めます</p>
      </div>
      <fieldset
        disabled={busy}
        className="space-y-4 min-w-0 max-w-lg"
      >
        <label className="block text-xs">
          大会名
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 w-full px-3 py-2 text-sm border border-[#231714]/10 rounded-lg"
          />
        </label>
        <div>
          <p className="text-xs mb-1">開催日</p>
          <DatePicker
            value={eventDate}
            onChange={setEventDate}
          />
        </div>
        <div>
          <p className="text-xs mb-1">定員</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label="定員を減らす"
              className={csButton}
              disabled={capacity <= 4}
              onClick={() => setCapacity((n) => n - 1)}
            >
              −
            </button>
            <span className="text-sm font-bold">{capacity}名</span>
            <button
              type="button"
              aria-label="定員を増やす"
              className={csButton}
              disabled={capacity >= 200}
              onClick={() => setCapacity((n) => n + 1)}
            >
              ＋
            </button>
          </div>
        </div>
        <div>
          <p className="text-xs mb-1">受付開始（日本時間）</p>
          <DateTimePicker
            value={opens}
            onChange={(v) => {
              setOpens(v);
              if (!deadlineEdited)
                setCloses(jstInput(new Date(Date.parse(`${v}:00+09:00`) + 7 * 86400000)));
            }}
            className="max-sm:flex-col"
          />
        </div>
        <div>
          <p className="text-xs mb-1">締切（日本時間）</p>
          <DateTimePicker
            value={closes}
            onChange={(v) => {
              setCloses(v);
              setDeadlineEdited(true);
            }}
            className="max-sm:flex-col"
          />
          <p className="text-xs mt-1 text-[#231714]/80">既定は開始から1週間</p>
        </div>
      </fieldset>
      <div className="space-y-2 text-xs">
        <h3 className="font-bold">枠の内訳</h3>
        <div
          className="flex h-3 overflow-hidden rounded-full bg-orange-100"
          aria-hidden="true"
        >
          <div
            className="bg-[#B0E401]"
            style={{ width: `${Math.min(100, (priorityPreviewCount / capacity) * 100)}%` }}
          />
        </div>
        <p>
          優先枠 M1・M2：{priorityPreviewCount}名 ／ M3枠：
          {Math.max(0, capacity - priorityPreviewCount)}名
        </p>
        <p>優先枠：M1・M2の人は参加表明すれば必ず参加できます</p>
        <p>M3枠：先着順。満員のあとはキャンセル待ち</p>
        <p>
          {"繰り上げ：締切時、未表明の優先枠ぶんを" +
            "キャンセル待ちから先着順に繰り上げ"}
        </p>
        <p>参加資格：リーグ戦に1回以上出た人だけ</p>
      </div>
      {capacity < priorityPreviewCount && (
        <p className="text-xs text-red-600">定員を優先枠の人数以上にしてください</p>
      )}
      {error && (
        <p
          role="alert"
          className="text-xs text-red-600"
        >
          {error}
        </p>
      )}
      <button
        disabled={busy || capacity < priorityPreviewCount}
        onClick={create}
        className={csPrimary}
      >
        {busy ? "作成中..." : "作成して参加受付を始める"}
      </button>
    </section>
  );
}
