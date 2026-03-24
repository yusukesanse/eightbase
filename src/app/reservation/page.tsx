"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TopBar } from "@/components/ui/TopBar";
import { FACILITIES } from "@/lib/facilities";
import type { Facility } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

// ─── 定数 ───────────────────────────────────────────────────────────────────

const WEEK_DAYS_JA = ["月", "火", "水", "木", "金"];

function generateSlots(): string[] {
  const slots: string[] = [];
  for (let h = 9; h < 18; h++) {
    for (let m = 0; m < 60; m += 15) {
      slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  return slots;
}

const ALL_SLOTS = generateSlots();

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** dayjs から「その週の月曜日」を返す */
function getMondayOf(d: dayjs.Dayjs): dayjs.Dayjs {
  const dow = d.day(); // 0=日
  const diff = dow === 0 ? -6 : 1 - dow;
  return d.add(diff, "day").startOf("day");
}

// ─── メインページ ────────────────────────────────────────────────────────────

export default function ReservationPage() {
  const router = useRouter();

  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [weekStart, setWeekStart] = useState<dayjs.Dayjs>(() => getMondayOf(dayjs()));
  const [weekData, setWeekData] = useState<Record<string, { start: string; end: string }[]>>({});
  const [loading, setLoading] = useState(false);

  // 選択中の時間帯
  const [selDate, setSelDate] = useState<string | null>(null);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd, setSelEnd] = useState<string | null>(null);

  const today = dayjs().format("YYYY-MM-DD");
  const maxDate = dayjs().add(30, "day").format("YYYY-MM-DD");

  // 月〜金の5日
  const weekDays = Array.from({ length: 5 }, (_, i) => weekStart.add(i, "day"));

  // 施設 or 週が変わったらデータ取得
  useEffect(() => {
    if (!selectedFacility) return;
    setLoading(true);
    setSelDate(null);
    setSelStart(null);
    setSelEnd(null);
    fetch(
      `/api/reservations/week-availability?facilityId=${selectedFacility.id}&weekStart=${weekStart.format("YYYY-MM-DD")}`
    )
      .then((r) => r.json())
      .then((data) => setWeekData(data))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFacility?.id, weekStart.format("YYYY-MM-DD")]);

  // ─── 日付の有効判定 ─────────────────────────────────────────────────────
  function isDateDisabled(d: dayjs.Dayjs): boolean {
    const dateStr = d.format("YYYY-MM-DD");
    return dateStr < today || dateStr > maxDate;
  }

  // ─── セル状態 ─────────────────────────────────────────────────────────────
  function isBooked(date: string, slot: string): boolean {
    const slots = weekData[date] ?? [];
    const sm = timeToMin(slot);
    return slots.some((b) => sm >= timeToMin(b.start) && sm < timeToMin(b.end));
  }

  type CellState = "booked" | "free" | "sel-start" | "sel-range" | "sel-end";

  function getCellState(date: string, slot: string): CellState {
    if (isBooked(date, slot)) return "booked";
    if (selDate === date && selStart) {
      if (slot === selStart) return "sel-start";
      if (selEnd && slot === selEnd) return "sel-end";
      if (
        selEnd &&
        timeToMin(slot) > timeToMin(selStart) &&
        timeToMin(slot) < timeToMin(selEnd)
      )
        return "sel-range";
    }
    return "free";
  }

  // ─── セルクリック ──────────────────────────────────────────────────────────
  function handleCellClick(date: string, slot: string) {
    if (!selectedFacility || loading || isBooked(date, slot)) return;

    // 別の日をクリックしたらリセットして開始点に
    if (selDate && date !== selDate) {
      setSelDate(date);
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 1回目クリック（開始）or やり直し
    if (!selStart || (selStart && selEnd)) {
      setSelDate(date);
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 終了が開始以前ならリセット
    if (timeToMin(slot) <= timeToMin(selStart)) {
      setSelDate(date);
      setSelStart(slot);
      setSelEnd(null);
      return;
    }

    // 衝突チェック
    const bookedSlots = weekData[date] ?? [];
    const hasConflict = bookedSlots.some((b) => {
      const bs = timeToMin(b.start);
      const be = timeToMin(b.end);
      const ss = timeToMin(selStart);
      const se = timeToMin(slot);
      return bs < se && be > ss;
    });

    if (hasConflict) {
      alert("選択範囲に予約済みの時間が含まれています。");
      return;
    }

    setSelEnd(slot);
  }

  // ─── 予約ページへ ─────────────────────────────────────────────────────────
  function handleReserve() {
    if (!selectedFacility || !selDate || !selStart || !selEnd) return;
    router.push(
      `/reservation/confirm?facilityId=${selectedFacility.id}&date=${selDate}&startTime=${selStart}&endTime=${selEnd}`
    );
  }

  const canReserve = !!(selectedFacility && selDate && selStart && selEnd);
  const meetingRooms = FACILITIES.filter((f) => f.type === "meeting_room");
  const booths = FACILITIES.filter((f) => f.type === "booth");

  // ─── レンダリング ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <TopBar title="EIGHT CANAL BASE 施設予約" subtitle="Eight Design Shared Office" />

      {/* ステップ & マイ予約リンク */}
      <div className="px-3 pt-3 flex items-center gap-2">
        <div className="flex-1">
          <StepIndicator step={1} total={2} />
        </div>
        <Link
          href="/my-reservations"
          className="flex items-center gap-1 text-xs text-[#06C755] font-medium whitespace-nowrap"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="4" width="18" height="17" rx="3" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M8 3v2M16 3v2M3 9h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8 13h4M8 17h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          マイ予約
        </Link>
      </div>

      {/* 施設選択チップ */}
      <div className="px-3 pt-2 pb-1">
        <p className="text-[10px] font-medium text-gray-400 mb-1.5">会議室</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {meetingRooms.map((f) => (
            <FacilityChip
              key={f.id}
              facility={f}
              selected={selectedFacility?.id === f.id}
              onSelect={setSelectedFacility}
            />
          ))}
        </div>
        <p className="text-[10px] font-medium text-gray-400 mb-1.5 mt-2">リモートブース</p>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {booths.map((f) => (
            <FacilityChip
              key={f.id}
              facility={f}
              selected={selectedFacility?.id === f.id}
              onSelect={setSelectedFacility}
            />
          ))}
        </div>
      </div>

      {/* 週ナビゲーション */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <button
          className={clsx(
            "w-7 h-7 flex items-center justify-center rounded-full text-lg transition-colors",
            weekStart.format("YYYY-MM-DD") <= getMondayOf(dayjs()).format("YYYY-MM-DD")
              ? "text-gray-200 cursor-not-allowed"
              : "text-gray-400 hover:bg-gray-100"
          )}
          onClick={() => setWeekStart((w) => w.subtract(1, "week"))}
          disabled={weekStart.format("YYYY-MM-DD") <= getMondayOf(dayjs()).format("YYYY-MM-DD")}
        >
          ‹
        </button>
        <span className="text-xs font-medium text-gray-600">
          {weekStart.format("M/D")}（月）〜 {weekStart.add(4, "day").format("M/D")}（金）
        </span>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-full text-lg text-gray-400 hover:bg-gray-100 transition-colors"
          onClick={() => setWeekStart((w) => w.add(1, "week"))}
        >
          ›
        </button>
      </div>

      {/* カレンダーテーブル or プレースホルダー */}
      {!selectedFacility ? (
        <div className="flex-1 flex items-center justify-center px-8 py-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="2" y="5" width="18" height="15" rx="2" stroke="#9CA3AF" strokeWidth="1.5"/>
                <path d="M7 2v4M15 2v4M2 10h18" stroke="#9CA3AF" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p className="text-sm text-gray-400">施設を選択すると<br />空き状況が表示されます</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-3 pb-1">
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full border-collapse" style={{ tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "36px" }} />
                {weekDays.map((_, i) => <col key={i} />)}
              </colgroup>

              {/* 曜日ヘッダー */}
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-gray-100">
                  <th className="py-2 border-r border-gray-100" />
                  {weekDays.map((d, i) => {
                    const disabled = isDateDisabled(d);
                    const dateStr = d.format("YYYY-MM-DD");
                    const isToday = dateStr === today;
                    return (
                      <th
                        key={i}
                        className={clsx(
                          "text-center py-2 border-r border-gray-100 last:border-r-0",
                          "text-[10px] font-medium leading-tight"
                        )}
                      >
                        <span
                          className={clsx(
                            disabled
                              ? "text-gray-200"
                              : isToday
                              ? "text-[#06C755] font-bold"
                              : "text-gray-500"
                          )}
                        >
                          <div>{WEEK_DAYS_JA[i]}</div>
                          <div>{d.format("M/D")}</div>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>

              {/* タイムスロット */}
              <tbody>
                {ALL_SLOTS.map((slot) => {
                  const isHour = slot.endsWith(":00");
                  return (
                    <tr
                      key={slot}
                      className={clsx(
                        "border-b border-gray-50",
                        isHour && "border-t border-gray-100"
                      )}
                    >
                      {/* 時刻ラベル */}
                      <td
                        className={clsx(
                          "text-right pr-1.5 border-r border-gray-100",
                          "text-[9px] leading-none py-[5px]",
                          isHour ? "text-gray-500 font-semibold" : "text-gray-200"
                        )}
                      >
                        {isHour ? slot : ""}
                      </td>

                      {/* 各日のセル */}
                      {weekDays.map((d, i) => {
                        const dateStr = d.format("YYYY-MM-DD");
                        const disabled = isDateDisabled(d);

                        if (disabled) {
                          return (
                            <td
                              key={i}
                              className="border-r border-gray-100 last:border-r-0 bg-gray-50 py-[5px]"
                            />
                          );
                        }

                        const state = getCellState(dateStr, slot);

                        return (
                          <td
                            key={i}
                            onClick={() => handleCellClick(dateStr, slot)}
                            className={clsx(
                              "text-center py-[5px] border-r border-gray-100 last:border-r-0",
                              "select-none transition-colors",
                              loading && "opacity-30",
                              !loading && state !== "booked" && "cursor-pointer",
                              state === "free" && "hover:bg-green-50",
                              state === "booked" && "cursor-not-allowed",
                              state === "sel-start" && "bg-[#06C755]",
                              state === "sel-range" && "bg-green-100",
                              state === "sel-end" && "bg-[#05A847]"
                            )}
                          >
                            {loading ? (
                              <span className="text-gray-200 text-xs">·</span>
                            ) : state === "booked" ? (
                              <span className="text-gray-300 text-xs font-medium">×</span>
                            ) : state === "free" ? (
                              <span className="text-[#06C755] text-xs font-medium">○</span>
                            ) : (
                              <span className="text-white text-xs font-bold">●</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 凡例 */}
            <div className="flex gap-4 px-3 py-2 border-t border-gray-100 bg-gray-50">
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="text-[#06C755] font-medium text-xs">○</span> 空き
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="text-gray-300 font-medium text-xs">×</span> 予約済み
              </span>
              <span className="flex items-center gap-1 text-[10px] text-gray-400">
                <span className="text-[#06C755] font-bold text-xs">●</span> 選択中
              </span>
            </div>
          </div>
        </div>
      )}

      {/* フッター：選択情報 + 予約ボタン */}
      <div className="px-3 pt-2 pb-4 bg-white border-t border-gray-100">
        {canReserve ? (
          <>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[10px] text-gray-400">選択中</span>
              <div className="text-right">
                <span className="text-xs font-medium text-gray-800">
                  {dayjs(selDate!).format("M月D日（ddd）")}
                </span>
                <span className="ml-2 text-xs font-medium text-gray-800">
                  {selStart} 〜 {selEnd}
                </span>
              </div>
            </div>
            <button
              onClick={handleReserve}
              className="w-full py-3 rounded-xl text-sm font-medium bg-[#06C755] text-white"
            >
              予約する →
            </button>
          </>
        ) : (
          <p className="text-center text-xs text-gray-400 py-1.5">
            {!selectedFacility
              ? "施設を選択してください"
              : !selStart
              ? "開始時刻をタップしてください"
              : "終了時刻をタップしてください"}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── サブコンポーネント ────────────────────────────────────────────────────────

function FacilityChip({
  facility,
  selected,
  onSelect,
}: {
  facility: Facility;
  selected: boolean;
  onSelect: (f: Facility) => void;
}) {
  return (
    <button
      onClick={() => onSelect(facility)}
      className={clsx(
        "flex-shrink-0 px-3 py-1.5 rounded-full border text-xs font-medium transition-all whitespace-nowrap",
        selected
          ? "border-[#06C755] bg-[#06C755] text-white"
          : "border-gray-200 text-gray-600 bg-white hover:border-gray-300"
      )}
    >
      {facility.name}
      <span className={clsx("ml-1 text-[9px]", selected ? "text-green-100" : "text-gray-400")}>
        {facility.capacity}名
      </span>
    </button>
  );
}

function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex gap-1.5 justify-center my-1">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={clsx(
            "h-1 w-6 rounded-full transition-colors",
            i < step ? "bg-[#06C755]" : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}
