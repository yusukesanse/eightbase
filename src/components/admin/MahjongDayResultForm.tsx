"use client";

import { useEffect, useMemo, useState } from "react";
import { kanaIncludes } from "@/lib/kana";

/**
 * 管理者が「過去の開催日の対戦結果」をまとめて入力するフォーム（麻雀）。
 *
 * アプリを通さず紙で付けた結果を後から入れるためのもの。
 * 2026-08-01 はゲストが参加できない不具合で申告できず紙運用になった。
 *
 * 入力の流れ（現場の順序に合わせる）:
 *   ① その日の参加者を選ぶ（アプリ利用者なら誰でも。ゲスト含む）
 *   ② 実施した卓数を入れる（＝半荘数。アベレージの母数になる）
 *   ③ 卓ごとに参加者と持ち点を入れる（席の候補は①で選んだ人だけ）
 *      着順は**持ち点から自動で決まる**。行順で着順を決めさせると、点数と着順が逆転した卓が
 *      量産されて `validateTableReports` の整合性チェックに落ちる（2026-08-01 に実際に発生）。
 *
 * 検証は利用者申告と同じ（合計100,000点・順位1〜4が1人ずつ）。
 * 満たさない卓は保存はされるが「集計対象外」になるため、卓ごとに合計を常時表示する。
 */

const TABLE_SIZE = 4;
const TABLE_TOTAL = 100000;
const MAX_TABLES = 30;

interface Candidate {
  lineUserId: string;
  displayName: string;
  role: string;
  pictureUrl: string;
}

/** 1席分の入力。rank は行の位置（1〜4位）で固定。 */
interface Seat {
  lineUserId: string;
  points: string;
}

const emptyTable = (): Seat[] => Array.from({ length: TABLE_SIZE }, () => ({ lineUserId: "", points: "" }));

/**
 * 持ち点から着順を割り出す（1位＝最高得点。同点は上の行を上位）。
 * 麻雀の着順は持ち点で決まるので、入力者に点数順に並べ替えさせない。
 * サーバー側 `deriveRanksFromPoints` と同じ規則にすること（表示と保存がズレると事故る）。
 */
function ranksFromPoints(seats: Seat[]): (number | null)[] {
  const filled = seats.map((s, i) => ({ i, v: s.points.trim() === "" ? null : Number(s.points) }));
  const order = filled
    .filter((x) => x.v !== null)
    .sort((a, b) => (b.v as number) - (a.v as number) || a.i - b.i);
  const rank = new Map<number, number>();
  order.forEach((o, idx) => rank.set(o.i, idx + 1));
  return seats.map((_, i) => rank.get(i) ?? null);
}

const ROLE_LABEL: Record<string, string> = { member: "会員", staff: "社員", guest: "ゲスト" };

