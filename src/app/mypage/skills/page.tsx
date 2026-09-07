"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { SKILL_CATEGORIES } from "@/types";
import { Button, GlassCard, PageBg, PageHeading, inputClass } from "@/components/ui/eb";

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
  lineUrl?: string;
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
  const [lineUrl, setLineUrl] = useState("");
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
        setLineUrl(data.lineUrl || "");
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
        body: JSON.stringify({ skills: selectedSkills, catchphrase, companyUrl, socialLinks, lineUrl }),
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
      <PageBg className="flex items-center justify-center">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
            style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
          />
          <p className="text-[15px] text-[color:var(--eb-ink-muted)]">読み込み中...</p>
        </div>
      </PageBg>
    );
  }

  return (
    <PageBg>
      <div className="px-5 pt-[52px]">
        <button
          onClick={() => router.back()}
          className="mb-3 flex h-9 w-9 items-center justify-center -ml-2"
          aria-label="戻る"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4l-6 6 6 6" stroke="var(--eb-ink)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <PageHeading title="スキル・サービス設定" />
      </div>

      <div className="px-5 pt-6 pb-10 space-y-4">
        {/* キャッチコピー */}
        <GlassCard>
          <SectionHeading title="キャッチコピー" />
          <input
            type="text"
            value={catchphrase}
            onChange={(e) => setCatchphrase(e.target.value)}
            placeholder="例: Web制作なら何でもお任せ！"
            maxLength={40}
            className={inputClass}
          />
          <p className="mt-1.5 text-right text-[12px] text-[color:var(--eb-ink-muted)]">{catchphrase.length}/40</p>
        </GlassCard>

        {/* スキル */}
        <GlassCard>
          <SectionHeading title="スキル・得意分野" />
          <p className="mb-3 text-[13px] text-[color:var(--eb-ink-muted)]">メンバー検索で見つけてもらいやすくなります。</p>
          {selectedSkills.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {selectedSkills.map((skill) => (
                <SkillChip key={skill} label={skill} onRemove={() => toggleSkill(skill)} />
              ))}
            </div>
          )}
          {SKILL_CATEGORIES.map((cat) => (
            <CategoryRow
              key={cat.id}
              label={cat.label}
              open={openCategory === cat.id}
              onToggle={() => setOpenCategory(openCategory === cat.id ? null : cat.id)}
            >
              {cat.skills.map((skill) => (
                <ToggleButton key={skill} selected={selectedSkills.includes(skill)} onClick={() => toggleSkill(skill)} label={skill} />
              ))}
            </CategoryRow>
          ))}
          <div className="flex gap-2 mt-2">
            <input
              type="text"
              value={customSkill}
              onChange={(e) => setCustomSkill(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomSkill())}
              placeholder="その他のスキルを追加"
              className={clsx("flex-1", inputClass)}
            />
            <Button type="button" variant="ghost" fullWidth={false} className="w-24" disabled={!customSkill.trim()} onClick={addCustomSkill}>
              追加
            </Button>
          </div>
        </GlassCard>

        {/* 会社URL */}
        <GlassCard>
          <SectionHeading title="会社・事業のURL" />
          <input
            type="url"
            value={companyUrl}
            onChange={(e) => setCompanyUrl(e.target.value)}
            placeholder="https://example.com"
            className={inputClass}
          />
          <p className="mt-1.5 text-[12px] text-[color:var(--eb-ink-muted)]">
            URLを登録すると、メンバーページからあなたの事業が見つけやすくなります
          </p>
        </GlassCard>

        {/* SNS・リンク */}
        <GlassCard>
          <SectionHeading title="SNS・リンク" />
          <p className="mb-3 text-[13px] text-[color:var(--eb-ink-muted)]">メンバーとの交流のきっかけになります</p>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="w-8 text-center text-[15px]">𝕏</span>
              <input type="text" value={socialLinks.x} onChange={(e) => setSocialLinks((p) => ({ ...p, x: e.target.value }))} placeholder="@username" className={clsx("flex-1", inputClass)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 text-center text-[13px]">IG</span>
              <input type="text" value={socialLinks.instagram} onChange={(e) => setSocialLinks((p) => ({ ...p, instagram: e.target.value }))} placeholder="@username" className={clsx("flex-1", inputClass)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 text-center text-[13px]">FB</span>
              <input type="text" value={socialLinks.facebook} onChange={(e) => setSocialLinks((p) => ({ ...p, facebook: e.target.value }))} placeholder="https://facebook.com/..." className={clsx("flex-1", inputClass)} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-8 text-center text-[13px] text-[color:var(--eb-ink-muted)]">他</span>
              <input type="text" value={socialLinks.other} onChange={(e) => setSocialLinks((p) => ({ ...p, other: e.target.value }))} placeholder="その他のURL" className={clsx("flex-1", inputClass)} />
            </div>
          </div>
        </GlassCard>

        {/* LINE連絡先 */}
        <GlassCard>
          <SectionHeading title="LINE連絡先（友だち追加URL）" />
          <input
            type="url"
            value={lineUrl}
            onChange={(e) => setLineUrl(e.target.value)}
            placeholder="https://line.me/ti/p/～ または LINEの友だち追加URL"
            className={inputClass}
          />
          <p className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--eb-ink-muted)]">
            登録すると、メンバー一覧・掲示板の「LINEで連絡」から他のメンバーがあなたに直接連絡できます。LINEアプリ → ホーム → 友だち追加 → QRコード/招待 で取得した自分の追加用URLを貼り付けてください。
          </p>
        </GlassCard>

        <Button type="button" variant="primary" loading={saving} onClick={handleSave}>
          保存する
        </Button>
      </div>
    </PageBg>
  );
}

/* ═══ 共通コンポーネント（この画面専用の見た目部品） ═══ */

function SectionHeading({ title }: { title: string }) {
  return <h3 className="mb-3 text-[16px] font-bold text-[color:var(--eb-ink)]">{title}</h3>;
}

function ToggleButton({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "h-9 whitespace-nowrap rounded-[14px] px-3 text-[13px] font-bold transition-colors",
        selected ? "border-2 text-white" : "border bg-white/60 text-[color:var(--eb-ink)]"
      )}
      style={
        selected
          ? { background: "var(--eb-green)", borderColor: "var(--eb-green)" }
          : { borderColor: "var(--eb-line)" }
      }
    >
      {label}
    </button>
  );
}

function SkillChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[14px] font-bold"
      style={{ background: "rgba(35,147,94,.14)", color: "var(--eb-green-text)" }}
    >
      {label}
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
    </button>
  );
}

function CategoryRow({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 rounded-xl bg-white/60 px-4 py-3 text-[15px] font-medium text-[color:var(--eb-ink)]">
        <span className="min-w-0 truncate">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={clsx("shrink-0 transition-transform", open && "rotate-90")}>
          <path d="M4 3l3 3-3 3" stroke="var(--eb-ink-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="flex flex-wrap gap-2 px-1 pb-2 pt-2">{children}</div>}
    </div>
  );
}
