"use client";

import { useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";
import { kanaIncludes } from "@/lib/kana";
import { Avatar } from "@/components/ui/LineContact";
import { GlassCard } from "@/components/ui/eb";
import {
  companionPickerReducer,
  isCompanionDropdownOpen,
  INITIAL_COMPANION_PICKER_STATE,
} from "./companionPickerState";

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
  // 候補ドロップダウンの開閉は reducer に切り出してある（companionPickerState.ts）。
  // 「選択後も続けて2人目を打てる」不変条件をテストで固定するため。
  const [picker, dispatch] = useReducer(companionPickerReducer, INITIAL_COMPANION_PICKER_STATE);
  const { query: q, focused } = picker;
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) dispatch({ type: "dismiss" });
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [focused]);

  if (!enabled) return null;

  function add(c: CompanionCandidate) {
    if (isFull || chosenIds.has(c.lineUserId)) return;
    onChange([...value, c]);
    // query が空になるので候補は閉じる。focused は保たれる（＝2人目をそのまま打てる）。
    dispatch({ type: "select" });
    // 選択後もキャレットとキーボードを input に残す。上限に達して disabled になった場合は no-op。
    inputRef.current?.focus();
  }

  function remove(lineUserId: string) {
    onChange(value.filter((v) => v.lineUserId !== lineUserId));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      dispatch({ type: "escape" });
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
  const open = isCompanionDropdownOpen(picker);

  return (
    <GlassCard padding="md">
      <h3 className="text-[15px] font-bold text-[color:var(--eb-ink)]">一緒に入る人</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-[color:var(--eb-ink-muted)]">
        この施設は1人ではご利用いただけません。合計{minTotal}名以上でご予約ください。
      </p>

      {/* 選択済み（チェック＋緑12%地） */}
      {value.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {value.map((c) => (
            <span
              key={c.lineUserId}
              className="inline-flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3"
              style={{ background: "rgba(35,147,94,.12)" }}
            >
              <Avatar src={c.pictureUrl} name={c.displayName} size={24} />
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <circle cx="8" cy="8" r="8" fill="var(--eb-green)" />
                <path d="M4.5 8l2.5 2.5L11.5 5.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span className="text-[13px] font-bold text-[color:var(--eb-green-text)]">{c.displayName}</span>
              <button
                type="button"
                onClick={() => remove(c.lineUserId)}
                aria-label={`${c.displayName}を外す`}
                className="flex h-5 w-5 items-center justify-center text-[14px] leading-none text-[color:var(--eb-green-text)]"
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
          className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--eb-ink-muted)]"
        >
          <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={q}
          disabled={isFull}
          onChange={(e) => dispatch({ type: "type", query: e.target.value })}
          onFocus={() => dispatch({ type: "focus" })}
          onKeyDown={onKeyDown}
          placeholder={isFull ? `同伴者は最大${maxCompanions}名までです` : "名前で検索…"}
          className="h-14 w-full rounded-2xl border border-[color:var(--eb-line)] bg-white pl-11 pr-4 text-[17px] text-[color:var(--eb-ink)] placeholder:text-[#9AA39E] transition-colors focus:border-2 focus:border-[color:var(--eb-green)] focus:outline-none disabled:opacity-60"
        />

        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-56 overflow-y-auto rounded-2xl border border-[color:var(--eb-line)] bg-white shadow-lg"
          >
            {suggestions.length === 0 ? (
              <li className="px-4 py-3 text-[13px] text-[color:var(--eb-ink-muted)]">
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
                    className={`flex h-14 w-full items-center gap-3 px-4 text-left transition-colors ${
                      i === activeIndex ? "bg-[color:var(--eb-tint)]" : "bg-white"
                    }`}
                  >
                    <Avatar src={c.pictureUrl} name={c.displayName} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold text-[color:var(--eb-ink)]">{c.displayName}</span>
                      {c.companyName && (
                        <span className="block truncate text-[12px] text-[color:var(--eb-ink-muted)]">{c.companyName}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      <p className="mt-3 text-[13px] text-[color:var(--eb-ink-muted)]">
        合計 <span className="font-bold text-[color:var(--eb-ink)]">{total}名</span>
        （あなた + {value.length}名）
        {shortBy > 0 && (
          <span style={{ color: "var(--eb-coral-text)" }}>　あと{shortBy}名選んでください</span>
        )}
      </p>

      {/* 上限に達したことを本文でも知らせる。placeholder だけだと「検索が壊れている」と
          区別がつかない（同伴者の上限は施設の定員-1 なので、定員2名なら1名で打ち止め）。 */}
      {isFull && (
        <p className="mt-1.5 text-[13px] text-[color:var(--eb-ink-muted)]">
          この施設で選べる同伴者は最大{maxCompanions}名です。
          変更するには選択済みの人を外してください。
        </p>
      )}
    </GlassCard>
  );
}
