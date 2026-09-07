"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Facility } from "@/types";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import { timeToMin, generateSlots } from "./slots";
import { FacilityPill } from "./FacilityPill";
import { CompanionPicker, type CompanionCandidate } from "./CompanionPicker";
import { saveReservationDraft } from "@/lib/reservationDraft";
import { minPartySizeOf, maxCompanionsOf } from "@/lib/companions";
import { BOOKING_HORIZON_DAYS, earliestBookableDate, minAdvanceDaysOf } from "@/lib/reservations";
import { Button, GlassCard, PageBg, PageHeading } from "@/components/ui/eb";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

// ─── 定数 ───────────────────────────────────────────────────────────────────

const DAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

// 安定参照（再レンダリングのたびに新規配列/オブジェクトを作らない）
const EMPTY_FACILITIES: Facility[] = [];
const EMPTY_WEEK: Record<string, { start: string; end: string }[]> = {};
const EMPTY_SLOTS: { start: string; end: string }[] = [];

// 空き状況の短時間キャッシュ TTL。前回表示を残しつつ常に裏で取り直し、古い間は「更新中」を出す。
// 予約確定時はサーバー(POST /api/reservations)が必ず最新を再検証するため、多少古い表示でも
// ダブルブッキングは起きない。
const AVAIL_TTL = 30_000;

// ─── メインページ ────────────────────────────────────────────────────────────

