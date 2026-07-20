"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { DARTS_ACCENT } from "@/components/darts/dartsShared";
import {
  DARTS_EVENT_LABEL,
  DARTS_MIN_PARTICIPANTS,
  type DartsEventKind,
  type DartsZeroOneOut,
} from "@/types/darts";

/**
 * ダーツ GM 専用パネル（当日進行の中核）。麻雀 MahjongGmAssignPanel の読み替え。
 * 麻雀の「半荘ローテーション」と違い、ダーツは **3種目の直線ウィザード**:
 *   ゲーム開始 → ①ゼロワン種別選択 → 各自申告(GM代理可) → ②カウントアップ申告
 *   → ③クリケット編成(ドラッグ&ドロップ) → チーム申告 → 本日終了。
 * チーム編成のみ Pointer Events のドラッグ（麻雀と同じ手法・タッチ/マウス共通）を流用する。
 */

interface DayMemberGm {
  lineUserId: string;
  displayName: string;
  pictureUrl?: string;
  isMe: boolean;
}
interface EventStateDto {
  kind: DartsEventKind;
  status: "pending" | "reporting" | "confirmed";
  reportedCount: number;
  total: number;
  myReported: boolean;
  results:
    | { lineUserId?: string; displayName: string; isMe: boolean; value: number | null; rank: number | null; points: number; teamId?: string }[]
    | null;
}
interface CricketTeamDto {
  teamId: string;
  memberIds?: string[];
  members: { displayName: string; isMe: boolean }[];
  isMine: boolean;
}
interface DayDto {
  started: boolean;
  finished: boolean;
  isGameMaster: boolean;
  participants: DayMemberGm[];
  paidCount: number;
  events: EventStateDto[] | null;
  zeroOneVariant: { start: number; out: DartsZeroOneOut } | null;
  cricketTeams: CricketTeamDto[];
}

const OUT_LABEL: Record<DartsZeroOneOut, string> = { single: "シングルアウト", double: "ダブルアウト", master: "マスターアウト" };
const START_OPTIONS = [301, 501, 701];

async function postDay(path: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/api/darts/day/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, error: data.error };
}

/* ───────── ドラッグ用プリミティブ（トップレベル memo・崩すと追従がカクつく） ───────── */

const DRAG_THRESHOLD = 6;

function zoneAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const z = el?.closest("[data-zone]")?.getAttribute("data-zone");
  return z && (z === "pool" || /^t\d+$/.test(z)) ? z : null;
}

const Chip = memo(function Chip({
  id, name, selected, dragging, onPointerDown,
}: {
  id: string;
  name: string;
  selected: boolean;
  dragging: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, id); }}
      className={`inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white border select-none ${dragging ? "opacity-30" : ""} cursor-grab active:cursor-grabbing`}
      style={{
        touchAction: "none",
        borderColor: selected ? DARTS_ACCENT : "#e4e7e9",
        color: "#231714",
        boxShadow: selected ? `0 0 0 2px ${DARTS_ACCENT}` : "0 1px 2px rgba(35,23,20,.06)",
      }}
    >
      {name}
    </button>
  );
});

