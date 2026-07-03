import { timeToMin } from "@/lib/date";

/** 予約タイムスロットのヘルパー（予約画面）。時刻→分は共通の timeToMin を利用。 */
export { timeToMin };

/**
 * タイムスロット生成（closeTime を含む）
 * closeTime は終了時刻としてのみ選択可能
 */
export function generateSlots(openTime: string, closeTime: string): string[] {
  const start = timeToMin(openTime);
  const end = timeToMin(closeTime);
  const slots: string[] = [];
  for (let t = start; t <= end; t += 30) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}
