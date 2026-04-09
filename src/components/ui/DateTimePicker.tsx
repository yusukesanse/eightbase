"use client";

import TimePicker from "./TimePicker";

interface DateTimePickerProps {
  /** "YYYY-MM-DDTHH:MM" format (same as datetime-local) */
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  className?: string;
}

export default function DateTimePicker({
  value,
  onChange,
  required,
  className = "",
}: DateTimePickerProps) {
  // Split "2025-04-09T14:00" → date="2025-04-09", time="14:00"
  const [datePart, timePart] = (value || "").split("T");
  const date = datePart || "";
  const time = timePart || "";

  function handleDateChange(d: string) {
    onChange(`${d}T${time || "09:00"}`);
  }

  function handleTimeChange(t: string) {
    onChange(`${date || new Date().toISOString().slice(0, 10)}T${t}`);
  }

  return (
    <div className={`flex gap-2 ${className}`}>
      {/* Date — native input (calendar UI is fine) */}
      <input
        type="date"
        value={date}
        onChange={(e) => handleDateChange(e.target.value)}
        required={required}
        className="flex-1 min-w-0 px-3 py-2.5 border border-[#414141]/15 rounded-xl text-sm text-[#414141] bg-white focus:outline-none focus:border-[#A5C1C8] focus:ring-2 focus:ring-[#A5C1C8]/20"
      />
      {/* Time — custom picker */}
      <TimePicker
        value={time}
        onChange={handleTimeChange}
        minTime="00:00"
        maxTime="23:30"
        step={30}
        placeholder="時刻"
        className="w-[130px] shrink-0"
      />
    </div>
  );
}