const DropZone = memo(function DropZone({
  zone, label, count, cap, lit, over, armed, onZoneClick, children,
}: {
  zone: string;
  label: string;
  count: number;
  cap?: number;
  lit: boolean;
  over: boolean;
  armed: boolean;
  onZoneClick: (z: string) => void;
  children: React.ReactNode;
}) {
  const isPool = zone === "pool";
  return (
    <div
      data-zone={zone}
      onClick={() => onZoneClick(zone)}
      className={`rounded-2xl border border-dashed p-2.5 transition-colors ${isPool ? "min-h-[56px]" : "min-h-[64px]"} ${armed ? "cursor-pointer" : ""}`}
      style={{
        borderColor: over ? "#d8533a" : lit ? DARTS_ACCENT : isPool ? "#e4e7e9" : "#c9d6cf",
        background: lit ? `color-mix(in srgb, ${DARTS_ACCENT} 10%, #fff)` : isPool ? "#fff" : "#f7faf8",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-extrabold" style={{ color: over ? "#d8533a" : "#3f4247" }}>
          {label}{cap != null ? `（${count}/${cap}）` : `（${count}）`}
        </span>
        {lit && <span className="text-[10px] font-bold" style={{ color: DARTS_ACCENT }}>{isPool ? "ここに戻す" : "ここに置く"}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
});

/* ───────── パネル本体 ───────── */

export function DartsGmPanel({ eventDate, onChanged }: { eventDate: string; onChanged: () => void }) {
  const [day, setDay] = useState<DayDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/darts/day?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d.error) setError(d.error); else { setDay(d); setError(null); } })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(async () => { await load(); onChanged(); }, [load, onChanged]);

  if (loading) {
    return (
      <div className="rounded-2xl border-2 p-4" style={{ borderColor: DARTS_ACCENT }}>
        <div className="flex justify-center py-4"><div className="w-5 h-5 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
      </div>
    );
  }
  if (!day) return null;

  const events = day.events;
  const ev = (k: DartsEventKind) => events?.find((e) => e.kind === k);
  const zeroOne = ev("zeroOne");
  const countUp = ev("countUp");
  const cricket = ev("cricket");

  // フェーズ判定（サーバーの各種目 status が唯一の真実）。
  let phase: "start" | "variant" | "report:zeroOne" | "report:countUp" | "assign" | "report:cricket" | "finish" | "finished";
  if (!day.started) phase = "start";
  else if (day.finished) phase = "finished";
  else if (zeroOne?.status === "pending") phase = "variant";
  else if (zeroOne?.status === "reporting") phase = "report:zeroOne";
  else if (countUp?.status === "reporting") phase = "report:countUp";
  else if (countUp?.status === "confirmed" && cricket?.status === "pending") phase = "assign";
  else if (cricket?.status === "reporting") phase = "report:cricket";
  else phase = "finish";

  const header =
    phase === "start" ? "ゲーム開始（GM）"
    : phase === "finished" ? "本日の対局は終了しました"
    : phase === "variant" ? "①ゼロワン 種別選択（GM）"
    : phase === "report:zeroOne" ? "①ゼロワン 申告"
    : phase === "report:countUp" ? "②カウントアップ 申告"
    : phase === "assign" ? "③クリケット チーム編成（GM）"
    : phase === "report:cricket" ? "③クリケット 申告"
    : "本日終了（GM）";

  return (
    <div className="rounded-2xl border-2 p-4 flex flex-col gap-3" style={{ borderColor: DARTS_ACCENT, background: `color-mix(in srgb, ${DARTS_ACCENT} 5%, #fff)` }}>
      <div className="text-[13px] font-black" style={{ color: DARTS_ACCENT }}>{header}</div>
      {error && <div className="text-[11px] font-bold text-[#d8533a] bg-[#fdece8] rounded-lg px-3 py-2">{error}</div>}

      {phase === "start" && <StartPhase day={day} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {phase === "variant" && <VariantPhase eventDate={eventDate} onDone={refresh} setError={setError} />}
      {(phase === "report:zeroOne" || phase === "report:countUp") && (
        <IndividualReportPhase day={day} ev={phase === "report:zeroOne" ? zeroOne! : countUp!} eventDate={eventDate} onDone={refresh} setError={setError} />
      )}
      {phase === "assign" && <CricketAssignPhase day={day} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {phase === "report:cricket" && <CricketReportPhase day={day} ev={cricket!} eventDate={eventDate} onDone={refresh} setError={setError} />}
      {phase === "finish" && <FinishPhase eventDate={eventDate} onDone={refresh} setError={setError} />}
      {phase === "finished" && (
        <p className="text-[12px] text-[#231714]/80 leading-relaxed">
          3種目すべて終了しました。結果は「リーグ」タブの順位に反映されます。おつかれさまでした。
        </p>
      )}
    </div>
  );
}

/* ───────── 開始前: 受付締切＋中止 ───────── */

function StartPhase({ day, eventDate, onDone, setError }: { day: DayDto; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [starting, setStarting] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const start = async () => {
    setStarting(true); setError(null);
    const r = await postDay("start", { eventDate });
    if (!r.ok) setError(r.error ?? "ゲーム開始に失敗しました");
    else await onDone();
    setStarting(false);
  };
  const cancel = async () => {
    setCancelling(true); setError(null);
    const r = await postDay("cancel", { eventDate });
    if (!r.ok) setError(r.error ?? "中止に失敗しました");
    else { setConfirmCancel(false); await onDone(); }
    setCancelling(false);
  };

  return (
    <>
      <p className="text-[11px] text-[#231714]/80 leading-relaxed">
        「ゲーム開始」を押すと<b>受付を締め切ります</b>。以降は参加表明・参加費の支払いはできません。
        そのときの支払い済みメンバーで進めます。
      </p>
      <div className="rounded-2xl border border-dashed p-2.5" style={{ borderColor: "#e4e7e9", background: "#fff" }}>
        <div className="text-[11px] font-extrabold text-[#3f4247] mb-1.5">支払い済み（{day.paidCount}名）</div>
        <div className="flex flex-wrap gap-1.5">
          {day.participants.length === 0 ? (
            <span className="text-[11px] text-[#231714]/75">まだいません</span>
          ) : (
            day.participants.map((m) => (
              <span key={m.lineUserId} className="inline-flex items-center rounded-2xl px-3 min-h-[36px] text-[13px] font-bold bg-white border" style={{ borderColor: "#e4e7e9", color: "#231714" }}>
                {m.displayName}
              </span>
            ))
          )}
        </div>
      </div>
      <button onClick={start} disabled={starting || day.paidCount < DARTS_MIN_PARTICIPANTS} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: DARTS_ACCENT }}>
        {starting ? "開始中…" : "ゲーム開始（受付を締め切る）"}
      </button>
      {day.paidCount < DARTS_MIN_PARTICIPANTS && (
        <p className="text-[10.5px] text-[#231714]/85 text-center">支払い済みが{DARTS_MIN_PARTICIPANTS}名以上になると開始できます。</p>
      )}

      {!confirmCancel ? (
        <button onClick={() => setConfirmCancel(true)} className="text-[10.5px] font-bold text-[#c0563c] underline underline-offset-2 self-center">
          この開催日を中止（流会）にする
        </button>
      ) : (
        <div className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: "#e9b7ab", background: "#fdece8" }}>
          <p className="text-[11px] font-bold text-[#c0563c] leading-relaxed">
            この開催日を中止します。支払い済みの{day.paidCount}名は<b>返金対象</b>になり、管理者に返金依頼が飛びます。取り消せません。
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmCancel(false)} disabled={cancelling} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-white disabled:opacity-40" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}>やめる</button>
            <button onClick={cancel} disabled={cancelling} className="flex-1 py-2.5 rounded-xl text-[13px] font-black text-white disabled:opacity-40" style={{ background: "#c0563c" }}>{cancelling ? "中止中…" : "中止する"}</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ───────── ①ゼロワン 種別選択 ───────── */

function VariantPhase({ eventDate, onDone, setError }: { eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [start, setStart] = useState(301);
  const [out, setOut] = useState<DartsZeroOneOut>("double");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true); setError(null);
    const r = await postDay("variant", { eventDate, start, out });
    if (!r.ok) setError(r.error ?? "種別の設定に失敗しました");
    else await onDone();
    setBusy(false);
  };

  return (
    <>
      <p className="text-[11px] text-[#231714]/80">ゼロワンの元数とアウト条件を選び、申告受付を開始します。</p>
      <div className="text-[11px] font-extrabold text-[#3f4247]">元数</div>
      <div className="flex gap-2">
        {START_OPTIONS.map((s) => (
          <button key={s} onClick={() => setStart(s)} className="flex-1 py-2.5 rounded-xl text-[15px] font-black transition-all"
            style={start === s ? { background: DARTS_ACCENT, color: "#fff" } : { background: "#f6f8f9", color: "#40434a", boxShadow: "inset 0 0 0 1px #e4e7e9" }}>
            {s}
          </button>
        ))}
      </div>
      <div className="text-[11px] font-extrabold text-[#3f4247]">アウト条件</div>
      <div className="flex gap-2">
        {(["single", "double", "master"] as DartsZeroOneOut[]).map((o) => (
          <button key={o} onClick={() => setOut(o)} className="flex-1 py-2.5 rounded-xl text-[12px] font-bold transition-all"
            style={out === o ? { background: DARTS_ACCENT, color: "#fff" } : { background: "#f6f8f9", color: "#40434a", boxShadow: "inset 0 0 0 1px #e4e7e9" }}>
            {OUT_LABEL[o]}
          </button>
        ))}
      </div>
      <button onClick={submit} disabled={busy} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: DARTS_ACCENT }}>
        {busy ? "設定中…" : "この種別で申告を開始"}
      </button>
    </>
  );
}

