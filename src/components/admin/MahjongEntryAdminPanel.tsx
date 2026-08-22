"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { kanaIncludes } from "@/lib/kana";
import type { MahjongEntry } from "@/types";

/**
 * 管理者が開催日の参加者を管理するパネル（麻雀）。
 *
 * 主目的は「**すでに参加費を受け取っている人を、支払い済みとして当日の卓に入れる**」こと。
 * 支払い済みの人がミニアプリでキャンセルすると entry は cancelRequested/refunded になるが、
 * Square 側で返金していなければ入金は成立したまま。この人を戻す手段が今まで無かった
 * （受付締切後は利用者側から再表明できない）。
 *
 * ⚠️ 入金の照合はしない（現金・振替も足せるようにするため）。誰が足したかは監査ログに残る。
 * 追加された人は次の半荘から GM の卓振り分けプールに出る（プールは毎回 entries から作り直すため）。
 */

interface Candidate {
  lineUserId: string;
  displayName: string;
  role: string;
  pictureUrl: string;
}

type EntryRow = MahjongEntry & { derivedStatus: string };

const ROLE_LABEL: Record<string, string> = { member: "会員", staff: "社員", guest: "ゲスト" };

/** 参加状態 → バッジの見た目。追加前に「今どの状態か」を管理者へ見せる。 */
const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  paid: { text: "支払い済み", cls: "bg-[#2f7d57]/10 text-[#2f7d57]" },
  reserved: { text: "未払い", cls: "bg-[#a1502c]/10 text-[#a1502c]" },
  cancelRequested: { text: "キャンセル依頼中", cls: "bg-[#c0563c]/10 text-[#c0563c]" },
  refunded: { text: "返金済み", cls: "bg-gray-100 text-gray-600" },
  cancelRejected: { text: "却下（参加継続）", cls: "bg-gray-100 text-gray-600" },
};

function statusBadge(status: string) {
  return STATUS_BADGE[status] ?? { text: status, cls: "bg-gray-100 text-gray-600" };
}

