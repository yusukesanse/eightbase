"use client";

import { useEffect, useMemo, useState } from "react";
import { kanaIncludes } from "@/lib/kana";

/**
 * 管理者が麻雀の卓（1半荘＝4名）を手入力で追加するフォーム。
 *
 * アプリを通さず紙で付けた結果を後から入れるためのもの。
 * 2026-08-01 はゲストが参加できない不具合で申告できず紙運用になった。
 *
 * 参加者は**アプリ利用者なら誰でも選べる**（参加表明の有無を問わない）。
 * 検証は利用者申告と同じ（合計100,000点・順位1〜4が1人ずつ）。満たさない場合も保存はできるが
 * その卓は「集計対象外」になるので、フォーム上で常に現在の合計と過不足を出す。
 */

const TABLE_SIZE = 4;
const TABLE_TOTAL = 100000;

interface Candidate {
  lineUserId: string;
  displayName: string;
  role: string;
  pictureUrl: string;
}

/** 1席分の入力。lineUserId 未選択は空文字。 */
interface Seat {
  lineUserId: string;
  points: string;
  rank: number;
}

const EMPTY_SEATS: Seat[] = Array.from({ length: TABLE_SIZE }, (_, i) => ({
  lineUserId: "",
  points: "",
  rank: i + 1,
}));

const ROLE_LABEL: Record<string, string> = { member: "会員", staff: "社員", guest: "ゲスト" };

