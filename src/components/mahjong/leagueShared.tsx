"use client";

/**
 * 麻雀リーグUIの共有プリミティブ（定数・日付ヘルパー・アイコン・卓ボード）。
 * MahjongLeagueView / JoinTab / ReportTab から共用する（旧 MahjongLeagueView.tsx から分離）。
 */

import { Avatar } from "@/components/ui/LineContact";
import type { PublicMahjongTable, PublicMahjongTableMember } from "@/types";
export { todayJst } from "@/lib/date";

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

export function formatJpDate(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  void y;
  const dt = new Date(d + "T00:00:00");
  const w = ["日", "月", "火", "水", "木", "金", "土"][dt.getDay()];
  return `${m}/${day}(${w})`;
}

/**
 * 得点の符号トグル（＋/−）。持ち点欄は絶対値だけを受け、符号はここで持つ。
 * 既定は＋（プラス）。箱下（トビ・沈みマイナス）のときだけ − に切り替える。
 */
export function PointsSignToggle({
  sign,
  onChange,
  accent = ACCENT,
}: {
  sign: 1 | -1;
  onChange: (s: 1 | -1) => void;
  accent?: string;
}) {
  return (
    <div className="inline-flex rounded-xl overflow-hidden shrink-0" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9" }}>
      {([1, -1] as const).map((s) => {
        const active = sign === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={active}
            aria-label={s === 1 ? "プラス" : "マイナス"}
            className="w-10 py-2.5 text-[20px] font-black leading-none transition-all"
            style={active ? { background: accent, color: "#fff" } : { background: "#f6f8f9", color: "#97999d" }}
          >
            {s === 1 ? "＋" : "−"}
          </button>
        );
      })}
    </div>
  );
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
          <Seat key={i} m={m} me={m.isCurrentUser} />
        ))}
      </div>
    </div>
  );
}

/* 緑フェルト上の席 */
function Seat({ m, me }: { m: PublicMahjongTableMember; me: boolean }) {
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
        <Avatar src={m.pictureUrl} name={m.displayName} size={30} />
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