export default function MahjongEntryAdminPanel({
  seasonId,
  eventDate,
}: {
  seasonId: string;
  eventDate: string | null;
}) {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  /** GET が返すアクティブシーズン。ページのシーズンと違えば追加させない。 */
  const [activeSeasonId, setActiveSeasonId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    if (!eventDate) {
      setEntries([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/mahjong/entries?eventDate=${eventDate}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await res.json();
      setEntries(data.entries ?? []);
      setActiveSeasonId(data.seasonId ?? null);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [eventDate]);

  useEffect(() => {
    load();
  }, [load]);

  // 候補はアプリ利用者すべて（ゲスト含む）。ゲストを外さないこと（救済対象に含まれる）。
  useEffect(() => {
    if (candidates.length > 0) return;
    fetch("/api/admin/games/participants", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setCandidates(d.participants ?? []))
      .catch(() => {});
  }, [candidates.length]);

  const entryByUser = useMemo(
    () => new Map(entries.map((e) => [e.lineUserId, e])),
    [entries]
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return candidates
      .filter((c) => kanaIncludes(c.displayName, query))
      .slice(0, 8);
  }, [candidates, query]);

  const seasonMismatch = !!activeSeasonId && activeSeasonId !== seasonId;
  const paidCount = entries.filter((e) => e.derivedStatus === "paid").length;

  async function addPaid(c: Candidate) {
    if (!eventDate) return;
    const current = entryByUser.get(c.lineUserId);
    if (current?.derivedStatus === "paid") {
      setMessage({ ok: false, text: `${c.displayName} さんはすでに支払い済みです` });
      return;
    }
    const warn = current
      ? `${c.displayName} さんは現在「${statusBadge(current.derivedStatus).text}」です。\n支払い済みとして参加者に戻しますか？`
      : `${c.displayName} さんを「支払い済み」として追加しますか？\n（参加費を受け取り済みであることを確認してください）`;
    if (!confirm(warn)) return;

    setBusyId(c.lineUserId);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/mahjong/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ seasonId, eventDate, lineUserId: c.lineUserId, markPaid: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ ok: false, text: data.error || "追加に失敗しました" });
        return;
      }
      setMessage({ ok: true, text: `${c.displayName} さんを支払い済みで追加しました` });
      setQuery("");
      await load();
    } catch {
      setMessage({ ok: false, text: "追加に失敗しました" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(e: EntryRow) {
    if (!eventDate) return;
    if (
      !confirm(
        `${e.displayName} さんをこの開催日の参加者から削除しますか？\n（返金は行いません。必要なら Square 側で別途対応してください）`
      )
    )
      return;
    setBusyId(e.lineUserId);
    try {
      const res = await fetch(
        `/api/admin/mahjong/entries?eventDate=${eventDate}&lineUserId=${encodeURIComponent(e.lineUserId)}`,
        { method: "DELETE", credentials: "same-origin" }
      );
      if (!res.ok) {
        setMessage({ ok: false, text: "削除に失敗しました" });
        return;
      }
      setMessage({ ok: true, text: `${e.displayName} さんを削除しました` });
      await load();
    } catch {
      setMessage({ ok: false, text: "削除に失敗しました" });
    } finally {
      setBusyId(null);
    }
  }

  if (!eventDate) {
    return (
      <div className="bg-white rounded-xl border border-[#231714]/10 p-10 text-center text-sm text-[#231714]/80">
        開催日を選んでください
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {seasonMismatch && (
        <div className="rounded-lg bg-[#c0563c]/10 border border-[#c0563c]/20 px-4 py-3 text-xs text-[#c0563c]">
          このページは開催中でないシーズンです。参加者の追加・削除は開催中のシーズンでのみ行えます。
        </div>
      )}

      {/* ───── 支払い済みで追加 ───── */}
      <div className="bg-white rounded-xl border border-[#231714]/10 p-4">
        <div className="text-sm font-bold text-[#231714] mb-1">支払い済みで参加者を追加</div>
        <p className="text-[11px] leading-relaxed text-[#231714]/70 mb-3">
          参加費をすでに受け取っている人を、この開催日の参加者（支払い済み）として追加します。
          <strong>受付締切後（ゲーム開始後）でも追加できます</strong>
          — 次の半荘からGMの卓振り分けに出ます。
          <br />
          入金の自動照合は行いません。実行内容は監査ログに残ります。
        </p>
        <input
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
          placeholder="名前で検索（ひらがな・カタカナ可）"
          disabled={seasonMismatch}
          className="w-full px-3 py-2 text-sm border border-[#231714]/15 rounded-lg bg-white disabled:bg-gray-50"
        />
        {searchResults.length > 0 && (
          <ul className="mt-2 border border-[#231714]/10 rounded-lg divide-y divide-[#231714]/5 overflow-hidden">
            {searchResults.map((c) => {
              const cur = entryByUser.get(c.lineUserId);
              const already = cur?.derivedStatus === "paid";
              return (
                <li key={c.lineUserId} className="flex items-center gap-2 px-3 py-2">
                  {c.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#4f757e]">
                      {c.displayName.charAt(0)}
                    </div>
                  )}
                  <span className="text-sm text-[#231714] flex-1">{c.displayName}</span>
                  <span className="text-[10px] text-[#231714]/60">{ROLE_LABEL[c.role] ?? c.role}</span>
                  {cur && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${statusBadge(cur.derivedStatus).cls}`}>
                      {statusBadge(cur.derivedStatus).text}
                    </span>
                  )}
                  <button
                    onClick={() => addPaid(c)}
                    disabled={already || busyId === c.lineUserId || seasonMismatch}
                    className="px-3 py-1.5 text-xs font-bold text-[#231714] bg-[#B0E401] rounded-lg hover:opacity-90 disabled:opacity-40"
                  >
                    {already ? "追加済み" : busyId === c.lineUserId ? "追加中..." : "支払い済みで追加"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {message && (
          <div className={`mt-2 text-xs ${message.ok ? "text-[#2f7d57]" : "text-[#c0563c]"}`}>
            {message.text}
          </div>
        )}
      </div>

      {/* ───── この開催日の参加者 ───── */}
      <div className="bg-white rounded-xl border border-[#231714]/10 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#231714]/5">
          <div className="text-sm font-bold text-[#231714]">この開催日の参加者</div>
          <div className="text-xs text-[#231714]/70">
            {entries.length}名（支払い済み {paidCount}名）
          </div>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-[#231714]/60">読み込み中...</div>
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-sm text-[#231714]/80">参加者はまだいません</div>
        ) : (
          <ul className="divide-y divide-[#231714]/5">
            {entries.map((e) => {
              const b = statusBadge(e.derivedStatus);
              return (
                <li key={e.entryId} className="flex items-center gap-2 px-4 py-3">
                  {e.pictureUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center text-[10px] font-bold text-[#4f757e]">
                      {e.displayName.charAt(0)}
                    </div>
                  )}
                  <span className="text-sm font-medium text-[#231714] flex-1">{e.displayName}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${b.cls}`}>{b.text}</span>
                  <button
                    onClick={() => remove(e)}
                    disabled={busyId === e.lineUserId || seasonMismatch}
                    className="px-2 py-1 text-[11px] text-[#c0563c] hover:bg-[#c0563c]/5 rounded disabled:opacity-40"
                  >
                    削除
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
