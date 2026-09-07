"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { INDUSTRY_OPTIONS } from "@/types";
import { lookupAddressByPostalCode } from "@/lib/address";
import { Button, Field, GlassCard, PageBg, PageHeading, inputClass } from "@/components/ui/eb";

const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県",
  "静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県",
  "奈良県","和歌山県","鳥取県","島根県","岡山県","広島県","山口県",
  "徳島県","香川県","愛媛県","高知県","福岡県","佐賀県","長崎県",
  "熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];

const PURPOSE_OPTIONS = [
  "本店登記","支店・営業所","個人事業の拠点","プロジェクト利用","会議・商談","その他",
];

const GENDER_OPTIONS = [
  { value: "male", label: "男性" },
  { value: "female", label: "女性" },
  { value: "other", label: "その他" },
  { value: "prefer_not_to_say", label: "回答しない" },
];

interface FormData {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  email: string;
  phone: string;
  birthday: string;
  gender: string;
  companyName: string;
  jobTitle: string;
  industry: string;
  purpose: string;
  postalCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
  addressType: string;
  skills: string[];
  companyUrl: string;
  bio: string;
  socialLinks: { instagram: string; x: string; facebook: string; other: string };
}

const EMPTY_FORM: FormData = {
  lastName: "", firstName: "",
  lastNameKana: "", firstNameKana: "",
  email: "", phone: "", birthday: "", gender: "",
  companyName: "", jobTitle: "", industry: "", purpose: "",
  postalCode: "", prefecture: "", city: "",
  address: "", building: "", addressType: "home",
  skills: [], companyUrl: "", bio: "",
  socialLinks: { instagram: "", x: "", facebook: "", other: "" },
};

