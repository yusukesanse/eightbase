"use client";

import type { UserRole } from "@/lib/roles";

/**
 * コンテンツ公開時の LINE 配信設定（管理画面 news/events 共通）。
 * - 「LINE通知する」ON/OFF（公開時に配信するか）
 * - 配信対象 role（オフィス契約者=member / エイト社員=staff / ゲスト=guest）を複数選択
 * ※ ゲストは会員専用ルートに入れないため、ニュース/イベントのゲスト宛リンクは自動で /info になる。
 */

const ROLE_OPTIONS: { role: UserRole; label: string }[] = [
  { role: "member", label: "オフィス契約者" },
  { role: "staff", label: "エイト社員" },
  { role: "guest", label: "ゲスト" },
];

export function LineAudienceField({
  notify,
  audience,
  onNotifyChange,
  onAudienceChange,
}: {
  notify: boolean;
  audience: string[];
  onNotifyChange: (b: boolean) => void;
  onAudienceChange: (roles: string[]) => void;
}) {
  function toggle(role: UserRole) {
    onAudienceChange(audience.includes(role) ? audience.filter((r) => r !== role) : [...audience, role]);
  }

  return (
    <div className="rounded-lg border border-[#231714]/10 p-3 bg-gray-50/50">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={notify}
          onChange={(e) => onNotifyChange(e.target.checked)}
          className="w-4 h-4 accent-[#231714]"
        />
        <span className="text-sm font-bold text-[#231714]">公開時に LINE 通知する</span>
      </label>

      {notify && (
        <div className="mt-2.5">
          <div className="text-[11px] font-bold text-[#231714]/85 mb-1.5">配信対象（複数選択可）</div>
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((o) => {
              const on = audience.includes(o.role);
              return (
                <button
                  key={o.role}
                  type="button"
                  onClick={() => toggle(o.role)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    on ? "border-[#231714] bg-[#231714] text-white" : "border-[#231714]/15 bg-white text-[#231714]/85 hover:bg-gray-50"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {audience.length === 0 && (
            <p className="text-[11px] text-[#d8533a] mt-1.5">対象が未選択のため通知は送られません。</p>
          )}
          {audience.includes("guest") && (
            <p className="text-[11px] text-[#231714]/80 mt-1.5">
              ※ ゲスト宛のニュース/イベントのリンクは自動で「アプリを開く（/info）」になります。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
