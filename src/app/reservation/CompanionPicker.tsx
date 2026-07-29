"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { kanaIncludes } from "@/lib/kana";
import { Avatar } from "@/components/ui/LineContact";

export interface CompanionCandidate {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  companyName: string;
}

interface CompanionPickerProps {
  /** 施設が同伴者必須か。false なら候補の取得もしない（既存施設に負荷をかけない） */
  enabled: boolean;
  value: CompanionCandidate[];
  onChange: (next: CompanionCandidate[]) => void;
  /** 最低合計人数（予約者本人を含む） */
  minTotal: number;
  /** 選べる同伴者の上限人数 */
  maxCompanions: number;
}

const EMPTY: CompanionCandidate[] = [];
/** 候補ドロップダウンの表示上限。多すぎると指で辿れない */
const MAX_SUGGESTIONS = 20;

/**
 * 「一緒に入る人」を予測変換で選ぶピッカー。
 *
 * 候補は1回だけまとめて取得し、絞り込みはメモリで行う（打鍵のたびに Firestore を読まない）。
 * 選べるのはアプリ利用者（ゲストを除く）のみで、その判定はサーバー側 API が持つ。
 */
export function CompanionPicker({
  enabled,
  value,
  onChange,
  minTotal,
  maxCompanions,
}: CompanionPickerProps) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // key=null で無効化。描画だけ止めると既存施設でも候補APIを叩いてしまう。
  // 名前空間を members にすることで swrCache の TTL 5分・sessionStorage 既定に相乗りする。
  const { data, isLoading } = useStaleWhileRevalidate<{ candidates: CompanionCandidate[] }>(
    enabled ? "members:companions" : null,
    async () => {
      const res = await fetch("/api/reservations/companions", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) throw new Error("failed to load companion candidates");
      return res.json();
    }
  );
  const candidates = data?.candidates ?? EMPTY;

  const chosenIds = useMemo(() => new Set(value.map((v) => v.lineUserId)), [value]);
  const isFull = value.length >= maxCompanions;

  const suggestions = useMemo(() => {
    const t = q.trim();
    if (!t) return EMPTY;
    return candidates
      .filter((c) => !chosenIds.has(c.lineUserId))
      .filter((c) => kanaIncludes(c.displayName, t) || kanaIncludes(c.companyName, t))
      .slice(0, MAX_SUGGESTIONS);
  }, [candidates, q, chosenIds]);

  useEffect(() => {
    setActiveIndex(0);
  }, [q]);

  // 外側タップで候補を閉じる（LINEミニアプリではフォーカス外れが取りこぼされることがある）
  useEffect(() => {
    if (!focused) return;
    function onPointerDown(e: PointerEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [focused]);

  if (!enabled) return null;

  function add(c: CompanionCandidate) {
    if (isFull || chosenIds.has(c.lineUserId)) return;
    onChange([...value, c]);
    setQ("");
    setFocused(false);
  }

  function remove(lineUserId: string) {
    onChange(value.filter((v) => v.lineUserId !== lineUserId));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setFocused(false);
      return;
    }
    if (suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      add(suggestions[activeIndex]);
    }
  }

  const total = 1 + value.length;
  const shortBy = Math.max(0, minTotal - total);
  const open = focused && q.trim() !== "";

  return (
    <div className="bg-white rounded-[18px] border border-[#eceff1] p-4">
      <h3 className="text-[14px] font-bold text-[#1c1f21]">一緒に入る人</h3>
      <p className="text-[12px] text-[#45484d] mt-1 leading-relaxed">
        この施設は1人ではご利用いただけません。合計{minTotal}名以上でご予約ください。
      </p>

      {/* 選択済み */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-3">
          {value.map((c) => (
            <span
              key={c.lineUserId}
              className="inline-flex items-center gap-1.5 bg-[#f3f5f6] rounded-full pl-1 pr-1.5 py-1"
            >
              <Avatar src={c.pictureUrl} name={c.displayName} size={24} />
              <span className="text-[12px] text-[#1c1f21]">{c.displayName}</span>
              <button
                type="button"
                onClick={() => remove(c.lineUserId)}
                aria-label={`${c.displayName}を外す`}
                className="w-5 h-5 flex items-center justify-center text-[#45484d] text-[14px] leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 検索窓 + 候補 */}
      <div ref={boxRef} className="relative mt-3">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3f4247]"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={q}
          disabled={isFull}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={isFull ? `同伴者は最大${maxCompanions}名までです` : "名前で検索…"}
          className="w-full pl-9 pr-4 py-2.5 text-[14px] bg-[#f3f5f6] rounded-xl border border-[#eceff1] focus:outline-none focus:border-[#a5c1c7] transition-colors disabled:opacity-60"
        />

        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 left-0 right-0 top-[calc(100%+4px)] max-h-56 overflow-y-auto bg-white rounded-xl border border-[#eceff1] shadow-lg"
          >
            {suggestions.length === 0 ? (
              <li className="px-3 py-3 text-[12px] text-[#45484d]">
                {isLoading ? "読み込み中…" : "該当する利用者がいません"}
              </li>
            ) : (
              suggestions.map((c, i) => (
                <li key={c.lineUserId} role="option" aria-selected={i === activeIndex}>
                  <button
                    type="button"
                    // input の blur より先に選択を確定させる
                    onPointerDown={(e) => {
                      e.preventDefault();
                      add(c);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left ${
                      i === activeIndex ? "bg-[#f3f5f6]" : "bg-white"
                    }`}
                  >
                    <Avatar src={c.pictureUrl} name={c.displayName} size={32} />
                    <span className="min-w-0">
                      <span className="block text-[13px] text-[#1c1f21] truncate">{c.displayName}</span>
                      {c.companyName && (
                        <span className="block text-[11px] text-[#45484d] truncate">{c.companyName}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <p className="text-[12px] text-[#45484d] mt-3">
        合計 <span className="font-bold text-[#1c1f21]">{total}名</span>
        （あなた + {value.length}名）
        {shortBy > 0 && (
          <span className="text-[#b4543f]">　あと{shortBy}名選んでください</span>
        )}
      </p>
    </div>
  );
}