export default function ProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/auth/profile", { credentials: "include" });
        if (!res.ok) { router.replace("/login"); return; }
        const data = await res.json();
        if (data.profile) {
          const p = data.profile;
          const loaded: FormData = {
            ...EMPTY_FORM,
            ...p,
            companyName: p.companyName || p.occupation || "",
            jobTitle: p.jobTitle || "",
            industry: p.industry || "",
            email: p.email || "",
            skills: p.skills || [],
            companyUrl: p.companyUrl || "",
            bio: p.bio || "",
            socialLinks: { ...EMPTY_FORM.socialLinks, ...(p.socialLinks || {}) },
          };
          setForm(loaded);
        }
      } catch { router.replace("/login"); }
      finally { setLoading(false); }
    }
    loadProfile();
  }, [router]);

  async function lookupPostalCode() {
    const addr = await lookupAddressByPostalCode(form.postalCode);
    if (addr) setForm((prev) => ({ ...prev, prefecture: addr.prefecture, city: addr.city }));
  }

  function updateForm(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSuccess(false);
  }

  function validate(): string | null {
    if (!form.lastName.trim() || !form.firstName.trim()) return "氏名を入力してください";
    if (!form.lastNameKana.trim() || !form.firstNameKana.trim()) return "氏名（カナ）を入力してください";
    const kanaRegex = /^[゠-ヿ　\s]+$/;
    if (!kanaRegex.test(form.lastNameKana) || !kanaRegex.test(form.firstNameKana)) return "氏名（カナ）はカタカナで入力してください";
    if (!form.email.trim()) return "メールアドレスを入力してください";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "メールアドレスの形式が正しくありません";
    if (!form.phone.trim()) return "電話番号を入力してください";
    if (!form.birthday) return "生年月日を入力してください";
    if (!form.gender) return "性別を選択してください";
    if (!form.companyName.trim()) return "会社名を入力してください";
    if (!form.jobTitle.trim()) return "職種を入力してください";
    if (!form.industry) return "業種を選択してください";
    if (!form.purpose) return "利用目的を選択してください";
    if (!form.postalCode.trim()) return "郵便番号を入力してください";
    if (!form.prefecture) return "都道府県を選択してください";
    if (!form.city.trim()) return "市区町村を入力してください";
    if (!form.address.trim()) return "番地を入力してください";
    return null;
  }

  async function handleSave() {
    setError(null);
    setSuccess(false);
    const err = validate();
    if (err) { setError(err); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } else {
        setError(data.error || "保存に失敗しました");
      }
    } catch { setError("通信エラーが発生しました"); }
    finally { setSubmitting(false); }
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
        <PageHeading title="プロフィール編集" subtitle="登録情報の確認・編集" />
      </div>

      <div className="px-5 pt-6 pb-10 space-y-4">
        {/* 氏名 */}
        <GlassCard>
          <SectionHeading title="氏名" />
          <div className="grid grid-cols-2 gap-2">
            <Field label="姓" required>
              <input type="text" value={form.lastName} onChange={(e) => updateForm("lastName", e.target.value)} placeholder="山田" className={inputClass} />
            </Field>
            <Field label="名" required>
              <input type="text" value={form.firstName} onChange={(e) => updateForm("firstName", e.target.value)} placeholder="太郎" className={inputClass} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <Field label="セイ" required>
              <input type="text" value={form.lastNameKana} onChange={(e) => updateForm("lastNameKana", e.target.value)} placeholder="ヤマダ" className={inputClass} />
            </Field>
            <Field label="メイ" required>
              <input type="text" value={form.firstNameKana} onChange={(e) => updateForm("firstNameKana", e.target.value)} placeholder="タロウ" className={inputClass} />
            </Field>
          </div>
        </GlassCard>

        {/* 連絡先・基本情報 */}
        <GlassCard>
          <SectionHeading title="連絡先・基本情報" />
          <div className="space-y-3">
            <Field label="メールアドレス" required>
              <input type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="example@company.com" autoComplete="email" className={inputClass} />
            </Field>
            <Field label="電話番号" required>
              <input type="tel" value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="090-1234-5678" autoComplete="tel" className={inputClass} />
            </Field>
            <Field label="生年月日" required>
              <BirthdaySelect value={form.birthday} onChange={(v) => updateForm("birthday", v)} />
            </Field>
            <Field label="性別" required>
              <div className="flex flex-wrap gap-2">
                {GENDER_OPTIONS.map((opt) => (
                  <ToggleButton key={opt.value} selected={form.gender === opt.value} onClick={() => updateForm("gender", opt.value)} label={opt.label} />
                ))}
              </div>
            </Field>
          </div>
        </GlassCard>

        {/* お仕事について */}
        <GlassCard>
          <SectionHeading title="お仕事について" />
          <div className="space-y-3">
            <Field label="会社名・屋号" required>
              <input type="text" value={form.companyName} onChange={(e) => updateForm("companyName", e.target.value)} placeholder="例: 〇〇株式会社 / フリーランス" className={inputClass} />
            </Field>
            <Field label="職種" required>
              <input type="text" value={form.jobTitle} onChange={(e) => updateForm("jobTitle", e.target.value)} placeholder="例: Webデザイナー / 建築士 / 営業" className={inputClass} />
            </Field>
            <Field label="業種" required>
              <SelectShell>
                <select value={form.industry} onChange={(e) => updateForm("industry", e.target.value)} className={clsx(SELECT_CLASS, !form.industry && "text-[#9AA39E]")}>
                  <option value="">選択してください</option>
                  {INDUSTRY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              </SelectShell>
            </Field>
            <Field label="利用目的" required>
              <div className="flex flex-wrap gap-2">
                {PURPOSE_OPTIONS.map((opt) => (
                  <ToggleButton key={opt} selected={form.purpose === opt} onClick={() => updateForm("purpose", opt)} label={opt} />
                ))}
              </div>
            </Field>
            <Field label="会社URL" hint="任意">
              <input type="url" value={form.companyUrl} onChange={(e) => updateForm("companyUrl", e.target.value)} placeholder="https://example.com" className={inputClass} />
            </Field>
          </div>
        </GlassCard>

        {/* 住所 */}
        <GlassCard>
          <SectionHeading title="住所" />
          <div className="space-y-3">
            <Field label="住所種別" required>
              <div className="flex flex-wrap gap-2">
                <ToggleButton selected={form.addressType === "home"} onClick={() => updateForm("addressType", "home")} label="自宅住所" />
                <ToggleButton selected={form.addressType === "office"} onClick={() => updateForm("addressType", "office")} label="会社住所" />
              </div>
            </Field>
            <Field label="郵便番号" required>
              <div className="flex gap-2">
                <input type="text" value={form.postalCode} onChange={(e) => updateForm("postalCode", e.target.value)} placeholder="123-4567" maxLength={8} className={clsx("flex-1", inputClass)} />
                <Button type="button" variant="secondary" fullWidth={false} className="w-[120px]" onClick={lookupPostalCode}>
                  住所検索
                </Button>
              </div>
            </Field>
            <Field label="都道府県" required>
              <SelectShell>
                <select value={form.prefecture} onChange={(e) => updateForm("prefecture", e.target.value)} className={clsx(SELECT_CLASS, !form.prefecture && "text-[#9AA39E]")}>
                  <option value="">選択してください</option>
                  {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </SelectShell>
            </Field>
            <Field label="市区町村" required>
              <input type="text" value={form.city} onChange={(e) => updateForm("city", e.target.value)} placeholder="渋谷区神宮前" className={inputClass} />
            </Field>
            <Field label="番地" required>
              <input type="text" value={form.address} onChange={(e) => updateForm("address", e.target.value)} placeholder="1-2-3" className={inputClass} />
            </Field>
            <Field label="建物名・部屋番号" hint="任意">
              <input type="text" value={form.building} onChange={(e) => updateForm("building", e.target.value)} placeholder="〇〇マンション 101号室" className={inputClass} />
            </Field>
          </div>
        </GlassCard>

        {error && <p className="text-[14px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}
        {success && (
          <GlassCard tone="green" padding="md">
            <p className="text-[15px] font-bold text-[color:var(--eb-green-text)]">プロフィールを更新しました</p>
          </GlassCard>
        )}

        <Button type="button" variant="primary" loading={submitting} onClick={handleSave}>
          保存する
        </Button>
      </div>
    </PageBg>
  );
}

/* ═══ 共通コンポーネント（この画面専用の見た目部品） ═══ */

const SELECT_CLASS = clsx(inputClass, "appearance-none pr-10");

function SelectShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <svg className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2" width="12" height="8" viewBox="0 0 12 8" fill="none">
        <path d="M1 1l5 5 5-5" stroke="var(--eb-ink-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return <h3 className="mb-3 text-[16px] font-bold text-[color:var(--eb-ink)]">{title}</h3>;
}

