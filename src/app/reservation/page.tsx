"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/ui/TopBar";
import { FACILITIES } from "@/lib/facilities";
import type { Facility } from "@/types";
import clsx from "clsx";
import dayjs from "dayjs";
import "dayjs/locale/ja";
dayjs.locale("ja");

const DAYS = ["日", "月", "火", "水", "木", "金", "土"];

export default function ReservationPage() {
  const router = useRouter();
  const [selectedFacility, setSelectedFacility] = useState<Facility | null>(null);
  const [currentMonth, setCurrentMonth] = useState(dayjs().startOf("month"));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const meetingRooms = FACILITIES.filter((f) => f.type === "meeting_room");
  const booths = FACILITIES.filter((f) => f.type === "booth");

  const today = dayjs().format("YYYY-MM-DD");
  const maxDate = dayjs().add(30, "day").format("YYYY-MM-DD");

  // カレンダー日付一覧生成
  const firstDay = currentMonth.day(); // 0=日
  const daysInMonth = currentMonth.daysInMonth();
  const calDays: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function isDisabled(day: number) {
    const d = currentMonth.date(day).format("YYYY-MM-DD");
    const dow = currentMonth.date(day).day();
    return d < today || d > maxDate || dow === 0 || dow === 6;
  }

  function handleNext() {
    if (!selectedFacility || !selectedDate) return;
    router.push(
      `/reservation/timeslot?facilityId=${selectedFacility.id}&date=${selectedDate}`
    );
  }

  return (
    <div>
      <TopBar title="NUF 施設予約" subtitle="Eight Design Shared Office" />

      <div className="p-3 space-y-3">
        {/* ステップ */}
        <StepIndicator step={1} total={4} />

        {/* 施設選択 */}
        <section className="bg-white rounded-xl border border-gray-100 p-3">
          <p className="text-xs font-medium text-gray-400 mb-2">会議室</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {meetingRooms.map((f) => (
              <FacilityButton
                key={f.id}
                facility={f}
                selected={selectedFacility?.id === f.id}
                onSelect={setSelectedFacility}
              />
            ))}
          </div>
          <p className="text-xs font-medium text-gray-400 mb-2">リモートブース</p>
          <div className="grid grid-cols-2 gap-2">
            {booths.map((f) => (
              <FacilityButton
                key={f.id}
                facility={f}
                selected={selectedFacility?.id === f.id}
                onSelect={setSelectedFacility}
              />
            ))}
          </div>
        </section>

        {/* 日付選択カレンダー */}
        <section className="bg-white rounded-xl border border-gray-100 p-3">
          <div className="flex justify-between items-center mb-3">
            <button
              className="text-gray-400 px-1 text-lg"
              onClick={() => setCurrentMonth((m) => m.subtract(1, "month"))}
              disabled={currentMonth.isBefore(dayjs().startOf("month"))}
            >
              ‹
            </button>
            <span className="text-sm font-medium">
              {currentMonth.format("YYYY年 M月")}
            </span>
            <button
              className="text-gray-400 px-1 text-lg"
              onClick={() => setCurrentMonth((m) => m.add(1, "month"))}
            >
              ›
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {DAYS.map((d) => (
              <div key={d} className="text-[9px] text-gray-400 font-medium py-1">
                {d}
              </div>
            ))}
            {calDays.map((day, i) => {
              if (!day) return <div key={`empty-${i}`} />;
              const dateStr = currentMonth.date(day).format("YYYY-MM-DD");
              const disabled = isDisabled(day);
              const isToday = dateStr === today;
              const isSelected = dateStr === selectedDate;
              return (
                <button
                  key={day}
                  disabled={disabled}
                  onClick={() => setSelectedDate(dateStr)}
                  className={clsx(
                    "text-[11px] py-1.5 rounded-md transition-colors",
                    disabled && "text-gray-200 cursor-not-allowed",
                    !disabled && !isSelected && !isToday && "text-gray-700 hover:bg-gray-100",
                    isToday && !isSelected && "bg-[#06C755] text-white font-medium",
                    isSelected && "bg-green-50 text-green-700 border border-[#06C755]"
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="px-3 pb-3">
        <button
          onClick={handleNext}
          disabled={!selectedFacility || !selectedDate}
          className={clsx(
            "w-full py-3 rounded-xl text-sm font-medium transition-colors",
            selectedFacility && selectedDate
              ? "bg-[#06C755] text-white"
              : "bg-gray-200 text-gray-400 cursor-not-allowed"
          )}
        >
          時間を選択する →
        </button>
      </div>
    </div>
  );
}

function FacilityButton({
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
        "p-2 rounded-lg border text-left text-xs transition-all",
        selected
          ? "border-[#06C755] bg-green-50 text-green-800"
          : "border-gray-200 text-gray-700 hover:border-gray-300"
      )}
    >
      <div className="font-medium">{facility.name}</div>
      <div className={clsx("text-[10px] mt-0.5", selected ? "text-green-600" : "text-gray-400")}>
        最大 {facility.capacity} 名
      </div>
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
            "h-1 w-5 rounded-full transition-colors",
            i < step ? "bg-[#06C755]" : "bg-gray-200"
          )}
        />
      ))}
    </div>
  );
}
