"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ACCENT } from "@/components/mahjong/leagueShared";

/**
 * ゲームマスター（GM）専用の手動卓振り分けパネル。
 * 未配置/A卓/B卓/待機 に参加者を配置し、「この半荘の卓を確定」で
 * /api/mahjong/day/assign に送る。自己申告 UI とは別セクション。
 *
 * 操作は「指でつまんで枠へ運ぶ」。**Pointer Events** で実装しており、タッチでもマウスでも同じ経路。
 * HTML5 の drag イベント（draggable/dragstart/drop）はタッチでは発火せず、LINEミニアプリ
 * （スマホの WebView）では一切動かないため使っていない。
 * ドラッグせずに離した場合は「タップで選択 → 置きたい枠をタップ」として扱う（片手操作の保険）。
 *
 * 追従を滑らかに保つための決めごと（崩すと目に見えてカクつく）:
 *  - Chip / DropZone は**このファイルのトップレベル**に置く。コンポーネント内で定義すると
 *    レンダーごとに別のコンポーネント型になり、チップが再マウントされて指の追従が切れる。
 *  - 指の座標は state に入れない。ref に溜めて rAF で ghost の transform を直接書く。
 *    state を更新するのは「真下の枠が変わった瞬間」だけ。
 */

interface PoolMember { lineUserId: string; displayName: string; pictureUrl?: string }
type Zone = "pool" | "A" | "B" | "waiting";

/** 確定済みの半荘の進行状況（申告待ちの表示に使う）。 */
interface Progress {
  tables: { label: string; members: { displayName: string; reported: boolean }[] }[];
  reported: number;
  total: number;
}

/** 進行中の半荘を見張る間隔。全員の申告が済むと次の半荘へ進み、振り分け UI に戻る。 */
const PROGRESS_POLL_MS = 20000;

const ZONE_META: { zone: Zone; label: string; cap?: number }[] = [
  { zone: "A", label: "A卓", cap: 4 },
  { zone: "B", label: "B卓", cap: 4 },
  { zone: "waiting", label: "待機（抜け番）" },
];

/** この距離(px)を超えて指が動いたら「タップ」ではなく「ドラッグ」と判定する。 */
const DRAG_THRESHOLD = 6;

/** 1卓の定員。半荘は4人打ちなので、卓に座るならちょうどこの人数（サーバー ASSIGN_MAX_SEATS と一致）。 */
const SEATS_PER_TABLE = 4;

/** 座標直下の枠を返す（ゴーストは pointer-events:none なので拾わない）。 */
function zoneAtPoint(x: number, y: number): Zone | null {
  const el = document.elementFromPoint(x, y);
  const holder = el?.closest("[data-zone]");
  const z = holder?.getAttribute("data-zone");
  return z === "pool" || z === "A" || z === "B" || z === "waiting" ? z : null;
}

/** 申告済みを示す小さなチェック。 */
function CheckMark() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M20 6L9 17l-5-5" stroke={ACCENT} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ───────── 参加者カード ─────────
 * 指でつまむ対象なので、タッチ目標として十分な高さ（48px）を確保する。
 * touch-action:none が無いと、指を動かした瞬間にページのスクロールへ持っていかれる。 */
const Chip = memo(function Chip({
  m, selected, dragging, locked, onPointerDown,
}: {
  m: PoolMember;
  selected: boolean;
  dragging: boolean;
  locked: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={locked}
      aria-pressed={selected}
      // 枠の onClick へ伝播すると、その枠へ即移動してしまうため止める。
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, m.lineUserId); }}
      className={`inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white border select-none ${dragging ? "opacity-30" : ""} ${locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      style={{
        touchAction: "none",
        borderColor: selected ? ACCENT : "#e4e7e9",
        color: "#231714",
        boxShadow: selected ? `0 0 0 2px ${ACCENT}` : "0 1px 2px rgba(35,23,20,.06)",
      }}
    >
      {m.displayName}
    </button>
  );
});

/* ───────── 置き場（未配置 / A卓 / B卓 / 待機） ───────── */
const DropZone = memo(function DropZone({
  zone, label, cap, members, lit, over, emptyText, litText, armed, onZoneClick, renderChip,
}: {
  zone: Zone;
  label: string;
  cap?: number;
  members: PoolMember[];
  lit: boolean;
  over: boolean;
  emptyText: string;
  litText: string;
  armed: boolean;
  onZoneClick: (zone: Zone) => void;
  renderChip: (m: PoolMember) => React.ReactNode;
}) {
  const isPool = zone === "pool";
  return (
    <div
      data-zone={zone}
      onClick={() => onZoneClick(zone)}
      className={`rounded-2xl border border-dashed p-2.5 transition-colors ${isPool ? "min-h-[56px]" : "min-h-[72px]"} ${armed ? "cursor-pointer" : ""}`}
      style={{
        borderColor: over ? "#d8533a" : lit ? ACCENT : isPool ? "#e4e7e9" : "#c9d6cf",
        background: lit ? `color-mix(in srgb, ${ACCENT} 10%, #fff)` : isPool ? "#fff" : "#f7faf8",
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-extrabold" style={{ color: over ? "#d8533a" : isPool ? "#97999d" : "#5f7a80" }}>
          {label}{cap != null ? `（${members.length}/${cap}）` : `（${members.length}）`}
        </span>
        {lit && <span className="text-[10px] font-bold" style={{ color: ACCENT }}>{isPool ? "ここに戻す" : "ここに置く"}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {members.length === 0 ? (
          <span className="text-[11px] text-[#231714]/30">{lit ? litText : emptyText}</span>
        ) : (
          members.map((m) => renderChip(m))
        )}
      </div>
    </div>
  );
});