function ToggleButton({ selected, onClick, label }: { selected: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "h-12 rounded-[14px] px-4 text-[14px] font-bold transition-colors",
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

function BirthdaySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = (value || "--").split("-");
  function update(idx: number, v: string) {
    const p = [...parts];
    p[idx] = v;
    onChange(p.join("-"));
  }

  return (
    <div className="grid grid-cols-3 gap-2">
      <SelectShell>
        <select value={parts[0] || ""} onChange={(e) => update(0, e.target.value)} className={clsx(SELECT_CLASS, !parts[0] && "text-[#9AA39E]")}>
          <option value="">年</option>
          {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={String(y)}>{y}年</option>)}
        </select>
      </SelectShell>
      <SelectShell>
        <select value={parts[1] || ""} onChange={(e) => update(1, e.target.value)} className={clsx(SELECT_CLASS, !parts[1] && "text-[#9AA39E]")}>
          <option value="">月</option>
          {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{Number(m)}月</option>)}
        </select>
      </SelectShell>
      <SelectShell>
        <select value={parts[2] || ""} onChange={(e) => update(2, e.target.value)} className={clsx(SELECT_CLASS, !parts[2] && "text-[#9AA39E]")}>
          <option value="">日</option>
          {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => <option key={d} value={d}>{Number(d)}日</option>)}
        </select>
      </SelectShell>
    </div>
  );
}
