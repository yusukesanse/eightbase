"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SKILL_CATEGORIES, ALL_PRESET_SKILLS } from "@/types";

interface SocialLinks {
  instagram: string;
  x: string;
  facebook: string;
  other: string;
}

interface SkillsData {
  skills: string[];
  catchphrase: string;
  companyUrl: string;
  socialLinks?: Partial<SocialLinks>;
}

const EMPTY_SOCIAL: SocialLinks = { instagram: "", x: "", facebook: "", other: "" };

export default function SkillsSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [customSkill, setCustomSkill] = useState("");
  const [catchphrase, setCatchphrase] = useState("");
  const [companyUrl, setCompanyUrl] = useState("");
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(EMPTY_SOCIAL);
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/mypage", { credentials: "include" });
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data: SkillsData = await res.json();
        setSelectedSkills(data.skills || []);
        setCatchphrase(data.catchphrase || "");
        setCompanyUrl(data.companyUrl || "");
        setSocialLinks({
          instagram: data.socialLinks?.instagram || "",
          x: data.socialLinks?.x || "",
          facebook: data.socialLinks?.facebook || "",
          other: data.socialLinks?.other || "",
        });
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [router]);

  function toggleSkill(skill: string) {
    setSelectedSkills((prev) =>
      prev.includes(skill)
        ? prev.filter((s) => s !== skill)
        : [...prev, skill]
    );
  }

  function addCustomSkill() {
    const trimmed = customSkill.trim();
    if (trimmed && !selectedSkills.includes(trimmed)) {
      setSelectedSkills((prev) => [...prev, trimmed]);
      setCustomSkill("");
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/mypage/skills", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: selectedSkills, catchphrase, companyUrl, socialLinks }),
      });
      if (res.ok) {
        router.push("/mypage");
      }
    } catch (e) {
      console.error("save error:", e);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#A5C1C8] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">読み込み中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white pt-12 pb-4 px-5 border-b border-gray-100 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4l-6 6 6 6" stroke="#231714" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1 className="text-[15px] font-medium text-[#231714]">スキル・サービス設定</h1>
      </header>

      {/* キャッチコピー */}
      <div className="bg-white mt-3 px-5 py-4 border-b border-gray-100">
        <label className="block text-[12px] text-[#231714]/50 mb-2">キャッチコピー</label>
        <input
          type="text"
          value={catchphrase}
          onChange={(e) => setCatchphrase(e.target.value)}
          placeholder="例: Web制作なら何でもお任せ！"
          maxLength={40}
          className="w-full px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
        />
        <p className="text-[10px] text-gray-300 mt-1 text-right">{catchphrase.length}/40</p>
      </div>

      {/* 選択中のスキル */}
      {selectedSkills.length > 0 && (
        <div className="bg-white mt-3 px-5 py-4 border-b border-gray-100">
          <p className="text-[12px] text-[#231714]/50 mb-3">選択中のスキル ({selectedSkills.length})</p>
          <div className="flex flex-wrap gap-2">
            {selectedSkills.map((skill) => (
              <button
                key={skill}
                onClick={() => toggleSkill(skill)}
                className="flex items-center gap-1 px-3 py-1.5 text-[11px] rounded-full bg-[#A5C1C8] text-white"
              >
                {skill}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* カテゴリ別スキル選択 */}
      <div className="mt-3">
        {SKILL_CATEGORIES.map((cat) => (
          <div key={cat.id} className="bg-white border-b border-gray-50">
            <button
              onClick={() => setOpenCategory(openCategory === cat.id ? null : cat.id)}
              className="w-full px-5 py-3.5 flex items-center justify-between text-left"
            >
              <span className="text-[13px] text-[#231714]">{cat.label}</span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                className={`transition-transform ${openCategory === cat.id ? "rotate-90" : ""}`}
              >
                <path d="M5 3l4 4-4 4" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {openCategory === cat.id && (
              <div className="px-5 pb-4 flex flex-wrap gap-2">
                {cat.skills.map((skill) => {
                  const active = selectedSkills.includes(skill);
                  return (
                    <button
                      key={skill}
                      onClick={() => toggleSkill(skill)}
                      className={`px-3 py-1.5 text-[11px] rounded-full border transition-colors ${
                        active
                          ? "bg-[#A5C1C8] text-white border-[#A5C1C8]"
                          : "bg-white text-[#231714]/60 border-gray-200 hover:border-[#A5C1C8]"
                      }`}
                    >
                      {skill}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* カスタムスキル追加 */}
      <div className="bg-white mt-3 px-5 py-4 border-b border-gray-100">
        <label className="block text-[12px] text-[#231714]/50 mb-2">その他のスキルを追加</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customSkill}
            onChange={(e) => setCustomSkill(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustomSkill()}
            placeholder="スキル名を入力"
            className="flex-1 px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
          />
          <button
            onClick={addCustomSkill}
            disabled={!customSkill.trim()}
            className="px-4 py-2.5 text-[12px] rounded-lg bg-[#A5C1C8] text-white disabled:opacity-40 transition-opacity"
          >
            追加
          </button>
        </div>
      </div>

      {/* 会社URL */}
      <div className="bg-white mt-3 px-5 py-4 border-b border-gray-100">
        <label className="block text-[12px] text-[#231714]/50 mb-2">会社・事業のURL</label>
        <input
          type="url"
          value={companyUrl}
          onChange={(e) => setCompanyUrl(e.target.value)}
          placeholder="https://example.com"
          className="w-full px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
        />
        <p className="text-[10px] text-gray-300 mt-1">URLを登録すると、メンバーページからあなたの事業が見つけやすくなります</p>
      </div>

      {/* SNS・リンク */}
      <div className="bg-white mt-3 px-5 py-4 border-b border-gray-100">
        <label className="block text-[12px] text-[#231714]/50 mb-2">SNS・リンク</label>
        <p className="text-[10px] text-gray-300 mb-3">メンバーとの交流のきっかけになります</p>
        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="w-8 text-center text-sm">𝕏</span>
            <input
              type="text"
              value={socialLinks.x}
              onChange={(e) => setSocialLinks((p) => ({ ...p, x: e.target.value }))}
              placeholder="@username"
              className="flex-1 px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 text-center text-[13px]">IG</span>
            <input
              type="text"
              value={socialLinks.instagram}
              onChange={(e) => setSocialLinks((p) => ({ ...p, instagram: e.target.value }))}
              placeholder="@username"
              className="flex-1 px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 text-center text-[13px]">FB</span>
            <input
              type="text"
              value={socialLinks.facebook}
              onChange={(e) => setSocialLinks((p) => ({ ...p, facebook: e.target.value }))}
              placeholder="https://facebook.com/..."
              className="flex-1 px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 text-center text-[11px] text-[#231714]/40">他</span>
            <input
              type="text"
              value={socialLinks.other}
              onChange={(e) => setSocialLinks((p) => ({ ...p, other: e.target.value }))}
              placeholder="その他のURL"
              className="flex-1 px-3 py-2.5 text-[13px] bg-gray-50 rounded-lg border border-gray-100 focus:outline-none focus:border-[#A5C1C8]"
            />
          </div>
        </div>
      </div>

      {/* 保存ボタン */}
      <div className="fixed bottom-16 left-0 right-0 max-w-md mx-auto px-5 py-3 bg-white border-t border-gray-100">
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 text-[14px] font-medium rounded-xl bg-[#A5C1C8] text-white disabled:opacity-50 transition-opacity"
        >
          {saving ? "保存中..." : "保存する"}
        </button>
      </div>
    </div>
  );
}
