"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { SKILL_CATEGORIES } from "@/types";
import { useStaleWhileRevalidate } from "@/hooks/useStaleWhileRevalidate";

interface MemberItem {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  catchphrase: string;
  skills: string[];
  companyName: string;
  jobTitle: string;
}

const EMPTY_MEMBERS: MemberItem[] = [];

export default function MembersPage() {
  const router = useRouter();

  // 前回表示を即出し→裏で再取得（sessionStorage）。auth/active 判定は API 側に任せ、
  // 401 のときだけログインへ。キャッシュは表示の高速化のみに使う。
  const { data, isLoading } = useStaleWhileRevalidate<MemberItem[]>(
    "members:list",
    async () => {
      const res = await fetch("/api/members", {
        credentials: "include",
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) router.replace("/login");
        throw new Error("failed to load members");
      }
      return res.json();
    }
  );
  const members = data ?? EMPTY_MEMBERS;
  // フルスクリーンスピナーは初回（キャッシュ無し）のみ
  const loading = isLoading;

  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* サジェスト外クリックで閉じる */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 全メンバーが持つスキルのユニーク一覧（出現頻度順）
  const allSkills = useMemo(() => {
    const counts = new Map<string, number>();
    members.forEach((m) =>
      m.skills.forEach((s) => counts.set(s, (counts.get(s) || 0) + 1))
    );
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([skill]) => skill);
  }, [members]);

  // 全メンバーの名前一覧
  const allNames = useMemo(() => {
    return members.map((m) => m.displayName);
  }, [members]);

  /* ── ひらがな↔カタカナ変換ユーティリティ ── */
  function toKatakana(str: string) {
    return str.replace(/[ぁ-ゖ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) + 0x60)
    );
  }
  function toHiragana(str: string) {
    return str.replace(/[ァ-ヶ]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0x60)
    );
  }
  /** ひらがな・カタカナ両方で部分一致判定 */
  function kanaIncludes(target: string, query: string) {
    const t = target.toLowerCase();
    const q = query.toLowerCase();
    return (
      t.includes(q) ||
      t.includes(toKatakana(q)) ||
      t.includes(toHiragana(q))
    );
  }

  /* ── サジェスト候補を生成 ── */
  const suggestions = useMemo(() => {
    const q = search.trim();
    if (!q) return [];

    const results: { type: "skill" | "member"; label: string; count?: number }[] = [];

    // スキル候補（ひらがな/カタカナ両対応の部分一致、出現数付き）
    const skillCounts = new Map<string, number>();
    members.forEach((m) =>
      m.skills.forEach((s) => skillCounts.set(s, (skillCounts.get(s) || 0) + 1))
    );
    allSkills
      .filter((s) => kanaIncludes(s, q))
      .slice(0, 5)
      .forEach((s) => {
        results.push({ type: "skill", label: s, count: skillCounts.get(s) || 0 });
      });

    // メンバー名候補（ひらがな/カタカナ両対応）
    allNames
      .filter((n) => kanaIncludes(n, q))
      .slice(0, 3)
      .forEach((n) => {
        results.push({ type: "member", label: n });
      });

    return results;
  }, [search, members, allSkills, allNames]);

  /* サジェスト選択ハンドラ */
  const handleSelectSuggestion = useCallback((suggestion: { type: "skill" | "member"; label: string }) => {
    if (suggestion.type === "skill") {
      setSelectedSkill(suggestion.label);
      setSearch("");
    } else {
      setSearch(suggestion.label);
    }
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  }, []);

  /* キーボードナビ */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!showSuggestions || suggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev < suggestions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedSuggestionIndex((prev) =>
        prev > 0 ? prev - 1 : suggestions.length - 1
      );
    } else if (e.key === "Enter" && selectedSuggestionIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(suggestions[selectedSuggestionIndex]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
      setSelectedSuggestionIndex(-1);
    }
  }, [showSuggestions, suggestions, selectedSuggestionIndex, handleSelectSuggestion]);

  // フィルタリング
  const filtered = useMemo(() => {
    let list = members;

    if (selectedSkill) {
      list = list.filter((m) => m.skills.includes(selectedSkill));
    }

    if (search.trim()) {
      const q = search.trim();
      list = list.filter(
        (m) =>
          kanaIncludes(m.displayName, q) ||
          kanaIncludes(m.catchphrase, q) ||
          kanaIncludes(m.companyName || "", q) ||
          m.skills.some((s) => kanaIncludes(s, q))
      );
    }

    return list;
  }, [members, selectedSkill, search]);

  /* マッチ部分をハイライト */
  function highlightMatch(text: string, query: string) {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <span className="text-[#A5C1C8] font-bold">{text.slice(idx, idx + query.length)}</span>
        {text.slice(idx + query.length)}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white pt-12 pb-4 px-5">
        <h1 className="text-[17px] font-medium text-[#231714]">メンバー</h1>
        <p className="text-[11px] text-[#231714]/40 mt-1">
          {members.length}人のメンバー
        </p>
      </header>

      {/* 検索バー + サジェスト */}
      <div className="bg-white px-5 pb-3 border-b border-gray-100">
        <div className="relative" ref={searchRef}>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 z-10"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowSuggestions(true);
              setSelectedSuggestionIndex(-1);
            }}
            onFocus={() => {
              if (search.trim()) setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="名前・スキル・会社名で検索..."
            className="w-full pl-9 pr-4 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8] transition-colors"
          />

          {/* クリアボタン */}
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setShowSuggestions(false);
                inputRef.current?.focus();
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 2l6 6M8 2l-6 6" stroke="#666" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* サジェストドロップダウン */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50">
              {suggestions.map((s, i) => (
                <button
                  key={`${s.type}-${s.label}`}
                  onClick={() => handleSelectSuggestion(s)}
                  className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
                    i === selectedSuggestionIndex
                      ? "bg-[#A5C1C8]/10"
                      : "hover:bg-gray-50"
                  }`}
                >
                  {/* アイコン */}
                  {s.type === "skill" ? (
                    <span className="w-6 h-6 rounded-full bg-[#A5C1C8]/15 flex items-center justify-center shrink-0">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M8 1.5l1.76 3.52 3.84.56-2.8 2.72.64 3.84L8 10.44l-3.44 1.8.64-3.84-2.8-2.72 3.84-.56L8 1.5z" stroke="#A5C1C8" strokeWidth="1.2" strokeLinejoin="round" />
                      </svg>
                    </span>
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-[#B0E401]/15 flex items-center justify-center shrink-0">
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <circle cx="8" cy="5" r="3" stroke="#7BA801" strokeWidth="1.2" />
                        <path d="M2.5 14c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5" stroke="#7BA801" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                    </span>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-[#231714] truncate">
                      {highlightMatch(s.label, search.trim())}
                    </p>
                    <p className="text-[10px] text-[#231714]/35">
                      {s.type === "skill"
                        ? `スキル · ${s.count}人が登録`
                        : "メンバー"
                      }
                    </p>
                  </div>
                  {s.type === "skill" && (
                    <span className="text-[10px] text-[#A5C1C8] shrink-0">タップで絞り込み</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* スキルフィルタ */}
      {allSkills.length > 0 && (
        <div className="bg-white px-5 py-3 border-b border-gray-100 overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setSelectedSkill("")}
              className={`px-3 py-1.5 text-[11px] rounded-full border whitespace-nowrap transition-colors ${
                !selectedSkill
                  ? "bg-[#A5C1C8] text-white border-[#A5C1C8]"
                  : "bg-white text-[#231714]/50 border-gray-200"
              }`}
            >
              すべて
            </button>
            {allSkills.map((skill) => (
              <button
                key={skill}
                onClick={() =>
                  setSelectedSkill(selectedSkill === skill ? "" : skill)
                }
                className={`px-3 py-1.5 text-[11px] rounded-full border whitespace-nowrap transition-colors ${
                  selectedSkill === skill
                    ? "bg-[#A5C1C8] text-white border-[#A5C1C8]"
                    : "bg-white text-[#231714]/50 border-gray-200"
                }`}
              >
                {skill}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 選択中のスキルフィルタ表示 */}
      {selectedSkill && (
        <div className="bg-white px-5 py-2 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#231714]/40">絞り込み中:</span>
            <button
              onClick={() => setSelectedSkill("")}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full bg-[#A5C1C8]/15 text-[#A5C1C8] font-medium"
            >
              {selectedSkill}
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* メンバー一覧 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-8 h-8 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" className="mb-3 text-gray-200">
            <path d="M15 18a6 6 0 100-12 6 6 0 000 12zM3 34c0-6 5-10 12-10s12 4 12 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <path d="M27 6a6 6 0 010 12M33 24c4 1 7 4 7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <p className="text-sm text-gray-400">
            {search || selectedSkill
              ? "該当するメンバーが見つかりません"
              : "まだメンバーがいません"}
          </p>
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {filtered.map((member) => (
            <MemberCard
              key={member.lineUserId}
              member={member}
              onClick={() => router.push(`/members/${member.lineUserId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MemberCard({
  member,
  onClick,
}: {
  member: MemberItem;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full bg-white rounded-xl p-4 flex items-start gap-3 text-left shadow-sm hover:shadow transition-shadow"
    >
      {member.pictureUrl ? (
        <img
          src={member.pictureUrl}
          alt=""
          className="w-12 h-12 rounded-full object-cover flex-shrink-0"
        />
      ) : (
        <div className="w-12 h-12 rounded-full bg-[#A5C1C8]/20 flex items-center justify-center flex-shrink-0">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 3a3.5 3.5 0 013.5 3.5v0A3.5 3.5 0 0110 10v0a3.5 3.5 0 01-3.5-3.5v0A3.5 3.5 0 0110 3z" stroke="#A5C1C8" strokeWidth="1.3" />
            <path d="M3 17c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="#A5C1C8" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-medium text-[#231714] truncate">
          {member.displayName}
        </p>
        {(member.companyName || member.jobTitle) && (
          <p className="text-[12px] text-[#231714]/60 mt-0.5 truncate">
            {member.companyName && member.jobTitle
              ? `${member.companyName} の ${member.jobTitle}`
              : member.companyName || member.jobTitle}
          </p>
        )}
        {member.catchphrase && (
          <p className="text-[11px] text-[#231714]/40 mt-0.5 truncate">
            {member.catchphrase}
          </p>
        )}
        {member.skills.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {member.skills.slice(0, 4).map((skill) => (
              <span
                key={skill}
                className="px-2 py-0.5 text-[10px] rounded-full bg-[#A5C1C8]/10 text-[#A5C1C8]"
              >
                {skill}
              </span>
            ))}
            {member.skills.length > 4 && (
              <span className="px-2 py-0.5 text-[10px] rounded-full bg-gray-50 text-gray-400">
                +{member.skills.length - 4}
              </span>
            )}
          </div>
        )}
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="mt-1 flex-shrink-0">
        <path d="M5 3l4 4-4 4" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
