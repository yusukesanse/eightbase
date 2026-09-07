"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/LineContact";
import { GlassCard, StatusPill } from "@/components/ui/eb";

/**
 * 当日の参加者名簿（ダーツ / ビリヤード）。
 * - **未払いの人も名簿には出る**が進行には参加しない（申告・順位計算の母数から外れる）。
 *   その場で参加費を払えば `paid` が true になり参加できる。GMが対面で督促する運用なので、
 *   誰が未払いかは参加者全員に見せる。
 * - 来ない人・払わない人は**GMが参加剥奪**できる（確定済みが出る前だけ。確定後は他の人の
 *   順位ptが変わってしまうためサーバー側で拒否される）。
 */

export interface DayRosterMember {
  lineUserId?: string; // GM にのみ渡る（剥奪に必要）
  displayName: string;
  pictureUrl?: string;
  isMe: boolean;
  paid: boolean;
}

export function DayRosterPanel({
  game,
  eventDate,
  members,
  isGameMaster,
  finished,
  onChanged,
}: {
  game: "darts" | "billiards";
  eventDate: string;
  members: DayRosterMember[];
  isGameMaster: boolean;
  finished: boolean;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (members.length === 0) return null;

  const unpaid = members.filter((m) => !m.paid);
  const iAmUnpaid = members.some((m) => m.isMe && !m.paid);

  const remove = async (m: DayRosterMember) => {
    if (!m.lineUserId) return;
    if (!confirm(`${m.displayName}さんを本日の参加者から外します。よろしいですか？`)) return;
    setBusyId(m.lineUserId);
    setError(null);
    try {
      const res = await fetch(`/api/${game}/day/participant`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate, targetUserId: m.lineUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "参加者を外せませんでした");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "参加者を外せませんでした");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <GlassCard padding="md" className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold text-[color:var(--eb-ink)] whitespace-nowrap">
          本日の参加者 {members.length}名
        </span>
        {unpaid.length > 0 && (
          <span className="text-[12px] font-bold text-[color:var(--eb-gold-text)] whitespace-nowrap shrink-0">未払い {unpaid.length}名</span>
        )}
      </div>

      {iAmUnpaid && (
        <p className="text-[12px] font-bold text-[color:var(--eb-gold-text)] rounded-xl px-3 py-2" style={{ background: "rgba(217,169,58,.14)" }}>
          参加費が未払いです。お支払いいただくと参加できます（「参加」タブからお支払いください）。
        </p>
      )}
      {isGameMaster && unpaid.length > 0 && (
        <p className="text-[12px] text-[color:var(--eb-ink-muted)]">
          未払いの方は進行に参加できません。その場でお支払いいただくか、参加されない場合は「外す」でリストから除いてください。
        </p>
      )}

      <ul className="flex flex-col gap-1.5">
        {members.map((m, i) => (
          <li key={m.lineUserId ?? `${m.displayName}-${i}`} className="flex items-center gap-2.5">
            <Avatar src={m.pictureUrl} name={m.displayName} size={28} />
            <span className="flex-1 min-w-0 text-[13px] font-bold text-[color:var(--eb-ink)] truncate">
              {m.displayName}
              {m.isMe && <span className="ml-1.5 text-[11px] font-bold text-[color:var(--eb-green-text)]">YOU</span>}
            </span>
            <StatusPill tone={m.paid ? "green" : "gold"}>{m.paid ? "支払い済み" : "未払い"}</StatusPill>
            {isGameMaster && !finished && !m.isMe && m.lineUserId && (
              <button
                type="button"
                disabled={busyId === m.lineUserId}
                onClick={() => remove(m)}
                className="shrink-0 rounded-lg border border-[color:var(--eb-line)] px-2.5 py-1 text-[11px] font-bold text-[color:var(--eb-coral-text)] disabled:opacity-40"
              >
                {busyId === m.lineUserId ? "…" : "外す"}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p className="text-[12px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}
    </GlassCard>
  );
}