/* ───────── 個人種目（ゼロワン/カウントアップ）の申告進捗＋GM代理入力 ───────── */

function IndividualReportPhase({ day, ev, eventDate, onDone, setError }: { day: DayDto; ev: EventStateDto; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const reportedBy = new Map((ev.results ?? []).map((r) => [r.displayName, r]));
  const label = ev.kind === "zeroOne" ? "最終残り点数（少ないほど上位・0＝上がり）" : "合計点";
  const hint = day.zeroOneVariant && ev.kind === "zeroOne" ? `（${day.zeroOneVariant.start}／${OUT_LABEL[day.zeroOneVariant.out]}）` : "";

  const submit = async (uid: string) => {
    const raw = draft[uid];
    if (raw === undefined || raw === "") return;
    setBusy(uid); setError(null);
    const r = await postDay("report", { eventDate, kind: ev.kind, value: Number(raw), targetUserId: uid });
    if (!r.ok) setError(r.error ?? "申告に失敗しました");
    else { setDraft((d) => ({ ...d, [uid]: "" })); await onDone(); }
    setBusy(null);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#3c4f54]">{DARTS_EVENT_LABEL[ev.kind]}{hint}</span>
        <span className="text-[10px] font-bold text-[#3c4f54] tabular-nums">申告 {ev.reportedCount}/{ev.total}</span>
      </div>
      <p className="text-[10.5px] text-[#231714]/80">各自がアプリで申告します。GM は代理入力・修正できます。{label}。全員そろうと自動で確定し、次に進みます。</p>
      <div className="flex flex-col gap-1.5">
        {day.participants.map((m) => {
          const done = reportedBy.get(m.displayName);
          return (
            <div key={m.lineUserId} className="flex items-center gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: done ? DARTS_ACCENT : "#e4e7e9", background: done ? `color-mix(in srgb, ${DARTS_ACCENT} 6%, #fff)` : "#fff" }}>
              <span className="text-[12.5px] font-bold text-[#1c1f21] flex-1 min-w-0 truncate">{m.displayName}</span>
              {done && <span className="text-[11px] font-bold tabular-nums" style={{ color: DARTS_ACCENT }}>{done.value ?? "棄権"}</span>}
              <input
                type="text" inputMode="numeric" placeholder={done ? "修正" : "入力"}
                value={draft[m.lineUserId] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [m.lineUserId]: e.target.value.replace(/[^\d]/g, "") }))}
                className="w-16 text-right border-b outline-none bg-transparent text-[14px] font-black tabular-nums text-[#1c1f21] py-0.5"
                style={{ borderColor: draft[m.lineUserId] ? DARTS_ACCENT : "#e4e7e9" }}
              />
              <button onClick={() => submit(m.lineUserId)} disabled={busy === m.lineUserId || !draft[m.lineUserId]} className="shrink-0 text-[11px] font-black px-2.5 py-1.5 rounded-lg text-white disabled:opacity-30" style={{ background: DARTS_ACCENT }}>
                登録
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ───────── ③クリケット チーム編成（ドラッグ&ドロップ） ───────── */

function CricketAssignPhase({ day, eventDate, onDone, setError }: { day: DayDto; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const participants = day.participants;
  const n = participants.length;
  const teamCount = Math.ceil(n / 2);
  const zones = ["pool", ...Array.from({ length: teamCount }, (_, i) => `t${i}`)];

  // 初期配置: 参加者順に2人ずつペア（奇数は最後が1人）。GM が調整可。
  const [place, setPlace] = useState<Record<string, string>>(() => {
    const p: Record<string, string> = {};
    participants.forEach((m, i) => { p[m.lineUserId] = `t${Math.floor(i / 2)}`; });
    return p;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; from: string; zone: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const ghostRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ id: string; from: string; x: number; y: number; moved: boolean } | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  const hoverZone = useRef<string | null>(null);

  const nameOf = (id: string) => participants.find((m) => m.lineUserId === id)?.displayName ?? "";
  const inZone = (z: string) => participants.filter((m) => (place[m.lineUserId] ?? "pool") === z);

  const move = useCallback((id: string, zone: string) => {
    setSelectedId(null);
    setPlace((p) => ({ ...p, [id]: zone }));
  }, []);

  const tick = useCallback(() => {
    raf.current = null;
    const { x, y } = point.current;
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(1.06)`;
    const z = zoneAt(x, y);
    if (z !== hoverZone.current) { hoverZone.current = z; setDrag((d) => (d ? { ...d, zone: z } : d)); }
  }, []);
  const schedule = useCallback(() => { if (raf.current == null) raf.current = requestAnimationFrame(tick); }, [tick]);
  const cleanup = useCallback(() => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    press.current = null; hoverZone.current = null; setDrag(null);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      point.current = { x: e.clientX, y: e.clientY };
      if (!p.moved) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        p.moved = true; setSelectedId(null); hoverZone.current = p.from; setDrag({ id: p.id, from: p.from, zone: p.from });
      }
      e.preventDefault(); schedule();
    };
    const onUp = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (p.moved) { const z = zoneAt(e.clientX, e.clientY); if (z && z !== p.from) move(p.id, z); }
      else setSelectedId((cur) => (cur === p.id ? null : p.id));
      cleanup();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", cleanup);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", cleanup);
    };
  }, [move, schedule, cleanup]);

  const onPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    point.current = { x: e.clientX, y: e.clientY };
    press.current = { id, from: place[id] ?? "pool", x: e.clientX, y: e.clientY, moved: false };
  }, [place]);

  const onZoneClick = useCallback((zone: string) => {
    if (!selectedId) return;
    if ((place[selectedId] ?? "pool") === zone) return;
    move(selectedId, zone);
  }, [selectedId, place, move]);

  const isLit = (zone: string) => {
    if (drag) return drag.zone === zone && drag.from !== zone;
    return selectedId != null && (place[selectedId] ?? "pool") !== zone;
  };
  const isArmed = (zone: string) => !drag && selectedId != null && (place[selectedId] ?? "pool") !== zone;

  // 妥当性: 各チーム1〜2名・全員配置・1人チームは (人数 % 2) 組だけ（サーバー validateCricketTeams と一致）。
  const teamSizes = Array.from({ length: teamCount }, (_, i) => inZone(`t${i}`).length);
  const unplaced = inZone("pool").length;
  const soloCount = teamSizes.filter((s) => s === 1).length;
  const sizeOk = teamSizes.every((s) => s >= 1 && s <= 2);
  const valid = unplaced === 0 && sizeOk && soloCount === n % 2;

  const confirm = async () => {
    setBusy(true); setError(null);
    const teams = Array.from({ length: teamCount }, (_, i) => ({
      teamId: `t${i}`,
      memberIds: inZone(`t${i}`).map((m) => m.lineUserId),
    })).filter((t) => t.memberIds.length > 0);
    const r = await postDay("assign", { eventDate, teams });
    if (!r.ok) setError(r.error ?? "編成の確定に失敗しました");
    else await onDone();
    setBusy(false);
  };

  const renderChip = (id: string) => (
    <Chip key={id} id={id} name={nameOf(id)} selected={selectedId === id} dragging={drag?.id === id} onPointerDown={onPointerDown} />
  );
  const dragName = drag ? nameOf(drag.id) : "";

  return (
    <>
      <p className="text-[10.5px] text-[#231714]/85">
        {selectedId ? "置きたいチームをタップしてください。" : "参加者を指でつまんでチームへ運びます（2人1組・奇数のみ1人チーム1組）。タップで選んでチームをタップしても移動できます。"}
      </p>

      <DropZone zone="pool" label="未配置" count={inZone("pool").length} lit={isLit("pool")} over={false} armed={isArmed("pool")} onZoneClick={onZoneClick}>
        {inZone("pool").length === 0 ? <span className="text-[11px] text-[#231714]/75">全員配置済み</span> : inZone("pool").map((m) => renderChip(m.lineUserId))}
      </DropZone>

      <div className="grid grid-cols-1 gap-2.5">
        {Array.from({ length: teamCount }, (_, i) => {
          const z = `t${i}`;
          const members = inZone(z);
          return (
            <DropZone key={z} zone={z} label={`チーム${i + 1}`} count={members.length} cap={2} lit={isLit(z)} over={members.length > 2 || (members.length === 1 && n % 2 === 0)} armed={isArmed(z)} onZoneClick={onZoneClick}>
              {members.length === 0 ? <span className="text-[11px] text-[#231714]/75">空き</span> : members.map((m) => renderChip(m.lineUserId))}
            </DropZone>
          );
        })}
      </div>

      <button onClick={confirm} disabled={!valid || busy} className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40" style={{ background: DARTS_ACCENT }}>
        {busy ? "確定中…" : "この編成で申告を開始"}
      </button>
      {!valid && (
        <p className="text-[10.5px] text-[#231714]/85 text-center">
          {unplaced > 0 ? "全員をチームに配置してください。" : n % 2 === 0 ? "偶数人のため全員2人チームにしてください。" : "奇数人のため1人チームは1組だけにしてください。"}
        </p>
      )}

      {drag && (
        <div ref={ghostRef} className="fixed left-0 top-0 z-50 pointer-events-none inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white"
          style={{ willChange: "transform", transform: `translate3d(${point.current.x}px, ${point.current.y}px, 0) translate(-50%, -50%) scale(1.06)`, border: `2px solid ${DARTS_ACCENT}`, color: "#231714", boxShadow: "0 8px 20px rgba(35,23,20,.18)" }}>
          {dragName}
        </div>
      )}
    </>
  );
}

/* ───────── ③クリケット 申告（チーム単位）＋GM代理 ───────── */

function CricketReportPhase({ day, ev, eventDate, onDone, setError }: { day: DayDto; ev: EventStateDto; eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  // results はメンバー単位。teamId ごとの申告値を拾う。
  const teamValue = new Map<string, number | null>();
  for (const r of ev.results ?? []) if (r.teamId) teamValue.set(r.teamId, r.value);

  const submit = async (team: CricketTeamDto) => {
    const raw = draft[team.teamId];
    if (raw === undefined || raw === "") return;
    const uid = team.memberIds?.[0];
    if (!uid) return;
    setBusy(team.teamId); setError(null);
    const r = await postDay("report", { eventDate, kind: "cricket", value: Number(raw), targetUserId: uid });
    if (!r.ok) setError(r.error ?? "申告に失敗しました");
    else { setDraft((d) => ({ ...d, [team.teamId]: "" })); await onDone(); }
    setBusy(null);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-[#3c4f54]">クリケット（15R・チーム最終ポイント）</span>
        <span className="text-[10px] font-bold text-[#3c4f54] tabular-nums">申告 {ev.reportedCount}/{ev.total}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {day.cricketTeams.map((team, i) => {
          const val = teamValue.get(team.teamId);
          const reported = teamValue.has(team.teamId);
          return (
            <div key={team.teamId} className="flex items-center gap-2 rounded-xl border px-2.5 py-2" style={{ borderColor: reported ? DARTS_ACCENT : "#e4e7e9", background: reported ? `color-mix(in srgb, ${DARTS_ACCENT} 6%, #fff)` : "#fff" }}>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-extrabold text-[#3c4f54]">チーム{i + 1}</div>
                <div className="text-[12.5px] font-bold text-[#1c1f21] truncate">{team.members.map((m) => m.displayName).join("・")}</div>
              </div>
              {reported && <span className="text-[11px] font-bold tabular-nums" style={{ color: DARTS_ACCENT }}>{val ?? "棄権"}</span>}
              <input type="text" inputMode="numeric" placeholder={reported ? "修正" : "入力"}
                value={draft[team.teamId] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [team.teamId]: e.target.value.replace(/[^\d]/g, "") }))}
                className="w-16 text-right border-b outline-none bg-transparent text-[14px] font-black tabular-nums text-[#1c1f21] py-0.5"
                style={{ borderColor: draft[team.teamId] ? DARTS_ACCENT : "#e4e7e9" }} />
              <button onClick={() => submit(team)} disabled={busy === team.teamId || !draft[team.teamId]} className="shrink-0 text-[11px] font-black px-2.5 py-1.5 rounded-lg text-white disabled:opacity-30" style={{ background: DARTS_ACCENT }}>登録</button>
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ───────── 本日終了 ───────── */

function FinishPhase({ eventDate, onDone, setError }: { eventDate: string; onDone: () => void; setError: (s: string | null) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const finish = async () => {
    setBusy(true); setError(null);
    const r = await postDay("finish", { eventDate });
    if (!r.ok) setError(r.error ?? "終了に失敗しました");
    else { setConfirm(false); await onDone(); }
    setBusy(false);
  };
  return (
    <>
      <p className="text-[12px] font-bold text-[#231714] leading-relaxed">3種目すべての申告が確定しました。</p>
      {!confirm ? (
        <button onClick={() => setConfirm(true)} className="w-full py-3 rounded-2xl text-sm font-black text-white" style={{ background: DARTS_ACCENT }}>本日の対局を終了する</button>
      ) : (
        <div className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: "#c9d6cf", background: "#f7faf8" }}>
          <p className="text-[11px] font-bold leading-relaxed" style={{ color: DARTS_ACCENT }}>本日終了で3種目の順位ポイントを合算し、順位を確定します。以降この日の申告はできません。</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirm(false)} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-white disabled:opacity-40" style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}>やめる</button>
            <button onClick={finish} disabled={busy} className="flex-1 py-2.5 rounded-xl text-[13px] font-black text-white disabled:opacity-40" style={{ background: DARTS_ACCENT }}>{busy ? "確定中…" : "終了する"}</button>
          </div>
        </div>
      )}
    </>
  );
}
