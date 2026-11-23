"use client";

import { useState } from "react";
import { rebalanceEntries, waitlistPosition } from "@/lib/mahjongCsEntry";
import { kanaIncludes } from "@/lib/kana";
import type { MahjongCsEntry, MahjongCsEvent } from "@/types/mahjong";
import { MAHJONG_CS_RULES, type GameCsRules } from "@/lib/gameCsRules";
import { csButton, csPrimary } from "./CsCreateForm";

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

type Candidate = { lineUserId: string; displayName: string; pictureUrl: string };

// 受付中・締切後に共通の参加者一覧と、取り消し・管理者による追加の確認を表示する。
export default function CsParticipantList({ event, onChanged, onError, disabled = false, rules }: {
  event: MahjongCsEvent;
  onChanged: () => void;
  onError: (message: string | null) => void;
  disabled?: boolean;
  rules?: GameCsRules;
}) {
  const r = rules ?? MAHJONG_CS_RULES;
  const third = r.tierLabels[2];
  const filters = ["すべて", "優先枠", third, "キャンセル待ち"];
  const tierStyles: Record<string, string> = {
    [r.tierLabels[0]]: "bg-yellow-100 text-yellow-700",
    [r.tierLabels[1]]: "bg-sky-100 text-sky-700",
    [third]: "bg-orange-50 text-orange-600",
  };
  const [filter, setFilter] = useState("すべて");
  const [removeEntry, setRemoveEntry] = useState<MahjongCsEntry | null>(null);
  const [removing, setRemoving] = useState(false);
  // 管理者による追加（締切・参加資格は見ないが、定員は守る）。候補は開いたときに1回だけ読む。
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [addTarget, setAddTarget] = useState<Candidate | null>(null);
  const [adding, setAdding] = useState(false);
  const busy = disabled || removing || adding;
  const entries = [...(event.entries ?? [])].sort(
    (a, b) => Date.parse(a.enteredAt) - Date.parse(b.enteredAt) || a.lineUserId.localeCompare(b.lineUserId),
  );
  const priority = new Set(event.priorityUserIds ?? []);

  // 空きの数え方は rebalanceEntries と同じ: いちばん後ろに1人足して、その人が確定になるか。
  const hasSeat = rebalanceEntries([...entries, {
    lineUserId: "", displayName: "", tier: third, rank: 0, enteredAt: "9999-12-31T00:00:00Z", state: "confirmed",
  }], {
    capacity: event.capacity ?? 0, priorityUserIds: event.priorityUserIds ?? [],
    phase: event.status === "entry" ? "entry" : "closed",
  }).at(-1)!.state === "confirmed";
  const stateOf = new Map(entries.map((e) => [e.lineUserId, e.state]));
  const candidateResults = addQuery.trim()
    ? (candidates ?? []).filter((c) => kanaIncludes(c.displayName, addQuery)).slice(0, 8)
    : [];

  // 参加者の取り消し・追加を送る。成功、または状態がずれていた（404・409）ときは一覧を取り直す。
  async function patchEntry(action: "removeEntry" | "addEntry", lineUserId: string) {
    onError(null);
    try {
      const res = await fetch(`/api/admin/${r.game}/cs/${event.csEventId}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lineUserId }),
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
    }
  }

  async function remove() {
    if (!removeEntry) return;
    setRemoving(true);
    await patchEntry("removeEntry", removeEntry.lineUserId);
    setRemoving(false);
    setRemoveEntry(null);
  }

  async function add() {
    if (!addTarget) return;
    setAdding(true);
    await patchEntry("addEntry", addTarget.lineUserId);
    setAdding(false);
    setAddTarget(null);
    setAddQuery("");
  }

  async function toggleAdd() {
    setAddOpen(!addOpen);
    setAddTarget(null);
    if (addOpen || candidates) return;
    setCandidates([]);
    try {
      const res = await fetch("/api/admin/games/participants", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error);
      setCandidates(Array.isArray(data.participants) ? data.participants : []);
    } catch (e) {
      setCandidates(null); // 次に開いたときに読み直す
      onError((e instanceof Error && e.message) || "候補の取得に失敗しました");
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
      <div className="flex items-center gap-2">
        <button className={csButton} aria-expanded={addOpen && hasSeat} disabled={!hasSeat} onClick={toggleAdd}>
          ＋ 参加者を追加
        </button>
        {!hasSeat && <p className="text-xs">定員に達しています</p>}
      </div>
      {addOpen && hasSeat && (
        <div className="rounded-xl border border-[#231714]/10 bg-white p-4 space-y-3">
          <p className="text-xs">
            アプリの利用者を参加確定として追加します。締切・参加資格に関係なく追加できますが、定員は超えられません。
          </p>
          {addTarget ? (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
              <p className="text-xs">
                {addTarget.displayName}さんを参加確定として追加しますか？（締切・参加資格に関係なく追加されます）
              </p>
              <div className="flex gap-2">
                <button disabled={busy} className={csPrimary} onClick={add}>
                  追加する
                </button>
                <button disabled={busy} className={csButton} onClick={() => setAddTarget(null)}>
                  キャンセル
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={addQuery}
                onChange={(e) => setAddQuery(e.target.value)}
                placeholder="名前で検索（ひらがな・カタカナ可）"
                className="w-full rounded-lg border border-[#231714]/10 px-3 py-2 text-sm"
              />
              {candidateResults.length > 0 ? (
                <ul className="rounded-lg border border-[#231714]/10 divide-y divide-[#231714]/5">
                  {candidateResults.map((c) => {
                    const state = stateOf.get(c.lineUserId);
                    return (
                      <li key={c.lineUserId} className="flex items-center gap-2 px-3 py-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-bold">{c.displayName}</span>
                        {state && <span>{state === "confirmed" ? "参加確定" : "キャンセル待ち"}</span>}
                        <button
                          disabled={busy || !!state}
                          className={csButton}
                          aria-label={`${c.displayName}さんを追加`}
                          onClick={() => setAddTarget(c)}
                        >
                          追加
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                addQuery.trim() && <p className="text-xs">該当する候補はいません。</p>
              )}
            </>
          )}
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
                    : filter === third
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
                      ? entry.adminAdded ? "参加確定（管理者追加）" : "参加確定"
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