/** 開催成立に必要な最少人数（サーバー MAHJONG_MIN_PARTICIPANTS と一致させる）。 */
const MIN_PARTICIPANTS = 4;

export function MahjongGmAssignPanel({ eventDate, onChanged }: { eventDate: string; onChanged: () => void }) {
  const [round, setRound] = useState(1);
  const [locked, setLocked] = useState(false);
  // GM が「ゲーム開始」を押したか（＝受付締切済み）。押すまで卓は組めない。
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  // この半荘の卓を確定済みか（true の間は組み直せない＝振り分け UI を畳む）。
  const [assigned, setAssigned] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  // 開催日の中止（流会）。返金を伴うので確認を挟む。
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [pool, setPool] = useState<PoolMember[]>([]);
  const [place, setPlace] = useState<Record<string, Zone>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // タップ操作: 選択中の参加者。枠をタップするとそこへ移動する。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ドラッグ中の参加者と、指の真下の枠。**座標は含めない**（含めると毎フレーム再レンダーになる）。
  const [drag, setDrag] = useState<{ id: string; from: Zone; zone: Zone | null } | null>(null);

  const ghostRef = useRef<HTMLDivElement | null>(null);
  const press = useRef<{ id: string; from: Zone; x: number; y: number; moved: boolean } | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const raf = useRef<number | null>(null);
  const hoverZone = useRef<Zone | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    return fetch(`/api/mahjong/day/assignment?eventDate=${eventDate}`, { credentials: "include" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setRound(d.round ?? 1);
        setLocked(!!d.locked);
        setStarted(!!d.started);
        setAssigned(d.awaitingAssignment === false);
        setProgress(d.progress ?? null);
        setPool(d.pool ?? []);
        const p: Record<string, Zone> = {};
        for (const m of d.pool ?? []) p[m.lineUserId] = "pool";
        for (const t of d.draft?.tables ?? []) {
          if (t.label === "A" || t.label === "B") for (const id of t.memberIds) p[id] = t.label;
        }
        for (const id of d.draft?.waiting ?? []) p[id] = "waiting";
        setPlace(p);
        setError(null);
      })
      .catch(() => setError("読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [eventDate]);
  useEffect(() => { load(); }, [load]);

  // 確定済み（＝申告待ち）の間だけポーリングする。全員の申告が済むとサーバーが次 round へ
  // 進めて awaitingAssignment=true に戻すので、自動的に振り分け UI が返ってくる。
  useEffect(() => {
    if (!assigned) return;
    const id = setInterval(() => { load(); }, PROGRESS_POLL_MS);
    return () => clearInterval(id);
  }, [assigned, load]);

  const move = useCallback((id: string, zone: Zone) => {
    if (locked) return;
    setDone(false);
    setSelectedId(null);
    setPlace((p) => ({ ...p, [id]: zone }));
  }, [locked]);

  /* ───────── つまんで運ぶ（Pointer Events。タッチ/マウス共通） ───────── */

  // 1フレームに1回だけ、ゴーストの transform を直接書き、枠が変わったときだけ state を更新する。
  const tick = useCallback(() => {
    raf.current = null;
    const { x, y } = point.current;
    const g = ghostRef.current;
    if (g) g.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(1.06)`;
    const z = zoneAtPoint(x, y);
    if (z !== hoverZone.current) {
      hoverZone.current = z;
      setDrag((d) => (d ? { ...d, zone: z } : d));
    }
  }, []);

  const schedule = useCallback(() => {
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const cleanup = useCallback(() => {
    if (raf.current != null) { cancelAnimationFrame(raf.current); raf.current = null; }
    press.current = null;
    hoverZone.current = null;
    setDrag(null);
  }, []);

  // pointermove/up は window で**一度だけ**張る。要素に付けると、再レンダーや
  // レイアウト変化で取りこぼす余地が残る（pointer capture も要素の生存が前提）。
  // 実際に処理するかは press.current（ref）で判断するので、張り直しは不要。
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      point.current = { x: e.clientX, y: e.clientY };
      if (!p.moved) {
        if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
        p.moved = true;
        setSelectedId(null); // ドラッグに切り替わったらタップ選択は解除
        hoverZone.current = p.from;
        setDrag({ id: p.id, from: p.from, zone: p.from });
      }
      e.preventDefault(); // スクロール/テキスト選択を抑止
      schedule();
    };

    const onUp = (e: PointerEvent) => {
      const p = press.current;
      if (!p) return;
      if (p.moved) {
        const zone = zoneAtPoint(e.clientX, e.clientY);
        if (zone && zone !== p.from) move(p.id, zone); // 枠の外で離したら元のまま
      } else {
        setSelectedId((cur) => (cur === p.id ? null : p.id)); // 動かさずに離した＝タップ
      }
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
    if (locked) return;
    point.current = { x: e.clientX, y: e.clientY };
    press.current = { id, from: (place[id] ?? "pool") as Zone, x: e.clientX, y: e.clientY, moved: false };
  }, [locked, place]);

  const inZone = (z: Zone) => pool.filter((m) => (place[m.lineUserId] ?? "pool") === z);
  const aCount = inZone("A").length;
  const bCount = inZone("B").length;
  const unplaced = inZone("pool").length;
  // 卓に座るならちょうど4名（0名＝その卓を使わない）。半端な卓は確定させない。
  const seatsOk = (n: number) => n === 0 || n === SEATS_PER_TABLE;
  const valid =
    !locked && unplaced === 0 && seatsOk(aCount) && seatsOk(bCount) && aCount + bCount >= SEATS_PER_TABLE;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const tables = [
        { label: "A", memberIds: inZone("A").map((m) => m.lineUserId) },
        { label: "B", memberIds: inZone("B").map((m) => m.lineUserId) },
      ].filter((t) => t.memberIds.length > 0);
      const waiting = inZone("waiting").map((m) => m.lineUserId);
      // 対象の半荘はサーバーが dayState.round から決める（round は送らない）。
      // 画面を開いたまま半荘が進んでいても、GM はそのまま「いまの半荘」を確定できる。
      const res = await fetch("/api/mahjong/day/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate, tables, waiting }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "確定に失敗しました"); return; }
      setDone(true);
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  /** 受付を締め切ってゲームを開始する。押した瞬間が締切。 */
  const startGame = async () => {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch("/api/mahjong/day/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "ゲーム開始に失敗しました"); return; }
      await load();
      onChanged();
    } finally {
      setStarting(false);
    }
  };

  /** この開催日を中止（流会）にする。支払い済みは返金対象になる。 */
  const cancelDay = async () => {
    setCancelling(true);
    setError(null);
    try {
      const res = await fetch("/api/mahjong/day/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventDate }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error ?? "中止に失敗しました"); return; }
      setConfirmCancel(false);
      await load();
      onChanged();
    } finally {
      setCancelling(false);
    }
  };

  const onZoneClick = useCallback((zone: Zone) => {
    if (locked || !selectedId) return;
    if ((place[selectedId] ?? "pool") === zone) return;
    move(selectedId, zone);
  }, [locked, selectedId, place, move]);

  const renderChip = useCallback((m: PoolMember) => (
    <Chip
      key={m.lineUserId}
      m={m}
      selected={selectedId === m.lineUserId}
      dragging={drag?.id === m.lineUserId}
      locked={locked}
      onPointerDown={onPointerDown}
    />
  ), [selectedId, drag?.id, locked, onPointerDown]);

  /** 枠を光らせるか（選択中の移動先 or 指の真下。いま居る枠は光らせない）。 */
  const isLit = (zone: Zone) => {
    if (drag) return drag.zone === zone && drag.from !== zone;
    return selectedId != null && !locked && (place[selectedId] ?? "pool") !== zone;
  };
  const isArmed = (zone: Zone) => !locked && !drag && selectedId != null && (place[selectedId] ?? "pool") !== zone;

  const dragMember = drag ? pool.find((m) => m.lineUserId === drag.id) : undefined;

  return (
    <div className="rounded-2xl border-2 p-4 flex flex-col gap-3" style={{ borderColor: ACCENT, background: "color-mix(in srgb, " + ACCENT + " 5%, #fff)" }}>
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-black" style={{ color: ACCENT }}>
          {!started ? "ゲーム開始（GM）" : assigned ? `第${round}半荘 進行中` : `卓振り分け（GM）・第${round}半荘`}
        </div>
        {assigned && progress && (
          <span className="text-[10px] font-bold text-[#5f7a80] tabular-nums">
            申告 {progress.reported}/{progress.total}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><div className="w-5 h-5 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" /></div>
      ) : !started ? (
        /* ── 開始前: 受付中。押した瞬間が締切になる ── */
        <>
          {error && <div className="text-[11px] font-bold text-[#d8533a] bg-[#fdece8] rounded-lg px-3 py-2">{error}</div>}
          <p className="text-[11px] text-[#231714]/60 leading-relaxed">
            「ゲーム開始」を押すと<b>受付を締め切ります</b>。以降は参加表明も参加費の支払いもできません。
            そのときの支払い済みメンバーで卓を組みます。
          </p>
          <div className="rounded-2xl border border-dashed p-2.5" style={{ borderColor: "#e4e7e9", background: "#fff" }}>
            <div className="text-[11px] font-extrabold text-[#97999d] mb-1.5">支払い済み（{pool.length}名）</div>
            <div className="flex flex-wrap gap-1.5">
              {pool.length === 0 ? (
                <span className="text-[11px] text-[#231714]/30">まだいません</span>
              ) : (
                pool.map((m) => (
                  <span key={m.lineUserId} className="inline-flex items-center rounded-2xl px-3 min-h-[36px] text-[13px] font-bold bg-white border" style={{ borderColor: "#e4e7e9", color: "#231714" }}>
                    {m.displayName}
                  </span>
                ))
              )}
            </div>
          </div>
          <button
            onClick={startGame}
            disabled={starting || pool.length < MIN_PARTICIPANTS}
            className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40"
            style={{ background: ACCENT }}
          >
            {starting ? "開始中…" : "ゲーム開始（受付を締め切る）"}
          </button>
          {pool.length < MIN_PARTICIPANTS && (
            <p className="text-[10.5px] text-[#231714]/50 text-center">
              支払い済みが{MIN_PARTICIPANTS}名以上になると開始できます。
            </p>
          )}

          {/* 中止（流会）。人数不足が主用途だが、雨天・設備トラブル等でも押せる。 */}
          {!confirmCancel ? (
            <button
              onClick={() => setConfirmCancel(true)}
              className="text-[10.5px] font-bold text-[#c0563c] underline underline-offset-2 self-center"
            >
              この開催日を中止（流会）にする
            </button>
          ) : (
            <div className="rounded-2xl border p-3 flex flex-col gap-2" style={{ borderColor: "#e9b7ab", background: "#fdece8" }}>
              <p className="text-[11px] font-bold text-[#c0563c] leading-relaxed">
                この開催日を中止します。支払い済みの{pool.length}名は<b>返金対象</b>になり、管理者に返金依頼が飛びます。
                未決済の参加表明は取り消され、今月の参加枠は戻ります。取り消せません。
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmCancel(false)}
                  disabled={cancelling}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-bold bg-white disabled:opacity-40"
                  style={{ boxShadow: "inset 0 0 0 1px #e4e7e9", color: "#40434a" }}
                >
                  やめる
                </button>
                <button
                  onClick={cancelDay}
                  disabled={cancelling}
                  className="flex-1 py-2.5 rounded-xl text-[13px] font-black text-white disabled:opacity-40"
                  style={{ background: "#c0563c" }}
                >
                  {cancelling ? "中止中…" : "中止する"}
                </button>
              </div>
            </div>
          )}
        </>
      ) : assigned ? (
        /* ── 確定済み: 申告待ち。組み直せないので畳んでおく。
              両卓の申告が揃うとサーバーが次半荘へ進め、振り分け UI が戻る ── */
        <>
          {error && <div className="text-[11px] font-bold text-[#d8533a] bg-[#fdece8] rounded-lg px-3 py-2">{error}</div>}
          <div className="flex flex-col gap-2">
            {(progress?.tables ?? []).map((t) => (
              <div key={t.label} className="rounded-2xl border p-2.5" style={{ borderColor: "#e4e7e9", background: "#fff" }}>
                <div className="text-[11px] font-extrabold text-[#5f7a80] mb-1.5">{t.label}卓</div>
                <div className="flex flex-wrap gap-1.5">
                  {t.members.map((m, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-2xl px-3 min-h-[34px] text-[12.5px] font-bold border"
                      style={{
                        borderColor: m.reported ? ACCENT : "#e4e7e9",
                        color: m.reported ? ACCENT : "#231714",
                        background: m.reported ? `color-mix(in srgb, ${ACCENT} 8%, #fff)` : "#fff",
                      }}
                    >
                      {m.reported && <CheckMark />}
                      {m.displayName}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10.5px] text-[#231714]/50 text-center">
            全員のスコア申告が終わると、次の半荘の振り分けができます。
          </p>
        </>
      ) : (
        <>
          {error && <div className="text-[11px] font-bold text-[#d8533a] bg-[#fdece8] rounded-lg px-3 py-2">{error}</div>}
          {done && !error && <div className="text-[11px] font-bold text-[#2f7d57] bg-[#eef6f0] rounded-lg px-3 py-2">卓を確定しました。</div>}

          {!locked && (
            <p className="text-[10.5px] text-[#231714]/50">
              {selectedId
                ? "置きたい枠をタップしてください。"
                : "参加者を指でつまんで、A卓 / B卓 / 待機 へ運びます（タップで選んでから枠をタップしても移動できます）。"}
            </p>
          )}

          <DropZone
            zone="pool"
            label={`未配置`}
            members={inZone("pool")}
            lit={isLit("pool")}
            over={false}
            armed={isArmed("pool")}
            emptyText="全員配置済み"
            litText="ここで指を離す"
            onZoneClick={onZoneClick}
            renderChip={renderChip}
          />

          <div className="grid grid-cols-1 gap-2.5">
            {ZONE_META.map((z) => {
              const members = inZone(z.zone);
              return (
                <DropZone
                  key={z.zone}
                  zone={z.zone}
                  label={z.label}
                  cap={z.cap}
                  members={members}
                  lit={isLit(z.zone)}
                  // 卓は 0名（使わない）か 4名ちょうど。1〜3名や5名以上は成立しないので赤くする。
                  over={z.cap != null && !seatsOk(members.length)}
                  armed={isArmed(z.zone)}
                  emptyText="空き"
                  litText="ここで指を離す"
                  onZoneClick={onZoneClick}
                  renderChip={renderChip}
                />
              );
            })}
          </div>

          {!locked && (
            <button
              onClick={confirm}
              disabled={!valid || busy}
              className="w-full py-3 rounded-2xl text-sm font-black text-white disabled:opacity-40"
              style={{ background: ACCENT }}
            >
              {busy ? "確定中…" : "この半荘の卓を確定"}
            </button>
          )}
          {!valid && !locked && (
            <p className="text-[10.5px] text-[#231714]/50 text-center">
              {unplaced > 0
                ? "全員をA卓/B卓/待機に配置すると確定できます。"
                : !seatsOk(aCount) || !seatsOk(bCount)
                  ? `卓は${SEATS_PER_TABLE}名ちょうどにしてください（余った人は待機へ）。`
                  : `少なくとも1卓（${SEATS_PER_TABLE}名）が必要です。`}
            </p>
          )}

          {/* 指に追従するゴースト。位置は rAF で transform を直接書く（React を経由しない）。 */}
          {drag && dragMember && (
            <div
              ref={ghostRef}
              className="fixed left-0 top-0 z-50 pointer-events-none inline-flex items-center justify-center rounded-2xl px-4 min-h-[48px] text-[14px] font-bold bg-white"
              style={{
                willChange: "transform",
                transform: `translate3d(${point.current.x}px, ${point.current.y}px, 0) translate(-50%, -50%) scale(1.06)`,
                border: `2px solid ${ACCENT}`,
                color: "#231714",
                boxShadow: "0 8px 20px rgba(35,23,20,.18)",
              }}
            >
              {dragMember.displayName}
            </div>
          )}
        </>
      )}
    </div>
  );
}
