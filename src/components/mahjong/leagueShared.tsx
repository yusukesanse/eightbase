"use client";

/**
 * 麻雀リーグUIの共有プリミティブ（定数・日付ヘルパー・アイコン・卓ボード）。
 * MahjongLeagueView / JoinTab / ReportTab から共用する（旧 MahjongLeagueView.tsx から分離）。
 */

import { Avatar } from "@/components/ui/LineContact";
import { StatusPill } from "@/components/ui/eb";
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
  accent,
}: {
  sign: 1 | -1;
  onChange: (s: 1 | -1) => void;
  /** @deprecated 見た目は固定（選択中は白＋影）。互換のため受け取るが使わない。 */
  accent?: string;
}) {
  void accent;
  return (
    <div className="inline-flex gap-1 rounded-2xl p-1 shrink-0" style={{ background: "var(--eb-tint)" }}>
      {([1, -1] as const).map((s) => {
        const active = sign === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onChange(s)}
            aria-pressed={active}
            aria-label={s === 1 ? "プラス" : "マイナス"}
            className="w-12 h-[50px] rounded-xl text-[22px] font-black leading-none transition-all"
            style={
              active
                ? { background: "#fff", color: "var(--eb-ink)", boxShadow: "0 2px 8px rgba(20,41,31,.15)" }
                : { background: "transparent", color: "var(--eb-ink-muted)" }
            }
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

/** 卓内並び順から付与する仮の席風（東南西北）。サーバーは席順を持たないので表示専用。 */
const SEAT_WINDS = ["東", "南", "西", "北"] as const;

/* 卓ボード（席の一覧）。申告タブの卓確定表示で共用 */
export function TableBoard({ table }: { table: PublicMahjongTable }) {
  return (
    <div
      className="rounded-2xl p-3 border-[1.5px]"
      style={{ background: "rgba(35,147,94,.10)", borderColor: "rgba(35,147,94,.35)" }}
    >
      <div className="flex flex-col gap-2">
        {table.members.map((m, i) => (
          <Seat key={i} m={m} me={m.isCurrentUser} wind={SEAT_WINDS[i] ?? ""} />
        ))}
      </div>
    </div>
  );
}

/* 卓の1席分の行 */
function Seat({ m, me, wind }: { m: PublicMahjongTableMember; me: boolean; wind: string }) {
  const done = m.points !== null;
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-3 py-2.5"
      style={
        me
          ? { background: "rgba(255,255,255,.95)", border: "2px solid var(--eb-green)" }
          : { background: "rgba(255,255,255,.6)" }
      }
    >
      <span
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-[14px] font-bold"
        style={{ background: "var(--eb-ink)" }}
      >
        {wind}
      </span>
      <Avatar src={m.pictureUrl} name={m.displayName} size={30} />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold truncate text-[color:var(--eb-ink)]">
          {m.displayName}
          {me && <span className="ml-1 text-[11px] font-bold text-[color:var(--eb-green-text)]">（あなた）</span>}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1">
        {done ? (
          <>
            <span className="text-[15px] font-bold tabular-nums text-[color:var(--eb-ink)]">
              {m.points!.toLocaleString()}<span className="text-[11px] font-bold text-[color:var(--eb-ink-muted)]"> ・{m.rank}着</span>
            </span>
            <StatusPill tone="green">申告済み</StatusPill>
          </>
        ) : (
          <StatusPill tone="muted">未申告</StatusPill>
        )}
      </div>
    </div>
  );
}
