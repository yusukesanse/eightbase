"use client";

/** 管理ユーザー画面の一覧/詳細で共有する小物（有効バッジ・表示ラベル）。 */

export const GENDER_LABELS: Record<string, string> = {
  male: "男性",
  female: "女性",
  other: "その他",
  prefer_not_to_say: "回答しない",
};

export const ADDRESS_TYPE_LABELS: Record<string, string> = {
  home: "自宅住所",
  office: "会社住所",
};

export function Badge({ active }: { active: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        active ? "bg-[#B0E401]/20 text-[#231714]" : "bg-[#231714]/10 text-[#231714]/60"
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-[#B0E401]" : "bg-[#231714]/40"}`} />
      {active ? "有効" : "無効"}
    </span>
  );
}
