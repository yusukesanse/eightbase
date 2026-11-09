"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import type { MahjongCsEvent, MahjongCsMatch } from "@/types";
import { ticketLabel } from "@/lib/mahjongCsBracket";
import type { GameCsRules } from "@/lib/gameCsRules";
import CsCreateForm, { csButton } from "./CsCreateForm";
import CsEntryAdminPanel from "./CsEntryAdminPanel";
import CsParticipantList from "./CsParticipantList";
import CsBracketBuilder from "./CsBracketBuilder";

// シーズンのCS一覧と選択した大会の管理画面を表示する（種目の違いは rules だけ）。
export default function GameCsAdminPage({ rules }: { rules: GameCsRules }) {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [events, setEvents] = useState<MahjongCsEvent[]>([]);
  // undefined = 初回は最新を選択、null = 新規作成。
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(null);
  const [priorityPreviewCount, setPriorityPreviewCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<"resetBracket" | "delete" | null>(null);
  const [editMatch, setEditMatch] = useState<MahjongCsMatch | null>(null);
  const selected = events.find((event) => event.csEventId === selectedId) ?? null;
  const legacy = selected !== null && selected.capacity === undefined;

  const fetchEvents = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/${rules.game}/cs?seasonId=${encodeURIComponent(seasonId)}`, {
        credentials: "same-origin",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "取得に失敗しました");
      setActiveSeasonId(data.activeSeasonId ?? null);
      setEvents(data.events ?? []);
      setPriorityPreviewCount(data.priorityPreviewCount ?? 0);
      setSelectedId((id) => (id === undefined ? (data.events?.[0]?.csEventId ?? null) : id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [seasonId, rules.game]);
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  async function performAction() {
    if (!selected || !confirmation || (legacy && confirmation !== "delete")) return;
    setBusy(true);
    setError(null);
    try {
      const suffix = confirmation === "resetBracket" ? "/fix" : "";
      const res = await fetch(`/api/admin/${rules.game}/cs/${selected.csEventId}${suffix}`, {
        method: confirmation === "delete" ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...(confirmation === "resetBracket"
          ? { body: JSON.stringify({ action: "resetBracket" }) }
          : {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "更新に失敗しました");
        if (res.status === 404 || res.status === 409) await fetchEvents();
      } else {
        setError(null);
        if (confirmation === "delete") setSelectedId(undefined);
        await fetchEvents();
      }
    } catch {
      setError("更新に失敗しました");
    } finally {
      setBusy(false);
      setConfirmation(null);
    }
  }

  if (loading)
    return (
      <div className="flex items-center justify-center h-40">
        <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
      </div>
    );

  return (
    <div className="p-4 sm:p-8 space-y-6 min-w-0 max-w-full">
      {error && (
        <div
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-xs text-red-600"
        >
          {error}
          <button
            onClick={() => {
              setError(null);
              void fetchEvents();
            }}
            className="ml-3 underline"
          >
            再取得
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {events.map((event) => (
          <button
            key={event.csEventId}
            disabled={busy}
            onClick={() => {
              setSelectedId(event.csEventId);
              setConfirmation(null);
              setError(null);
              setEditMatch(null);
            }}
            className={`max-w-full break-words px-3 py-1.5 text-xs font-medium rounded-lg border ${
              selectedId === event.csEventId
                ? "bg-[#231714] text-white border-[#231714]"
                : "bg-white text-[#231714]/80 border-[#231714]/10"
            }`}
          >
            {event.name}（{event.eventDate}）
          </button>
        ))}
        {seasonId === activeSeasonId ? (
          <button
            disabled={busy}
            className={csButton}
            onClick={() => {
              setSelectedId(null);
              setConfirmation(null);
              setError(null);
            }}
          >
            新しいCSを作る
          </button>
        ) : (
          <p className="text-xs text-[#231714]/80">CSの作成は現在のシーズンでだけできます</p>
        )}
      </div>
      {!selected && seasonId === activeSeasonId && (
        <CsCreateForm
          rules={rules}
          priorityPreviewCount={priorityPreviewCount}
          onCreated={(event) => {
            setError(null);
            setEvents((previous) => [event, ...previous]);
            setSelectedId(event.csEventId);
            void fetchEvents();
          }}
        />
      )}
      {selected && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#231714] break-words">{selected.name}</h2>
              <p className="text-xs text-[#231714]/85 mt-0.5">
                {selected.eventDate}・
                {legacy
                  ? "旧形式（閲覧のみ）"
                  : {
                      entry: "参加受付中",
                      closed: "編成中",
                      running: "進行中",
                      finished: "終了",
                      setup: "準備中",
                    }[selected.status]}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
                {!legacy && (selected.status === "running" || selected.status === "finished") && (
                  <button
                    disabled={busy}
                    className={csButton}
                    onClick={() => {
                      setError(null);
                      setConfirmation("resetBracket");
                    }}
                  >
                    編成に戻す
                  </button>
                )}
                <button
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setConfirmation("delete");
                  }}
                  className={
                    "px-3 py-2 text-xs font-medium text-red-500 border border-red-200 " +
                    "rounded-lg disabled:opacity-50"
                  }
                >
                  削除
                </button>
              </div>
          </div>
          {confirmation && (!legacy || confirmation === "delete") && (
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 space-y-3">
              <p className="text-xs">
                {confirmation === "resetBracket"
                  ? "編成に戻すと、記録済みの結果は消えます。"
                  : "このCSを削除しますか？"}
              </p>
              <div className="flex gap-2">
                <button
                  disabled={busy}
                  className={csButton}
                  onClick={performAction}
                >
                  {confirmation === "resetBracket" ? "編成に戻す" : "削除する"}
                </button>
                <button
                  disabled={busy}
                  className={csButton}
                  onClick={() => setConfirmation(null)}
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}
          {!legacy && selected.status === "entry" && (
            <CsEntryAdminPanel
              key={selected.csEventId}
              rules={rules}
              event={selected}
              onChanged={fetchEvents}
              onError={setError}
            />
          )}
          {!legacy && selected.status === "closed" && (
            <>
              <CsParticipantList
                key={selected.csEventId}
                rules={rules}
                event={selected}
                onChanged={fetchEvents}
                onError={setError}
              />
              <CsBracketBuilder
                rules={rules}
                event={selected}
                onChanged={fetchEvents}
                onError={setError}
              />
            </>
          )}
          {(legacy || selected.status === "running" || selected.status === "finished") && (
            <>
              {selected.championId && (
                <div
                  className={
                    "bg-gradient-to-r from-yellow-50 to-white border border-yellow-300 " +
                    "rounded-xl p-4 text-center"
                  }
                >
                  <div className="text-xs text-yellow-700 font-medium">優勝</div>
                  <div className="text-lg font-bold text-[#231714] mt-1 break-words">
                    {selected.entrants.find((e) => e.lineUserId === selected.championId)
                      ?.displayName ?? "—"}
                  </div>
                </div>
              )}
              {/* ブラケット */}
              <section className="space-y-5">
                {selected.rounds.length === 0 ? (
                  <div
                    className={
                      "bg-white rounded-xl border border-[#231714]/10 p-8 text-center " +
                      "text-sm text-[#231714]/80"
                    }
                  >
                    まだトーナメントが生成されていません
                  </div>
                ) : (
                  selected.rounds.map((round, ri) => (
                    <div key={ri}>
                      <div className="text-xs font-bold text-[#231714]/85 mb-2">
                        {round.label}
                        {round.type !== "final"
                          && new Set(round.matches.map((m) => m.advanceCount ?? round.advanceCount)).size <= 1
                          && `（各卓 上位${round.matches[0]?.advanceCount ?? round.advanceCount}名通過）`}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {round.matches.map((m) => (
                          <div
                            key={m.matchId}
                            className="bg-white rounded-xl border border-[#231714]/10 p-4"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                              <span className="text-sm font-bold text-[#231714] break-words min-w-0">
                                {m.label}
                                {round.type !== "final" && m.advanceCount != null && m.advanceCount !== round.advanceCount
                                  ? `（上位${m.advanceCount}名通過）` : ""}
                              </span>
                              <div className="flex items-center gap-2">
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                    m.status === "completed"
                                      ? "bg-[#B0E401]/20 text-[#231714]"
                                      : "bg-orange-50 text-orange-600"
                                  }`}
                                >
                                  {m.status === "completed"
                                    ? "確定"
                                    : m.status === "tiebreak"
                                      ? `${rules.tiebreakLabel}待ち`
                                      : "結果待ち"}
                                </span>
                                {/* 札の席が全部埋まった卓だけ（麻雀は4席） */}
                                {!legacy && m.players.length === (m.seats ?? []).length && (
                                  <button
                                    onClick={() => {
                                      setError(null);
                                      setEditMatch(m);
                                    }}
                                    className={
                                      "px-2 py-1 text-xs font-medium text-[#231714]/80 border " +
                                      "border-[#231714]/10 rounded-lg hover:bg-gray-50"
                                    }
                                  >
                                    {m.status === "completed" ? "修正" : "結果入力"}
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="space-y-1">
                              {[...m.players]
                                .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
                                .map((p) => (
                                  <div
                                    key={p.lineUserId}
                                    className="flex items-center justify-between text-sm"
                                  >
                                    <span className="text-[#231714] break-words min-w-0">
                                      {p.displayName}
                                    </span>
                                    <span className="text-xs text-[#231714]/85">
                                      {p.rank !== null
                                        ? `${p.rank}位${(() => {
                                            // 旧形式のポーカーCSは points ではなく chips に持つ。表示だけ補う
                                            const value = p.points ?? (p as { chips?: number }).chips;
                                            return value != null ? ` / ${value.toLocaleString()}` : "";
                                          })()}`
                                        : "—"}
                                    </span>
                                  </div>
                                ))}
                              {(m.seats ?? []).map((seat, index) => {
                                if (seat?.kind !== "ticket") return null;
                                const source = selected.rounds
                                  .flatMap((r) => r.matches)
                                  .find((match) => match.matchId === seat.fromMatchId);
                                const winner =
                                  source?.status === "completed"
                                    ? source.players.find((p) => p.rank === seat.place)
                                    : undefined;
                                if (
                                  winner &&
                                  m.players.some((p) => p.lineUserId === winner.lineUserId)
                                )
                                  return null;
                                return (
                                  <p
                                    key={`ticket-${index}`}
                                    className="text-sm text-[#231714]/60"
                                  >
                                    {ticketLabel(selected.rounds, seat.fromMatchId, seat.place)}
                                  </p>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </>
      )}

      {editMatch && selected && !legacy && (
        <MatchResultModal
          rules={rules}
          csEventId={selected.csEventId}
          match={editMatch}
          onClose={() => setEditMatch(null)}
          onChanged={fetchEvents}
          onSaved={() => {
            setError(null);
            setEditMatch(null);
            fetchEvents();
          }}
        />
      )}
    </div>
  );
}

// 対局の結果を入力・修正して保存する。麻雀は点数と順位、それ以外は scoreLabel の値だけ。

const validScore = (v: string) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 1_000_000;
};

function MatchResultModal({
  rules,
  csEventId,
  match,
  onClose,
  onSaved,
  onChanged,
}: {
  rules: GameCsRules;
  csEventId: string;
  match: MahjongCsMatch;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}) {
  const scored = rules.game !== "mahjong";
  const [rows, setRows] = useState(
    match.players.map((p) => ({
      lineUserId: p.lineUserId,
      displayName: p.displayName,
      points: p.points != null ? String(p.points) : "",
      rank: p.rank != null ? String(p.rank) : "",
      tiebreak: p.tiebreakPoints?.[0] != null ? String(p.tiebreakPoints[0]) : "",
    })),
  );
  const wasCompleted = match.status === "completed";
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // ponytail: 管理画面から入れられる追加勝負は1回分だけ。2回目が要る卓は利用者側の申告で解消する。
  const [needTiebreak, setNeedTiebreak] = useState(
    scored && (match.status === "tiebreak" || match.players.some((p) => (p.tiebreakPoints?.length ?? 0) > 0)),
  );

  const total = rows.reduce((s, r) => s + (Number(r.points) || 0), 0);
  const is4 = match.players.length === 4;

  async function save() {
    setError(null);
    if (scored) {
      if (rows.some((r) => r.points === "" || !validScore(r.points))) {
        setError(`${rules.scoreLabel}は0〜1,000,000の整数で全員分入力してください`);
        return;
      }
      if (rows.some((r) => r.tiebreak !== "" && !validScore(r.tiebreak))) {
        setError(`${rules.tiebreakLabel}は0〜1,000,000の整数で入力してください`);
        return;
      }
    } else {
      if (rows.some((r) => r.points === "" || r.rank === "")) {
        setError("全員の点数と順位を入力してください");
        return;
      }
      if (
        rows.some(
          (r) =>
            !Number.isInteger(Number(r.points)) ||
            Number(r.points) % 100 !== 0 ||
            Math.abs(Number(r.points)) > 200000,
        )
      ) {
        setError("点数は−200,000〜200,000の範囲で100点単位の整数を入力してください");
        return;
      }
      if (is4 && total !== 100000) {
        setError(`合計が ${total.toLocaleString()} 点です（100,000点になる必要があります）`);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/${rules.game}/cs/${csEventId}/fix`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "editMatch",
          matchId: match.matchId,
          results: rows.map((r) =>
            scored
              ? {
                  lineUserId: r.lineUserId,
                  points: Number(r.points),
                  ...(r.tiebreak ? { tiebreakPoints: [Number(r.tiebreak)] } : {}),
                }
              : { lineUserId: r.lineUserId, points: Number(r.points), rank: Number(r.rank) },
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "保存に失敗しました");
        if (scored && res.status === 400 && String(data.error ?? "").includes("通過の境目が同点です")) {
          setNeedTiebreak(true);
        }
        if (res.status === 404 || res.status === 409) onChanged();
      } else {
        onSaved();
      }
    } catch {
      setError("保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const setRow = (i: number, patch: Partial<(typeof rows)[number]>) =>
    setRows((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[#231714] mb-1">
          {match.label} の{wasCompleted ? "結果修正" : "結果入力"}
        </h3>
        <p className="text-xs text-[#231714]/85 mb-2">
          {scored
            ? `全員の${rules.scoreLabel}を入力${needTiebreak ? `（同点の人は${rules.tiebreakLabel}の結果も）` : ""}`
            : `${is4 ? "合計100,000点・" : ""}順位は1〜${match.players.length}を1人ずつ`}
        </p>
        {wasCompleted && (
          <div
            className={
              "rounded-lg bg-[#fff4ec] border border-[#f0c9b0] px-3 py-2 text-xs " +
              "font-bold text-[#a1502c] mb-3"
            }
          >
            {"確定済みの試合を修正すると、" +
              "次の卓の勝ち抜け選手が更新されます。" +
              "次の卓に結果が入っている場合は修正できません。"}
          </div>
        )}
        <div className="space-y-3">
          {rows.map((r, i) => (
            <div
              key={r.lineUserId}
              className="flex items-center gap-2"
            >
              <span className="flex-1 text-sm font-medium text-[#231714] truncate">
                {r.displayName}
              </span>
              {scored ? (
                <>
                  <input
                    type="number"
                    step={1}
                    min={0}
                    max={1000000}
                    aria-label={`${r.displayName}の${rules.scoreLabel}`}
                    value={r.points}
                    onChange={(e) => setRow(i, { points: e.target.value })}
                    placeholder={rules.scoreLabel}
                    className="w-28 px-3 py-2 text-sm border border-[#231714]/10 rounded-lg text-right"
                  />
                  {needTiebreak && (
                    <input
                      type="number"
                      step={1}
                      min={0}
                      max={1000000}
                      aria-label={`${r.displayName}の${rules.tiebreakLabel}`}
                      value={r.tiebreak}
                      onChange={(e) => setRow(i, { tiebreak: e.target.value })}
                      placeholder={rules.tiebreakLabel}
                      className="w-28 px-3 py-2 text-sm border border-[#231714]/10 rounded-lg text-right"
                    />
                  )}
                </>
              ) : (
                <>
                  <select
                    value={r.rank}
                    onChange={(e) => setRow(i, { rank: e.target.value })}
                    className="w-20 px-2 py-2 text-sm border border-[#231714]/10 rounded-lg bg-white"
                  >
                    <option value="">順位</option>
                    {match.players.map((_, n) => (
                      <option
                        key={n + 1}
                        value={n + 1}
                      >
                        {n + 1}位
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    step={100}
                    min={-200000}
                    max={200000}
                    value={r.points}
                    onChange={(e) => setRow(i, { points: e.target.value })}
                    placeholder="点数"
                    className="w-28 px-3 py-2 text-sm border border-[#231714]/10 rounded-lg text-right"
                  />
                </>
              )}
            </div>
          ))}
        </div>
        {!scored && is4 && (
          <div
            className={`mt-3 text-right text-xs font-medium ${total === 100000 ? "text-[#231714]/85" : "text-red-500"}`}
          >
            合計: {total.toLocaleString()} 点
          </div>
        )}
        {scored && needTiebreak && (
          <p className="mt-3 text-xs text-[#231714]/85">
            2回目以降の{rules.tiebreakLabel}は利用者の申告で決めてください
          </p>
        )}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className={
              "flex-1 py-2.5 text-sm font-medium text-[#231714]/80 border " +
              "border-[#231714]/10 rounded-xl hover:bg-gray-50"
            }
          >
            キャンセル
          </button>
          <button
            onClick={save}
            disabled={saving}
            className={
              "flex-1 py-2.5 text-sm font-bold text-[#231714] bg-[#B0E401] " +
              "rounded-xl hover:opacity-90 disabled:opacity-50"
            }
          >
            {saving ? "保存中..." : "確定"}
          </button>
        </div>
      </div>
    </div>
  );
}