export default function MahjongDayResultForm({
  seasonId,
  eventDate,
  onCreated,
}: {
  seasonId: string;
  eventDate: string | null;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  /** ①その日の参加者（lineUserId の並び） */
  const [participants, setParticipants] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  /** ③卓ごとの入力。長さ＝②の卓数 */
  const [tables, setTables] = useState<Seat[][]>([emptyTable()]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || candidates.length > 0) return;
    fetch("/api/admin/games/participants", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setCandidates(d.participants ?? []))
      .catch(() => {});
  }, [open, candidates.length]);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.lineUserId, c])), [candidates]);
  const nameOf = (id: string) => byId.get(id)?.displayName || id;

  const searchResults = query.trim()
    ? candidates.filter((c) => !participants.includes(c.lineUserId) && kanaIncludes(c.displayName, query)).slice(0, 8)
    : [];

  /* ───────── ① 参加者 ───────── */

  function addParticipant(id: string) {
    setParticipants((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setQuery("");
  }

  function removeParticipant(id: string) {
    setParticipants((prev) => prev.filter((p) => p !== id));
    // その人が座っていた席は空にする（存在しない参加者が残らないように）
    setTables((prev) => prev.map((t) => t.map((s) => (s.lineUserId === id ? { ...s, lineUserId: "" } : s))));
  }

  /* ───────── ② 卓数 ───────── */

  function setTableCount(nextRaw: number) {
    const next = Math.max(1, Math.min(MAX_TABLES, nextRaw || 1));
    setTables((prev) => {
      if (next === prev.length) return prev;
      if (next < prev.length) return prev.slice(0, next);      // 入力済みは前から残す
      return [...prev, ...Array.from({ length: next - prev.length }, emptyTable)];
    });
  }

  /* ───────── ③ 卓ごとの入力 ───────── */

  function setSeat(ti: number, si: number, patch: Partial<Seat>) {
    setTables((prev) => prev.map((t, i) => (i === ti ? t.map((s, j) => (j === si ? { ...s, ...patch } : s)) : t)));
  }

  /** 卓ごとの着順（持ち点から算出・表示用）。 */
  const seatRanks = tables.map((t) => ranksFromPoints(t));

  const tableStats = tables.map((t) => {
    const chosen = t.map((s) => s.lineUserId).filter(Boolean);
    const total = t.reduce((sum, s) => sum + (Number(s.points) || 0), 0);
    const filled = t.every((s) => s.lineUserId && s.points.trim() !== "");
    const dupOk = new Set(chosen).size === chosen.length;
    const empty = chosen.length === 0 && t.every((s) => s.points.trim() === "");
    return { total, filled, dupOk, empty, ok: filled && dupOk && total === TABLE_TOTAL };
  });

  /** 何も入れていない卓は送らない（卓数を多めに入れてしまったときの逃げ道）。 */
  const sendIndexes = tables.map((_, i) => i).filter((i) => !tableStats[i].empty);
  const blocking = sendIndexes.filter((i) => !tableStats[i].filled || !tableStats[i].dupOk);
  const canSave =
    !!eventDate && participants.length >= TABLE_SIZE && sendIndexes.length > 0 && blocking.length === 0 && !saving;

  function reset() {
    setParticipants([]);
    setTables([emptyTable()]);
    setQuery("");
  }

  async function save() {
    if (!eventDate) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mahjong/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          seasonId,
          eventDate,
          tables: sendIndexes.map((i) => {
            const ranks = ranksFromPoints(tables[i]);
            return {
              members: tables[i].map((s, si) => ({
                lineUserId: s.lineUserId,
                points: Number(s.points),
                // 着順は持ち点から決める（行の位置ではない）
                rank: ranks[si] ?? si + 1,
              })),
            };
          }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "保存に失敗しました" });
      } else {
        const { completedCount = 0, reportingCount = 0 } = data;
        setMessage({
          ok: reportingCount === 0,
          text:
            reportingCount === 0
              ? `${completedCount}卓を登録しました。通算順位に反映されます。`
              : `${completedCount}卓を登録しました。${reportingCount}卓は合計点が合わないため集計対象外です（卓一覧から修正できます）。`,
        });
        reset();
        onCreated();
      }
    } catch {
      setMessage({ ok: false, text: "通信に失敗しました" });
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-4 px-4 py-2 text-sm font-bold text-white bg-[#2f7d57] rounded-lg hover:bg-[#2f7d57]/85"
      >
        ＋ 過去の対戦結果を入力
      </button>
    );
  }

  return (
    <div className="mb-5 bg-white rounded-xl border border-[#231714]/10 p-4">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-bold text-[#231714]">過去の対戦結果を入力</h3>
        <button
          onClick={() => { setOpen(false); reset(); setMessage(null); }}
          className="text-xs text-[#231714]/60 hover:underline"
        >
          閉じる
        </button>
      </div>
      <p className="text-xs text-[#231714]/80 mb-4">
        紙で付けた結果などをあとから入れます。参加表明していない人・ゲストも選べます。
        {eventDate ? <> 開催日は <b>{eventDate}</b> です。</> : <> <b className="text-[#d8533a]">先に開催日を選んでください。</b></>}
      </p>

      {message && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-xs font-bold border ${
          message.ok ? "bg-[#eef6f0] border-[#cfe6d8] text-[#2f7d57]" : "bg-[#fff8e5] border-[#f0dfae] text-[#8a6d1f]"
        }`}>
          {message.text}
        </div>
      )}

      {/* ───── ① 参加者 ───── */}
      <section className="mb-5">
        <h4 className="text-xs font-bold text-[#231714] mb-1">① その日の参加者</h4>
        <p className="text-[11px] text-[#231714]/70 mb-2">
          この日に打った人を全員追加してください（卓の席はここから選びます）。
        </p>

        {participants.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {participants.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 rounded-full bg-[#f2f6f7] border border-[#231714]/10 text-xs">
                {nameOf(id)}
                <button
                  onClick={() => removeParticipant(id)}
                  className="w-4 h-4 rounded-full text-[#231714]/50 hover:text-[#d8533a] hover:bg-white"
                  aria-label={`${nameOf(id)} を外す`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="relative max-w-sm">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="名前で検索して追加"
            className="w-full px-2.5 py-1.5 text-sm border border-[#231714]/15 rounded-lg"
          />
          {searchResults.length > 0 && (
            <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#231714]/15 rounded-lg shadow-lg max-h-56 overflow-y-auto">
              {searchResults.map((c) => (
                <li key={c.lineUserId}>
                  <button
                    onClick={() => addParticipant(c.lineUserId)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-[#f2f6f7]"
                  >
                    {c.displayName || "(名前未設定)"}
                    <span className="ml-2 text-[10px] text-[#231714]/60">{ROLE_LABEL[c.role] ?? c.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-1.5 text-[11px] text-[#231714]/70">
          {participants.length}名を追加済み
          {participants.length > 0 && participants.length < TABLE_SIZE && (
            <span className="ml-1 text-[#d8533a] font-bold">（卓を作るには{TABLE_SIZE}名以上必要です）</span>
          )}
        </p>
      </section>

      {/* ───── ② 卓数 ───── */}
      <section className="mb-5">
        <h4 className="text-xs font-bold text-[#231714] mb-1">② 実施した卓数（半荘数）</h4>
        <p className="text-[11px] text-[#231714]/70 mb-2">
          アベレージの母数になります。多めに入れて空のまま残した卓は保存されません。
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setTableCount(tables.length - 1)}
            disabled={tables.length <= 1}
            className="w-8 h-8 rounded-lg border border-[#231714]/15 text-[#231714]/80 hover:bg-gray-50 disabled:opacity-40"
          >
            −
          </button>
          <input
            value={tables.length}
            onChange={(e) => setTableCount(Number(e.target.value.replace(/[^\d]/g, "")))}
            inputMode="numeric"
            className="w-16 px-2 py-1.5 text-sm text-center border border-[#231714]/15 rounded-lg tabular-nums"
          />
          <span className="text-sm text-[#231714]/80">卓</span>
          <button
            onClick={() => setTableCount(tables.length + 1)}
            disabled={tables.length >= MAX_TABLES}
            className="w-8 h-8 rounded-lg border border-[#231714]/15 text-[#231714]/80 hover:bg-gray-50 disabled:opacity-40"
          >
            ＋
          </button>
        </div>
      </section>

      {/* ───── ③ 卓ごとの点数 ───── */}
      <section>
        <h4 className="text-xs font-bold text-[#231714] mb-1">③ 卓ごとの点数</h4>
        <p className="text-[11px] text-[#231714]/70 mb-2">
          並び順は自由です。<b>着順は持ち点から自動で決まります</b>（1位＝最高得点）。
        </p>
        {participants.length < TABLE_SIZE ? (
          <p className="text-xs text-[#231714]/70 py-3">先に参加者を{TABLE_SIZE}名以上追加してください。</p>
        ) : (
          <div className="space-y-3">
            {tables.map((seats, ti) => {
              const st = tableStats[ti];
              return (
                <div key={ti} className="rounded-lg border border-[#231714]/10 p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[#231714]">{ti + 1}卓目</span>
                    {st.empty ? (
                      <span className="text-[11px] text-[#231714]/50">未入力（保存されません）</span>
                    ) : (
                      <span className={`text-[11px] font-bold ${st.total === TABLE_TOTAL ? "text-[#2f7d57]" : "text-[#d8533a]"}`}>
                        合計 {st.total.toLocaleString()} / {TABLE_TOTAL.toLocaleString()}
                        {st.total !== TABLE_TOTAL && `（${st.total > TABLE_TOTAL ? "+" : ""}${(st.total - TABLE_TOTAL).toLocaleString()}）`}
                      </span>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    {seats.map((seat, si) => {
                      const takenHere = seats.map((s) => s.lineUserId).filter((id, j) => id && j !== si);
                      const rank = seatRanks[ti][si];
                      return (
                        <div key={si} className="flex items-center gap-2">
                          {/* 着順は持ち点から自動で決まる（入力者が並べ替える必要はない） */}
                          <span className={`w-9 text-xs font-bold ${rank ? "text-[#231714]" : "text-[#231714]/35"}`}>
                            {rank ? `${rank}位` : "—"}
                          </span>
                          <select
                            value={seat.lineUserId}
                            onChange={(e) => setSeat(ti, si, { lineUserId: e.target.value })}
                            className="flex-1 min-w-0 px-2 py-1.5 text-sm border border-[#231714]/15 rounded-lg bg-white"
                          >
                            <option value="">選択してください</option>
                            {participants
                              .filter((id) => !takenHere.includes(id))
                              .map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}
                          </select>
                          <input
                            value={seat.points}
                            onChange={(e) => setSeat(ti, si, { points: e.target.value.replace(/[^\d-]/g, "") })}
                            inputMode="numeric"
                            placeholder="持ち点"
                            className="w-24 px-2 py-1.5 text-sm text-right border border-[#231714]/15 rounded-lg tabular-nums"
                          />
                        </div>
                      );
                    })}
                  </div>

                  {!st.empty && !st.filled && (
                    <p className="mt-1.5 text-[11px] text-[#d8533a]">未入力の席があります（4名ぶん入れてください）。</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={save}
          disabled={!canSave}
          className="px-4 py-2 text-sm font-bold text-white bg-[#231714] rounded-lg hover:bg-[#231714]/85 disabled:opacity-40"
        >
          {saving ? "保存中…" : `この内容で登録（${sendIndexes.length}卓）`}
        </button>
        <button
          onClick={reset}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-[#231714]/80 border border-[#231714]/15 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          クリア
        </button>
        {sendIndexes.some((i) => tableStats[i].filled && tableStats[i].dupOk && tableStats[i].total !== TABLE_TOTAL) && (
          <span className="text-[11px] text-[#8a6d1f]">
            合計が100,000点でない卓は「集計対象外」で保存されます（あとから修正できます）。
          </span>
        )}
      </div>
    </div>
  );
}