export default function ReservationPage() {
  const router = useRouter();

  // ─── 施設（キャッシュ可・再訪時に即表示）──────────────────────────────────
  const { data: facilitiesData } = useStaleWhileRevalidate<{ facilities: Facility[] }>(
    "facilities:list",
    async () => {
      const r = await fetch("/api/facilities", { cache: "no-store" });
      return r.json();
    }
  );
  const facilities = facilitiesData?.facilities ?? EMPTY_FACILITIES;

  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);

  // カレンダー
  const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf("month"));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // 時間選択
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);

  const today = dayjs().format("YYYY-MM-DD");
  const maxDate = dayjs().add(BOOKING_HORIZON_DAYS, "day").format("YYYY-MM-DD");
  // 予約できる最も早い日。施設の minAdvanceDays（直前予約の禁止）を反映する。
  // 判定ロジックはサーバーと同じ earliestBookableDate を使い、表示と検証をズレさせない。
  const minAdvanceDays = selectedFacility ? minAdvanceDaysOf(selectedFacility) : 0;
  const minDate = selectedFacility ? earliestBookableDate(selectedFacility, today) : today;

  // ─── 月の空き（週ごとに取得して合算。短時間キャッシュ＋裏で更新）──────────
  const weekKey = selectedFacility
    ? `avail:week:${selectedFacility.id}:${currentMonth.format("YYYY-MM")}`
    : null;
  const {
    data: weekDataRaw,
    isLoading: weekLoading,
    isValidating: weekValidating,
  } = useStaleWhileRevalidate<Record<string, { start: string; end: string }[]>>(
    weekKey,
    async () => {
      const facilityId = selectedFacility!.id;
      const monthStart = currentMonth.startOf("month");
      const monthEnd = currentMonth.endOf("month");
      const weeks: string[] = [];
      let w = monthStart.startOf("week").add(1, "day"); // 月曜始まり
      if (w.isAfter(monthStart)) w = w.subtract(1, "week");
      while (w.isBefore(monthEnd) || w.isSame(monthEnd, "day")) {
        weeks.push(w.format("YYYY-MM-DD"));
        w = w.add(1, "week");
      }
      const results = await Promise.all(
        weeks.map((ws) =>
          fetch(
            `/api/reservations/week-availability?facilityId=${facilityId}&weekStart=${ws}`,
            { cache: "no-store", credentials: "include" }
          )
            .then((r) => r.json())
            .catch(() => ({}))
        )
      );
      const merged: Record<string, { start: string; end: string }[]> = {};
      results.forEach((r) => {
        Object.entries(r).forEach(([date, slots]) => {
          merged[date] = slots as { start: string; end: string }[];
        });
      });
      return merged;
    },
    { ttl: AVAIL_TTL }
  );
  const weekData = weekDataRaw ?? EMPTY_WEEK;
  // 既存表示を出したまま裏で更新中（=表示が古い可能性がある）
  const weekRefreshing = weekValidating && !weekLoading;

  // ─── 選択日の空き（短時間キャッシュ＋裏で更新）───────────────────────────
  const dayKey =
    selectedFacility && selectedDate
      ? `avail:day:${selectedFacility.id}:${selectedDate}`
      : null;
  const {
    data: daySlotsRaw,
    isLoading: loadingDay,
    isValidating: dayValidating,
  } = useStaleWhileRevalidate<{ start: string; end: string }[]>(
    dayKey,
    async () => {
      const r = await fetch(
        `/api/reservations/availability?facilityId=${selectedFacility!.id}&date=${selectedDate}`,
        { cache: "no-store", credentials: "include" }
      );
      const d = await r.json();
      return d.bookedSlots ?? [];
    },
    { ttl: AVAIL_TTL }
  );
  const daySlots = daySlotsRaw ?? EMPTY_SLOTS;
  const dayRefreshing = dayValidating && !loadingDay;

  // 施設/日付が変わったら時間選択をリセット
  useEffect(() => {
    setSelStart(null);
    setSelEnd(null);
  }, [selectedFacility?.id, selectedDate]);

  // ─── カレンダーデータ ─────────────────────────────────────────────────────
  const calendarDays = useMemo(() => {
    const first = currentMonth.startOf("month");
    const last = currentMonth.endOf("month");

    // 月曜始まり → day(): 0=日 → 月曜=1, 日曜=0→7
    const rawDow = first.day();
    const startDow = rawDow === 0 ? 7 : rawDow;
    const leadingBlanks = startDow - 1;

    const days: (dayjs.Dayjs | null)[] = [];
    for (let i = 0; i < leadingBlanks; i++) days.push(null);
    for (let d = 1; d <= last.date(); d++) days.push(first.add(d - 1, "day"));

    // 末尾を7の倍数に
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentMonth.format("YYYY-MM")]);

  // ─── 日付の状態判定 ────────────────────────────────────────────────────────
  const getDateState = useCallback(
    (d: dayjs.Dayjs) => {
      const dateStr = d.format("YYYY-MM-DD");
      const isPast = dateStr < today;
      // 直前すぎる日（minAdvanceDays 未満）も選べない。過去日と同じ「disabled」で出す。
      const isTooSoon = dateStr < minDate;
      const isBeyond = dateStr > maxDate;
      const availDays = selectedFacility?.availableDays ?? [1, 2, 3, 4, 5];
      const isUnavailableDay = !availDays.includes(d.day());

      if (isPast || isTooSoon || isBeyond || isUnavailableDay) return "disabled" as const;

      // 空きデータがあれば、その日が完全に埋まっているか判定
      const booked = weekData[dateStr];
      if (booked && selectedFacility) {
        const open = timeToMin(selectedFacility.openTime ?? "09:00");
        const close = timeToMin(selectedFacility.closeTime ?? "18:00");
        const totalMin = close - open;
        let bookedMin = 0;
        booked.forEach((b) => {
          const s = Math.max(timeToMin(b.start), open);
          const e = Math.min(timeToMin(b.end), close);
          if (e > s) bookedMin += e - s;
        });
        if (bookedMin >= totalMin) return "full" as const;
        if (bookedMin > 0) return "partial" as const;
      }
      return "available" as const;
    },
    [today, minDate, maxDate, selectedFacility, weekData]
  );

  // ─── 固定枠関連 ─────────────────────────────────────────────────────────────
  const isFixedDuration = selectedFacility?.fixedDuration ?? false;
  const fixedMinDuration = selectedFacility?.minDuration ?? 0; // 分
  const facilityPrepTime = selectedFacility?.prepTime ?? 0;   // 分

  // ─── タイムスロット生成 ────────────────────────────────────────────────────
  const timeSlots = useMemo(() => {
    if (!selectedFacility) return [];
    return generateSlots(
      selectedFacility.openTime ?? "09:00",
      selectedFacility.closeTime ?? "18:00"
    );
  }, [selectedFacility?.openTime, selectedFacility?.closeTime]);

  /** closeTime スロット（開始時刻としては選択不可） */
  const closeTimeSlot = selectedFacility?.closeTime ?? "18:00";

  const isSlotBooked = useCallback(
    (slot: string) => {
      const sm = timeToMin(slot);
      return daySlots.some((b) => sm >= timeToMin(b.start) && sm < timeToMin(b.end));
    },
    [daySlots]
  );

  const isPastSlot = useCallback(
    (slot: string) => {
      if (selectedDate !== today) return false;
      const now = dayjs();
      const slotTime = dayjs(`${selectedDate}T${slot}`);
      return slotTime.isBefore(now);
    },
    [selectedDate, today]
  );

  // ─── 終了時刻の最大値を算出（開始後の最初の予約開始時刻）──────────────────
  const getMaxEndMin = useCallback(
    (startSlot: string): number => {
      const startMin = timeToMin(startSlot);
      const closeMin = timeToMin(selectedFacility?.closeTime ?? "18:00");
      let maxEnd = closeMin;

      for (const b of daySlots) {
        const bs = timeToMin(b.start);
        if (bs > startMin && bs < maxEnd) {
          maxEnd = bs;
        }
      }
      return maxEnd;
    },
    [daySlots, selectedFacility?.closeTime]
  );

  // ─── 指定スロットが有効な終了時刻かどうか判定 ─────────────────────────────
  const isValidEndSlot = useCallback(
    (slot: string, startSlot: string): boolean => {
      const sm = timeToMin(slot);
      const ss = timeToMin(startSlot);
      if (sm <= ss) return false;
      const maxEnd = getMaxEndMin(startSlot);
      return sm <= maxEnd;
    },
    [getMaxEndMin]
  );

  /**
   * 固定枠の場合、開始〜開始+minDuration の範囲に予約 or closeTime 超過がないか判定
   */
  const isFixedSlotAvailable = useCallback(
    (startSlot: string): boolean => {
      if (!isFixedDuration || !fixedMinDuration) return true;
      const startMin = timeToMin(startSlot);
      const endMin = startMin + fixedMinDuration;
      const closeMin = timeToMin(selectedFacility?.closeTime ?? "18:00");
      // 終了がcloseTimeを超える場合は不可
      if (endMin > closeMin) return false;
      // 範囲内に予約がないか
      for (const b of daySlots) {
        const bs = timeToMin(b.start);
        const be = timeToMin(b.end);
        // 予約範囲と重複チェック
        if (startMin < be && endMin > bs) return false;
      }
      return true;
    },
    [isFixedDuration, fixedMinDuration, daySlots, selectedFacility?.closeTime]
  );

  /** 開始時刻として選択不可かどうか */
  function isStartDisabled(slot: string) {
    if (isSlotBooked(slot) || slot === closeTimeSlot) return true;
    // 固定枠の場合、枠全体が収まるかチェック
    if (isFixedDuration && !isFixedSlotAvailable(slot)) return true;
    return false;
  }

  /** 分を "HH:MM" に変換 */
  function minToTime(m: number): string {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  }

  // ─── 時間選択ハンドラ ──────────────────────────────────────────────────────
  function handleSlotClick(slot: string) {
    if (isPastSlot(slot)) return;

    // 固定枠モード: 開始時刻のみ選択、終了は自動計算
    if (isFixedDuration && fixedMinDuration) {
      if (isStartDisabled(slot)) return;
      setSelStart(slot);
      setSelEnd(minToTime(timeToMin(slot) + fixedMinDuration));
      return;
    }

    if (!selStart || selEnd) {
      // 1回目または再選択 → 開始時刻をセット
      if (isStartDisabled(slot)) return;
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 2回目 → 終了時刻の選択
    // 有効な終了時刻ならセット
    if (isValidEndSlot(slot, selStart)) {
      setSelEnd(slot);
      return;
    }

    // 無効 → 開始として再設定
    if (!isStartDisabled(slot)) {
      setSelStart(slot);
      setSelEnd(null);
    }
  }

  function getSlotState(slot: string) {
    if (isPastSlot(slot)) return "past" as const;

    if (!selStart) {
      // 開始時刻選択モード
      if (isStartDisabled(slot)) return "booked" as const;
      return "free" as const;
    }

    const sm = timeToMin(slot);
    const ss = timeToMin(selStart);

    if (slot === selStart) return "selected-start" as const;

    if (selEnd) {
      // 開始・終了確定済み
      const se = timeToMin(selEnd);
      if (slot === selEnd) return "selected-end" as const;
      if (sm > ss && sm < se) return "selected-range" as const;
      if (isStartDisabled(slot)) return "booked" as const;
      return "free" as const;
    }

    // 固定枠モード: 終了は自動セットされるので、ここには来ないはずだが念のため
    if (isFixedDuration) {
      if (isStartDisabled(slot)) return "booked" as const;
      return "free" as const;
    }

    // 終了時刻選択モード
    if (sm > ss && isValidEndSlot(slot, selStart)) {
      return "free" as const; // 選択可能な終了時刻
    }

    if (isSlotBooked(slot)) return "booked" as const;
    if (sm <= ss) return "free" as const; // 開始より前は新しい開始として選択可能（closeTimeは除く）
    return "booked" as const; // 予約境界を超えた先は無効
  }

  // ─── 利用規約 ──────────────────────────────────────────────────────────────
  const [termsAgreed, setTermsAgreed] = useState(false);
  const [termsRead, setTermsRead] = useState(false);   // 規約を最後までスクロールしたか
  const [showTermsModal, setShowTermsModal] = useState(false);
  // トレーラー決済（仮押さえ→決済URL遷移）
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const needsTerms = selectedFacility?.requireTerms ?? false;

  // ─── 同伴者（サウナ等・1人での利用を禁止する施設） ─────────────────────────
  const [companions, setCompanions] = useState<CompanionCandidate[]>([]);
  const requiresCompanions = selectedFacility?.requireCompanions === true;
  const minPartySize = selectedFacility ? minPartySizeOf(selectedFacility) : 2;
  const maxCompanions = selectedFacility ? maxCompanionsOf(selectedFacility) : 1;
  const partySize = 1 + companions.length;
  // 最終判定はサーバー（POST が同伴者の資格と人数を必ず再検証する）。ここはUXのため。
  const companionsOk = !requiresCompanions || partySize >= minPartySize;

  // 施設変更時にリセット
  useEffect(() => {
    setTermsAgreed(false);
    setTermsRead(false);
    setCompanions([]);
  }, [selectedFacility?.id]);

  /** 規約本文のスクロール領域。「スクロール不要な短い規約」の判定に使う */
  const termsScrollRef = useRef<HTMLDivElement>(null);

  /** 下端まで20px以内なら読了とみなす（＝同意ボタンを出す） */
  const REACHED_BOTTOM_PX = 20;

  /** 規約モーダルのスクロール検知 */
  function handleTermsScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < REACHED_BOTTOM_PX) {
      setTermsRead(true);
    }
  }

  // ⚠️ 規約が短くてスクロールバーが出ない施設では onScroll が一度も発火せず、
  //    同意ボタンが永久に出ない＝**その施設は予約できない**（実際にサウナで発生）。
  //    モーダルを開いた時点で「スクロールの必要が無い」なら読了扱いにする。
  useEffect(() => {
    if (!showTermsModal) return;
    // Markdown 描画後に測るため次フレームで判定する
    const raf = requestAnimationFrame(() => {
      const el = termsScrollRef.current;
      if (!el) return;
      if (el.scrollHeight - el.clientHeight < REACHED_BOTTOM_PX) setTermsRead(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [showTermsModal, selectedFacility?.termsContent]);

  // ─── 課金関連 ─────────────────────────────────────────────────────────────
  // 決済額(paymentAmount)が設定された施設は「決済する」フロー（予約ごとに動的Square決済リンクを生成）。
  const isTrailer = !!(selectedFacility?.paymentAmount && selectedFacility.paymentAmount > 0);
  // 旧 requirePayment（オンライン不可）のブロックは決済施設でないときのみ。
  const needsPayment = (selectedFacility?.requirePayment ?? false) && !isTrailer;

  // ─── 予約確定へ ────────────────────────────────────────────────────────────
  function handleConfirm() {
    if (!selectedFacility || !selectedDate || !selStart || !selEnd) return;
    if (needsTerms && !termsAgreed) return;
    if (needsPayment) return; // 有料施設はオンライン予約不可
    if (!companionsOk) return;
    const params = new URLSearchParams({
      facilityId: selectedFacility.id,
      date: selectedDate,
      startTime: selStart,
      endTime: selEnd,
    });
    if (termsAgreed) params.set("termsAgreed", "true");
    // 同伴者は URL に載せない（lineUserId が履歴・ログに残るため）。sessionStorage で受け渡す。
    saveReservationDraft({
      facilityId: selectedFacility.id,
      date: selectedDate,
      startTime: selStart,
      endTime: selEnd,
      termsAgreed,
      companions: companions.map((c) => ({ lineUserId: c.lineUserId, displayName: c.displayName })),
    });
    router.push(`/reservation/confirm?${params.toString()}`);
  }

  // ─── トレーラー: 決済する（仮押さえ → 決済URLへ遷移） ──────────────────────────
  async function handlePay() {
    if (!isTrailer || !selectedFacility || !selectedDate || !selStart || !selEnd) return;
    if (needsTerms && !termsAgreed) return;
    if (!companionsOk) return;
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch("/api/reservations/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          facilityId: selectedFacility.id,
          date: selectedDate,
          startTime: selStart,
          endTime: selEnd,
          ...(termsAgreed ? { termsAgreed: true } : {}),
          ...(companions.length
            ? { companionIds: companions.map((c) => c.lineUserId) }
            : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.paymentUrl) {
        setPayError(data.message || "仮押さえに失敗しました。時間を変えてお試しください。");
        setPaying(false);
        return;
      }
      // 同一webviewで決済URLへ遷移（決済後は /reservation/complete に戻る）。
      window.location.href = data.paymentUrl as string;
    } catch {
      setPayError("通信エラーが発生しました。");
      setPaying(false);
    }
  }

  const canConfirm = !!(selectedFacility && selectedDate && selStart && selEnd && (!needsTerms || termsAgreed) && !needsPayment && companionsOk);
  const meetingRooms = facilities.filter((f) => f.type === "meeting_room");
  const booths = facilities.filter((f) => f.type === "booth");
  const activities = facilities.filter((f) => f.type === "activity");

  // ─── レンダリング ──────────────────────────────────────────────────────────
  return (
    <PageBg className="flex flex-col">
      {/* ── ヘッダー ── */}
      <div className="px-5 pt-8">
        <PageHeading
          title="RESERVE"
          subtitle="施設予約 — EIGHT BASE UNGA"
          right={
            <Link
              href="/my-reservations"
              className="inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-xl bg-white/60 px-3 text-[13px] max-[360px]:text-[12px] font-bold text-[color:var(--eb-ink)]"
            >
              マイ予約
            </Link>
          }
        />
      </div>

      {/* ── 施設選択 ── */}
      <section className="px-5 pt-4 pb-2">
        <p className="text-[11px] font-bold text-[#231714]/80 uppercase tracking-widest mb-3">施設を選択</p>

        {meetingRooms.length > 0 && (
          <div className="mb-3">
            <p className="text-[10px] text-[#231714]/80 mb-1.5">会議室</p>
            <div className="flex gap-2 flex-wrap">
              {meetingRooms.map((f) => (
                <FacilityPill
                  key={f.id}
                  facility={f}
                  selected={selectedFacility?.id === f.id}
                  onSelect={() => {
                    setSelectedFacility(f);
                    setSelectedDate(null);
                    setSelStart(null);
                    setSelEnd(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {booths.length > 0 && (
          <div>
            <p className="text-[10px] text-[#231714]/80 mb-1.5">リモートブース</p>
            <div className="flex gap-2 flex-wrap">
              {booths.map((f) => (
                <FacilityPill
                  key={f.id}
                  facility={f}
                  selected={selectedFacility?.id === f.id}
                  onSelect={() => {
                    setSelectedFacility(f);
                    setSelectedDate(null);
                    setSelStart(null);
                    setSelEnd(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {activities.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-[#231714]/80 mb-1.5">アクティビティ</p>
            <div className="flex gap-2 flex-wrap">
              {activities.map((f) => (
                <FacilityPill
                  key={f.id}
                  facility={f}
                  selected={selectedFacility?.id === f.id}
                  onSelect={() => {
                    setSelectedFacility(f);
                    setSelectedDate(null);
                    setSelStart(null);
                    setSelEnd(null);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── 区切り ── */}
      <div className="mx-5 h-px bg-[color:var(--eb-line)]" />

      {/* ── カレンダー ── */}
      {selectedFacility ? (
        <section className="px-5 pt-4 pb-2">
          {/* 直前予約を禁止している施設は、なぜ手前の日付が選べないのかを先に伝える */}
          {minAdvanceDays > 0 && (
            <div className="mb-3 rounded-2xl px-4 py-3" style={{ background: "var(--eb-tint)" }}>
              <p className="text-[13px] leading-relaxed text-[color:var(--eb-ink)]">
                この施設は<strong>利用日の{minAdvanceDays}日前まで</strong>にご予約ください。
                <br />
                {dayjs(minDate).format("M月D日（ddd）")}以降の日付から選べます。
              </p>
            </div>
          )}

          <GlassCard>
            {/* 月ナビ */}
            <div className="mb-3 flex items-center justify-between">
              <button
                onClick={() => setCurrentMonth((m) => m.subtract(1, "month"))}
                disabled={currentMonth.isSame(dayjs().startOf("month"), "month")}
                aria-label="前の月"
                className={clsx(
                  "flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--eb-tint)] text-[color:var(--eb-ink)] transition-colors",
                  currentMonth.isSame(dayjs().startOf("month"), "month") && "cursor-not-allowed opacity-[.35]"
                )}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
              </button>
              <h2 className="text-[18px] font-bold text-[color:var(--eb-ink)]">
                {currentMonth.format("YYYY年 M月")}
              </h2>
              <button
                onClick={() => setCurrentMonth((m) => m.add(1, "month"))}
                aria-label="次の月"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--eb-tint)] text-[color:var(--eb-ink)] transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
              </button>
            </div>

            {/* 曜日ヘッダー */}
            <div className="mb-1 grid grid-cols-7 gap-x-[3px]">
              {DAY_LABELS.map((d) => (
                <div key={d} className="py-1 text-center text-[12px] font-medium text-[color:var(--eb-ink-muted)]">
                  {d}
                </div>
              ))}
            </div>

            {/* 日付グリッド（44px円セル。MonthCalendar variant="game" と同じ規則） */}
            <div className="grid grid-cols-7 gap-x-[3px] gap-y-[6px]">
              {calendarDays.map((d, i) => {
                if (!d) return <div key={`blank-${i}`} className="h-11 w-11" />;
                const dateStr = d.format("YYYY-MM-DD");
                const state = getDateState(d);
                const isSelected = dateStr === selectedDate;
                const isToday = dateStr === today;
                const selectable = state !== "disabled" && state !== "full";

                return (
                  <button
                    key={dateStr}
                    disabled={!selectable}
                    onClick={() => setSelectedDate(dateStr)}
                    className={clsx(
                      "relative flex h-11 w-11 items-center justify-center rounded-full text-[17px] transition-all",
                      !selectable
                        ? "border-0 bg-transparent font-normal text-[rgba(26,29,27,.35)]"
                        : isSelected
                          ? "border-[2.5px] border-[color:var(--eb-green)] bg-[color:var(--eb-green)] font-bold text-white active:scale-95"
                          : clsx(
                              "border-[1.5px] border-[rgba(15,29,25,.28)] bg-white/60 active:scale-95",
                              isToday ? "font-bold text-[color:var(--eb-green)]" : "font-medium text-[color:var(--eb-ink)]"
                            )
                    )}
                  >
                    <span>{d.date()}</span>
                  </button>
                );
              })}
            </div>

            {weekLoading ? (
              <div className="flex justify-center py-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
              </div>
            ) : weekRefreshing ? (
              <div className="flex items-center justify-center gap-1.5 py-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
                <span className="text-[12px] text-[color:var(--eb-ink-muted)]">空き状況を更新中…</span>
              </div>
            ) : null}
          </GlassCard>
        </section>
      ) : (
        <div className="flex-1 px-5 pt-2 pb-4">
          <GlassCard className="flex min-h-[220px] items-center justify-center text-center">
            <p className="text-[15px] text-[color:var(--eb-ink-muted)]">
              施設を選ぶと空き状況（カレンダー）が表示されます
            </p>
          </GlassCard>
        </div>
      )}

      {/* ── タイムスロット ── */}
      {selectedDate && selectedFacility && (
        <>
          <div className="mx-5 h-px bg-[color:var(--eb-line)]" />
          <section className="px-5 pt-4 pb-2 flex-1">
            <GlassCard>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[13px] font-bold text-[color:var(--eb-ink-muted)]">
                  {dayjs(selectedDate).format("M月D日（ddd）")}
                </span>
                {dayRefreshing && (
                  <span className="flex items-center gap-1.5 text-[12px] text-[color:var(--eb-ink-muted)]">
                    <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
                    更新中…
                  </span>
                )}
              </div>

              {loadingDay ? (
                <div className="flex justify-center py-8">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-[color:var(--eb-line)] border-t-[color:var(--eb-green)]" />
                </div>
              ) : (
                <>
                  <p className="mb-3 text-[15px] leading-relaxed text-[color:var(--eb-ink)]">
                    {isFixedDuration
                      ? (!selStart
                        ? "開始時間をタップしてください（終了は自動設定されます）"
                        : `${selStart}〜${selEnd} を選択中`)
                      : (!selStart
                        ? "開始時間をタップしてください"
                        : !selEnd
                          ? "終了時間をタップしてください"
                          : `${selStart}〜${selEnd} を選択中`)}
                  </p>
                  {/* 固定枠の内訳表示 */}
                  {isFixedDuration && fixedMinDuration > 0 && (
                    <div className="mb-3 rounded-xl px-3 py-2" style={{ background: "var(--eb-tint)" }}>
                      <p className="text-[12px] text-[color:var(--eb-ink-muted)]">
                        {facilityPrepTime > 0
                          ? `利用${fixedMinDuration - facilityPrepTime}分 ＋ 準備${facilityPrepTime}分 = 合計${fixedMinDuration}分の固定枠`
                          : `${fixedMinDuration}分の固定枠`}
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    {timeSlots.map((slot) => {
                      const state = getSlotState(slot);
                      return (
                        <button
                          key={slot}
                          disabled={state === "booked" || state === "past"}
                          onClick={() => handleSlotClick(slot)}
                          className={clsx(
                            "flex h-12 flex-col items-center justify-center rounded-[14px] text-[13px] transition-all",
                            (state === "booked" || state === "past") && "font-normal text-[color:var(--eb-ink-muted)] cursor-not-allowed",
                            state === "free" && "border border-[color:var(--eb-line)] bg-white/60 font-bold text-[color:var(--eb-ink)] active:scale-95",
                            (state === "selected-start" || state === "selected-end") &&
                              "bg-[color:var(--eb-green)] font-bold text-white active:scale-95",
                            state === "selected-range" && "bg-[rgba(35,147,94,.14)] font-bold text-[color:var(--eb-green-text)]"
                          )}
                          style={state === "booked" ? { background: "var(--eb-tint)" } : undefined}
                        >
                          <span className="leading-none">{slot}</span>
                          {state === "booked" && (
                            <span className="mt-0.5 text-[9px] leading-none">予約済</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </GlassCard>
          </section>

          {/* ── 同伴者（サウナ等）: 日時が決まってから選ぶ ── */}
          {requiresCompanions && selectedDate && selStart && selEnd && (
            <section className="px-5 pb-4">
              <CompanionPicker
                enabled
                value={companions}
                onChange={setCompanions}
                minTotal={minPartySize}
                maxCompanions={maxCompanions}
              />
            </section>
          )}
        </>
      )}

      {/* ── 利用規約 全画面オーバーレイ ── */}
      {showTermsModal && selectedFacility?.termsContent && (
        <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: "var(--eb-bg)" }}>
          {/* ヘッダー */}
          <header className="shrink-0 flex items-center gap-3 border-b border-[color:var(--eb-line)] bg-white/80 px-4 py-3 backdrop-blur-lg">
            <button
              onClick={() => setShowTermsModal(false)}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[color:var(--eb-tint)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--eb-ink)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-[15px] font-bold text-[color:var(--eb-ink)]">利用規約</h1>
          </header>

          {/* 規約本文（スクロール領域） */}
          <div ref={termsScrollRef} className="flex-1 overflow-y-auto relative" onScroll={handleTermsScroll}>
            <div className="px-5 py-5">
              <div className="prose prose-sm max-w-none text-[color:var(--eb-ink)]
                prose-headings:text-[color:var(--eb-ink)] prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2
                prose-h2:text-base prose-h3:text-sm
                prose-p:my-1.5 prose-p:leading-relaxed
                prose-li:my-0.5
                prose-strong:text-[color:var(--eb-ink)]">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedFacility.termsContent}</ReactMarkdown>
              </div>

              {/* 規約末尾の同意ボタン（スクロール完了で表示） */}
              {termsRead && (
                <div className="mt-8 mb-6">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => { setTermsAgreed(true); setShowTermsModal(false); }}
                  >
                    利用規約に同意する
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* スクロールガイド（未読時のみフローティング表示） */}
          {!termsRead && (
            <div className="shrink-0 border-t border-[color:var(--eb-line)] bg-white/80 px-5 py-3 backdrop-blur-lg">
              <div className="flex items-center justify-center gap-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce">
                  <path d="M12 5v14M19 12l-7 7-7-7" />
                </svg>
                <p className="text-[12px] text-[color:var(--eb-ink-muted)]">最後までスクロールしてください</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── フローティングフッター ── */}
      <div
        className="sticky border-t border-[color:var(--eb-line)] bg-white/80 px-5 py-3 backdrop-blur-lg safe-area-pb"
        style={{ bottom: "var(--bottom-nav-height)" }}
      >
        {selectedFacility && selectedDate && selStart && selEnd ? (
          <div className="space-y-3">
            {/* 選択サマリー */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--eb-tint)" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--eb-green)" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" strokeLinecap="round" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold text-[color:var(--eb-ink)]">{selectedFacility?.name}</p>
                <p className="text-[13px] text-[color:var(--eb-ink-muted)]">
                  {dayjs(selectedDate!).format("M/D（ddd）")} {selStart}〜{selEnd}
                  {requiresCompanions && `　合計${partySize}名`}
                </p>
                {/* 固定枠の内訳 */}
                {isFixedDuration && facilityPrepTime > 0 && (
                  <p className="text-[12px] text-[color:var(--eb-ink-muted)]">
                    利用{fixedMinDuration - facilityPrepTime}分 ＋ 準備{facilityPrepTime}分
                  </p>
                )}
              </div>
            </div>

            {/* 利用規約 */}
            {needsTerms && (
              termsAgreed ? (
                <div className="flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="shrink-0">
                    <circle cx="8" cy="8" r="8" fill="var(--eb-green)" />
                    <path d="M4.5 8l2.5 2.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="text-[13px] text-[color:var(--eb-ink-muted)]">利用規約に同意済み</span>
                </div>
              ) : (
                <Button type="button" variant="ghost" onClick={() => setShowTermsModal(true)}>
                  利用規約を確認する
                </Button>
              )
            )}

            {/* 同伴者が足りない（サウナ等・1人での利用を禁止する施設） */}
            {requiresCompanions && !companionsOk && (
              <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(217,169,58,.14)" }}>
                <p className="text-[13px]" style={{ color: "var(--eb-gold-text)" }}>
                  この施設は1人ではご利用いただけません。一緒に入る人を
                  {minPartySize - partySize}名以上選んでください。
                </p>
              </div>
            )}

            {/* 有料施設は予約不可（旧 requirePayment・決済URL未設定時のみ） */}
            {needsPayment && (
              <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(217,169,58,.14)" }}>
                <p className="text-[13px]" style={{ color: "var(--eb-gold-text)" }}>
                  オンライン決済は現在準備中です。管理者にお問い合わせください。
                </p>
              </div>
            )}

            {/* トレーラー: 決済額の案内 */}
            {isTrailer && selectedFacility?.paymentAmount ? (
              <p className="text-center text-[13px] text-[color:var(--eb-ink-muted)]">
                決済額 ¥{selectedFacility.paymentAmount.toLocaleString()}（税込）／ 決済後に解錠コードが表示されます
              </p>
            ) : null}

            {payError && (
              <div className="rounded-2xl px-4 py-3" style={{ background: "rgba(217,72,58,.14)" }}>
                <p className="text-[13px]" style={{ color: "var(--eb-coral-text)" }}>{payError}</p>
              </div>
            )}

            <Button
              type="button"
              variant={isTrailer ? "pay" : "primary"}
              loading={paying}
              disabled={!canConfirm}
              onClick={isTrailer ? handlePay : handleConfirm}
            >
              {isTrailer
                ? `決済する${selectedFacility?.paymentAmount ? `（¥${selectedFacility.paymentAmount.toLocaleString()}）` : ""}`
                : "予約内容を確認する"}
            </Button>
          </div>
        ) : (
          <p className="py-1 text-center text-[13px] text-[color:var(--eb-ink-muted)]">
            {!selectedFacility
              ? "上から施設を選択してください"
              : !selectedDate
              ? "カレンダーから日付を選択してください"
              : !selStart
              ? "開始時間をタップしてください"
              : "終了時間をタップしてください"}
          </p>
        )}
      </div>
    </PageBg>
  );
}
