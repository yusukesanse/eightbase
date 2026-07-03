"use client";

/**
 * 麻雀リーグUIの共有プリミティブ（定数・日付ヘルパー・アイコン・卓ボード）。
 * MahjongLeagueView / JoinTab / ReportTab から共用する（旧 MahjongLeagueView.tsx から分離）。
 */

import { Avatar } from "@/components/ui/LineContact";
import type { PublicMahjongTable, PublicMahjongTableMember } from "@/types";

// 卓の席順（卓内の並び順から東南西北を割り当て）
export const SEATS = ["東", "南", "西", "北"] as const;
// 麻雀リーグのアクセント（フェルト緑系・TILES案）
export const ACCENT = "#2f7d57";
// 卓確定の色（CSメダル金系・参加中の緑と区別する）
export const CONFIRM = "#b48f13";

export function dateParts(d: string): { md: string; wd: string } {
  const parts = d.split("-").map(Number);
  const dt = new Date(d + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return { md: `${parts[1]}/${parts[2]}`, wd: w };
}

export function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

export function formatJpDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  void y;
  const dt = new Date(d + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return `${m}/${day}(${w})`;
}

export function CheckIcon({ color = "#fff", size = 15 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

export function ChevronRight({ color = "#fff", size = 14 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/* 緑フェルトの卓ボード（席グリッド）。申告タブと参加タブの卓確定表示で共用 */
export function TableBoard({ table }: { table: PublicMahjongTable }) {
  return (
    <div
      className="rounded-[20px] p-4"
      style={{
        background: "radial-gradient(120% 90% at 50% 30%, #2f7d57, #1c4d36)",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08), inset 0 0 50px rgba(0,0,0,.28)",
      }}
    >
      {table.tableLabel && (
        <div className="text-center text-white/90 text-[12px] font-extrabold tracking-[0.1em] mb-3">{table.tableLabel}卓</div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {table.members.map((m, i) => (
          <Seat key={i} m={m} seat={SEATS[i] ?? ""} me={m.isCurrentUser} />
        ))}
      </div>
    </div>
  );
}

/* 緑フェルト上の席（東南西北） */
function Seat({ m, seat, me }: { m: PublicMahjongTableMember; seat: string; me: boolean }) {
  const done = m.points !== null;
  return (
    <div
      className="rounded-[14px] p-3 relative"
      style={
        me
          ? { background: "rgba(255,255,255,.96)", boxShadow: "0 4px 12px rgba(0,0,0,.25)" }
          : { background: "rgba(255,255,255,.1)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.16)" }
      }
    >
      <div className="flex items-center gap-2">
        <div className="relative">
          <Avatar src={m.pictureUrl} name={m.displayName} size={30} />
          <span
            className="absolute -left-1 -top-1.5 w-4 h-4 rounded-full text-white text-[10px] font-black flex items-center justify-center"
            style={{ background: "#d8533a", boxShadow: "0 0 0 1.5px rgba(255,255,255,.9)" }}
          >
            {seat}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-extrabold truncate" style={{ color: me ? "#1c1f21" : "#fff" }}>{m.displayName}</div>
          <div className="text-[10.5px] font-bold" style={{ color: me ? "#97999d" : "rgba(255,255,255,.7)" }}>
            {me ? "あなた" : done ? "申告済み" : "申告待ち"}
          </div>
        </div>
      </div>
      {done && (
        <div className="flex items-baseline justify-between mt-2">
          <span className="text-[16px] font-black tabular-nums" style={{ color: me ? "#1c1f21" : "#fff" }}>
            {m.points!.toLocaleString()}
          </span>
          <span className="text-[11px] font-extrabold" style={{ color: me ? "#97999d" : "rgba(255,255,255,.8)" }}>{m.rank}着</span>
        </div>
      )}
    </div>
  );
}