export default function MahjongTableCreateForm({
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
  const [seats, setSeats] = useState<Seat[]>(EMPTY_SEATS);
  const [query, setQuery] = useState<string[]>(Array(TABLE_SIZE).fill(""));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!open || candidates.length > 0) return;
    fetch("/api/admin/games/participants", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setCandidates(d.participants ?? []))
      .catch(() => {});
  }, [open, candidates.length]);

  const nameById = useMemo(
    () => new Map(candidates.map((c) => [c.lineUserId, c.displayName])),
    [candidates]
  );

  const chosen = seats.map((s) => s.lineUserId).filter(Boolean);
  const total = seats.reduce((sum, s) => sum + (Number(s.points) || 0), 0);
  const allSeatsFilled = seats.every((s) => s.lineUserId && s.points.trim() !== "");
  const ranksOk = new Set(seats.map((s) => s.rank)).size === TABLE_SIZE;
  const totalOk = total === TABLE_TOTAL;
  const dupOk = new Set(chosen).size === chosen.length;
  const canSave = !!eventDate && allSeatsFilled && dupOk && !saving;

  function setSeat(i: number, patch: Partial<Seat>) {
    setSeats((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function reset() {
    setSeats(EMPTY_SEATS);
    setQuery(Array(TABLE_SIZE).fill(""));
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
          members: seats.map((s) => ({
            lineUserId: s.lineUserId,
            points: Number(s.points),
            rank: s.rank,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "保存に失敗しました" });
      } else if (data.tableStatus === "completed") {
        setMessage({ ok: true, text: "卓を追加しました（集計対象）。通算順位に反映されます。" });
        reset();
        onCreated();
      } else {
        setMessage({
          ok: false,
          text: `保存しましたが集計対象外です: ${data.validation?.error ?? "検証に通っていません"}`,
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
        ＋ 卓を手入力で追加
      </button>
    );
  }

  return (
    <div className="mb-5 bg-white rounded-xl border border-[#231714]/10 p-4">
      <div className="flex items-start justify-between mb-1">
        <h3 className="text-sm font-bold text-[#231714]">卓を手入力で追加</h3>
        <button onClick={() => { setOpen(false); reset(); setMessage(null); }} className="text-xs text-[#231714]/60 hover:underline">
          閉じる
        </button>
      </div>
      <p className="text-xs text-[#231714]/80 mb-3">
        紙で付けた結果などをあとから入れるための入力です。参加表明していない人・ゲストも選べます。
        {eventDate ? <> 開催日は <b>{eventDate}</b> です。</> : <> <b className="text-[#d8533a]">先に開催日を選んでください。</b></>}
      </p>

      {message && (
        <div className={`mb-3 rounded-lg px-3 py-2 text-xs font-bold border ${
          message.ok ? "bg-[#eef6f0] border-[#cfe6d8] text-[#2f7d57]" : "bg-[#fdece8] border-[#f4c9bd] text-[#d8533a]"
        }`}>
          {message.text}
        </div>
      )}

      <div className="space-y-2">
        {seats.map((seat, i) => {
          const q = query[i];
          const list = q.trim()
            ? candidates
                .filter((c) => !chosen.includes(c.lineUserId) || c.lineUserId === seat.lineUserId)
                .filter((c) => kanaIncludes(c.displayName, q))
                .slice(0, 8)
            : [];
          return (
            <div key={i} className="flex flex-wrap items-center gap-2 border-b border-[#231714]/[0.06] pb-2 last:border-0">
              <select
                value={seat.rank}
                onChange={(e) => setSeat(i, { rank: Number(e.target.value) })}
                className="px-2 py-1.5 text-sm border border-[#231714]/15 rounded-lg bg-white"
                aria-label="着順"
              >
                {[1, 2, 3, 4].map((r) => <option key={r} value={r}>{r}位</option>)}
              </select>

              <div className="relative flex-1 min-w-[180px]">
                {seat.lineUserId ? (
                  <div className="flex items-center gap-2 px-2 py-1.5 text-sm border border-[#231714]/15 rounded-lg bg-[#f7f9fa]">
                    <span className="flex-1 truncate">{nameById.get(seat.lineUserId) || seat.lineUserId}</span>
                    <button
                      onClick={() => { setSeat(i, { lineUserId: "" }); setQuery((p) => p.map((x, idx) => (idx === i ? "" : x))); }}
                      className="text-xs text-[#231714]/60 hover:underline"
                    >
                      変更
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      value={q}
                      onChange={(e) => setQuery((p) => p.map((x, idx) => (idx === i ? e.target.value : x)))}
                      placeholder="名前で検索して選択"
                      className="w-full px-2 py-1.5 text-sm border border-[#231714]/15 rounded-lg"
                    />
                    {list.length > 0 && (
                      <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#231714]/15 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        {list.map((c) => (
                          <li key={c.lineUserId}>
                            <button
                              onClick={() => { setSeat(i, { lineUserId: c.lineUserId }); setQuery((p) => p.map((x, idx) => (idx === i ? "" : x))); }}
                              className="w-full text-left px-3 py-2 text-sm hover:bg-[#f2f6f7]"
                            >
                              {c.displayName || "(名前未設定)"}
                              <span className="ml-2 text-[10px] text-[#231714]/60">{ROLE_LABEL[c.role] ?? c.role}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <input
                value={seat.points}
                onChange={(e) => setSeat(i, { points: e.target.value.replace(/[^\d-]/g, "") })}
                inputMode="numeric"
                placeholder="持ち点"
                className="w-28 px-2 py-1.5 text-sm text-right border border-[#231714]/15 rounded-lg tabular-nums"
              />
            </div>
          );
        })}
      </div>

      {/* 合計は常に出す。100,000 でないと集計対象にならないため。 */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <span className={totalOk ? "text-[#2f7d57] font-bold" : "text-[#d8533a] font-bold"}>
          合計 {total.toLocaleString()} 点 / {TABLE_TOTAL.toLocaleString()} 点
          {!totalOk && total !== 0 && `（${total > TABLE_TOTAL ? "+" : ""}${(total - TABLE_TOTAL).toLocaleString()}）`}
        </span>
        {!ranksOk && <span className="text-[#d8533a] font-bold">着順が重複しています</span>}
        {!dupOk && <span className="text-[#d8533a] font-bold">同じ人を複数の席に選んでいます</span>}
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={!canSave}
          className="px-4 py-2 text-sm font-bold text-white bg-[#231714] rounded-lg hover:bg-[#231714]/85 disabled:opacity-40"
        >
          {saving ? "保存中…" : "この卓を追加"}
        </button>
        <button
          onClick={reset}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-[#231714]/80 border border-[#231714]/15 rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          クリア
        </button>
      </div>
      {allSeatsFilled && (!totalOk || !ranksOk) && (
        <p className="mt-2 text-[11px] text-[#231714]/70">
          このまま保存すると「集計対象外」として記録され、通算順位には反映されません（あとから修正できます）。
        </p>
      )}
    </div>
  );
}
