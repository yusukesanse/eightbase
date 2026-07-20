"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import DatePicker from "@/components/ui/DatePicker";
import type { BilliardsCsEvent } from "@/types/billiards";

/**
 * ビリヤードCS 管理（作成・一覧）。8ボール1対1・GMなし完全自動進行なので、管理は
 * 「名称＋エントリー締切日（=自動ブラケット生成の起点）」を作るだけ。進行・確定は不要。
 * 誰でも参加可なので entrants は空で開始し、利用者が「CS」タブから自己エントリーする。
 */
export default function BilliardsCsAdmin() {
  const { seasonId } = useParams<{ seasonId: string }>();
  const [events, setEvents] = useState<BilliardsCsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("シーズンチャンピオンシップ");
  const [eventDate, setEventDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/billiards/cs?seasonId=${seasonId}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => setEvents(d.events ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [seasonId]);
  useEffect(() => { load(); }, [load]);

  async function create() {
    if (!name.trim() || !eventDate) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/billiards/cs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: name.trim(), eventDate }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg({ ok: false, text: d.error ?? "作成に失敗しました" });
      else { setMsg({ ok: true, text: "CSを作成しました" }); setEventDate(""); load(); }
    } finally {
      setBusy(false);
    }
  }

  const STATUS_LABEL: Record<string, string> = { setup: "エントリー受付中", running: "進行中", finished: "終了" };

  return (
    <div className="p-4 flex flex-col gap-4 max-w-2xl">
      <p className="text-sm text-[#231714]/80 leading-relaxed">
        チャンピオンシップは<b>8ボール1対1・GMなしの完全自動進行</b>です。名称と<b>エントリー締切日</b>を設定して作成すると、
        締切日の到来で自動的にシングルエリミネーションのトーナメント表が生成されます（リーグ上位者は端数の回に不戦勝シード）。
        参加は利用者が「CS」タブから自己エントリーします（誰でも参加可・無料）。勝者は対戦者どちらでも申告できます。
      </p>

      {msg && <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${msg.ok ? "bg-[#eef6f0] text-[#2f7d57]" : "bg-[#fdece8] text-[#d8533a]"}`}>{msg.text}</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex flex-col gap-3">
        <div className="text-sm font-bold text-[#231714]">CSを作成</div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-bold text-[#231714]/70">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#231714]/70">エントリー締切日（自動生成の起点）</label>
            <DatePicker value={eventDate} onChange={setEventDate} placeholder="締切日を選択" />
          </div>
          <button onClick={create} disabled={busy || !name.trim() || !eventDate} className="rounded-xl bg-[#2f7d57] text-white text-sm font-bold px-4 py-2 disabled:opacity-40">作成</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <div className="text-sm font-bold text-[#231714] mb-2">CS一覧（{events.length}件）</div>
        {loading ? (
          <div className="py-6 flex justify-center"><div className="w-5 h-5 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
        ) : events.length === 0 ? (
          <div className="py-6 text-center text-sm text-[#231714]/70">まだCSがありません。</div>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {events.map((e) => (
              <li key={e.csEventId} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="text-sm font-bold text-[#231714]">{e.name}</div>
                  <div className="text-xs text-[#231714]/70">締切 {e.eventDate}・エントリー {e.entrants?.length ?? 0}名</div>
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: "#eef6f0", color: "#2f7d57" }}>{STATUS_LABEL[e.status] ?? e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
