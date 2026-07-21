"use client";

import { useCallback, useEffect, useState } from "react";
import { AUDIT_EVENT_LABEL, auditEventLabel, auditStatusLabel } from "@/lib/auditLabels";

/**
 * ゲーム運用の監査ログ（麻雀/ダーツ/ビリヤード共通）。
 * 種別は日本語ラベル＋補足説明で表示し、状態遷移も日本語化（可視性重視）。
 */

interface AuditLog {
  id: string;
  eventType: string;
  actor: string;
  target?: { date?: string; entryId?: string; tableId?: string };
  beforeStatus?: string | null;
  afterStatus?: string | null;
  meta?: Record<string, unknown>;
  createdAt: string;
}

type GameCategory = "mahjong" | "darts" | "billiards";
const GAME_NAME: Record<GameCategory, string> = { mahjong: "麻雀", darts: "ダーツ", billiards: "ビリヤード" };

const fmt = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const targetText = (t?: AuditLog["target"]) =>
  [t?.date && `開催日 ${t.date}`, t?.entryId && `参加ID ${t.entryId}`, t?.tableId && `卓 ${t.tableId}`].filter(Boolean).join(" / ") || "—";

export default function GameAuditPanel({ gameCategory }: { gameCategory: GameCategory }) {
  const [items, setItems] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");

  const load = useCallback(
    () =>
      fetch(`/api/admin/games/audit-logs?gameCategory=${gameCategory}${filter ? `&eventType=${filter}` : ""}`, { credentials: "same-origin" })
        .then((r) => r.json())
        .then((d) => setItems(d.items ?? []))
        .catch(() => {})
        .finally(() => setLoading(false)),
    [filter, gameCategory]
  );
  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-5 max-w-4xl">
      <h1 className="text-lg font-bold text-[#231714] mb-1">{GAME_NAME[gameCategory]} 監査ログ</h1>
      <p className="text-sm text-[#231714]/80 mb-4">
        返金・キャンセル・休催化・GM当日フロー（ゲーム開始／中止／本日終了 等）の操作履歴（新しい順）。
        種別は日本語で表示します。
      </p>

      <div className="flex items-center gap-2 mb-3">
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="text-sm border border-[#231714]/15 rounded-lg px-2 py-1.5 bg-white"
        >
          <option value="">すべての種別</option>
          {Object.entries(AUDIT_EVENT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.text}</option>
          ))}
        </select>
        <span className="text-xs text-[#231714]/80">{items.length} 件</span>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-[#231714]/80">読み込み中…</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#231714]/10 p-8 text-center text-sm text-[#231714]/80">
          監査ログはありません
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-xl border border-[#231714]/10">
            <thead>
              <tr className="text-left text-[11px] text-[#231714]/85 border-b border-[#231714]/10">
                <th className="px-3 py-2">時刻</th>
                <th className="px-3 py-2">操作（種別）</th>
                <th className="px-3 py-2">実行者</th>
                <th className="px-3 py-2">対象</th>
                <th className="px-3 py-2">状態の変化</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const l = auditEventLabel(it.eventType);
                const flagged = it.meta?.flagged === true;
                return (
                  <tr key={it.id} className="border-b border-[#231714]/5 last:border-0 align-top">
                    <td className="px-3 py-2 text-[11px] text-[#231714]/80 tabular-nums whitespace-nowrap">{fmt(it.createdAt)}</td>
                    <td className="px-3 py-2 min-w-[180px]">
                      <div className="flex items-center gap-1">
                        <span className="text-[11px] font-black px-1.5 py-0.5 rounded" style={{ color: l.color, background: `color-mix(in srgb, ${l.color} 12%, #fff)` }}>{l.text}</span>
                        {flagged && <span title={String(it.meta?.reason ?? "")}>⚠️</span>}
                      </div>
                      {l.desc && <div className="text-[10.5px] text-[#231714]/65 mt-0.5 leading-snug">{l.desc}</div>}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/85 max-w-[160px] truncate">{it.actor}</td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/80">{targetText(it.target)}</td>
                    <td className="px-3 py-2 text-[11px] text-[#231714]/80 whitespace-nowrap">
                      {it.beforeStatus || it.afterStatus ? `${auditStatusLabel(it.beforeStatus)} → ${auditStatusLabel(it.afterStatus)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
