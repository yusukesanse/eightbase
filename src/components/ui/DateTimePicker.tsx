"use client";

import DatePicker from "./DatePicker";
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
      <DatePicker
        value={date}
        onChange={handleDateChange}
        required={required}
        placeholder="日付"
        className="flex-1 min-w-0"
      />
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
