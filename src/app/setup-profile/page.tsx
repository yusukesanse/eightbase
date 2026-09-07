"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { SKILL_CATEGORIES, INDUSTRY_OPTIONS } from "@/types";
import { lookupAddressByPostalCode } from "@/lib/address";
import { clearAuthCache } from "@/components/AuthGuard";
import { normalizeRole, type UserRole } from "@/lib/roles";
import { AuthRecovery } from "@/components/AuthRecovery";
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
  "本店登記",
  "支店・営業所",
  "個人事業の拠点",
  "プロジェクト利用",
  "会議・商談",
  "その他",
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
  // Step 3
  skills: string[];
  companyUrl: string;
  bio: string;
  lineUrl: string;
  socialLinks: {
    instagram: string;
    x: string;
    facebook: string;
    other: string;
  };
}

const EMPTY_FORM: FormData = {
  lastName: "",
  firstName: "",
  lastNameKana: "",
  firstNameKana: "",
  email: "",
  phone: "",
  birthday: "",
  gender: "",
  companyName: "",
  jobTitle: "",
  industry: "",
  purpose: "",
  postalCode: "",
  prefecture: "",
  city: "",
  address: "",
  building: "",
  addressType: "home",
  skills: [],
  companyUrl: "",
  bio: "",
  lineUrl: "",
  socialLinks: { instagram: "", x: "", facebook: "", other: "" },
};

export default function SetupProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<"auth" | "network" | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<UserRole>("member");
  const [customSkill, setCustomSkill] = useState("");
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadProfile() {
      setLoading(true);
      setLoadError(null);
      try {
        const res = await fetch("/api/auth/profile", { credentials: "include", cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setLoadError(res.status === 401 || res.status === 403 ? "auth" : "network");
          return;
        }
        const data = await res.json();
        if (controller.signal.aborted) return;
        if (data.profileComplete) { clearAuthCache(); router.replace("/reservation"); return; }
        setRole(normalizeRole(data.role));
        if (data.profile) {
          const p = data.profile;
          setForm({
            ...EMPTY_FORM,
            ...p,
            // 旧 occupation からの移行
            companyName: p.companyName || p.occupation || "",
            jobTitle: p.jobTitle || "",
            industry: p.industry || "",
            skills: p.skills || [],
            companyUrl: p.companyUrl || "",
            bio: p.bio || "",
            lineUrl: p.lineUrl || "",
            socialLinks: { ...EMPTY_FORM.socialLinks, ...(p.socialLinks || {}) },
          });
        }
      } catch { if (!controller.signal.aborted) setLoadError("network"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    loadProfile();
    return () => controller.abort();
  }, [router, loadAttempt]);

  async function lookupPostalCode() {
    const addr = await lookupAddressByPostalCode(form.postalCode);
    if (addr) setForm((prev) => ({ ...prev, prefecture: addr.prefecture, city: addr.city }));
  }

  function updateForm(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function validateStep1(): string | null {
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
    return null;
  }

  function validateStep2(): string | null {
    if (!form.postalCode.trim()) return "郵便番号を入力してください";
    if (!form.prefecture) return "都道府県を選択してください";
    if (!form.city.trim()) return "市区町村を入力してください";
    if (!form.address.trim()) return "番地を入力してください";
    return null;
  }

  function handleNext(nextStep: number, validate: () => string | null) {
    const err = validate();
    if (err) { setError(err); return; }
    setError(null);
    setStep(nextStep);
    window.scrollTo(0, 0);
  }

  function toggleSkill(skill: string) {
    setForm((prev) => ({
      ...prev,
      skills: prev.skills.includes(skill)
        ? prev.skills.filter((s) => s !== skill)
        : [...prev.skills, skill],
    }));
  }

  function addCustomSkill() {
    const trimmed = customSkill.trim();
    if (trimmed && !form.skills.includes(trimmed)) {
      setForm((prev) => ({ ...prev, skills: [...prev.skills, trimmed] }));
      setCustomSkill("");
    }
  }

  function validateStep3(): string | null {
    if (form.skills.length === 0) return "スキルを1つ以上選択してください";
    if (!form.bio.trim()) return "自己紹介を入力してください";
    return null;
  }

  // エイト社員（staff）簡素版の必須チェック（氏名・カナ・メール・電話・職種）。
  function validateStaff(): string | null {
    if (!form.lastName.trim() || !form.firstName.trim()) return "氏名を入力してください";
    if (!form.lastNameKana.trim() || !form.firstNameKana.trim()) return "氏名（カナ）を入力してください";
    const kanaRegex = /^[゠-ヿ　\s]+$/;
    if (!kanaRegex.test(form.lastNameKana) || !kanaRegex.test(form.firstNameKana)) return "氏名（カナ）はカタカナで入力してください";
    if (!form.email.trim()) return "メールアドレスを入力してください";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return "メールアドレスの形式が正しくありません";
    if (!form.phone.trim()) return "電話番号を入力してください";
    if (!form.jobTitle.trim()) return "職種を入力してください";
    return null;
  }

  // staff は簡素版フォーム（会社名はサーバー側で自動固定）。会員の 3 ステップとは別 submit。
  async function handleStaffSubmit() {
    const err = validateStaff();
    if (err) { setError(err); return; }
    setError(null);
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
        clearAuthCache();
        router.replace("/reservation");
      } else {
        setError(data.error || "保存に失敗しました");
      }
    } catch { setError("通信エラーが発生しました"); }
    finally { setSubmitting(false); }
  }

  async function handleSubmit() {
    const err = validateStep3();
    if (err) { setError(err); return; }
    setError(null);
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
        clearAuthCache();
        router.replace("/reservation");
      } else {
        setError(data.error || "保存に失敗しました");
      }
    } catch { setError("通信エラーが発生しました"); }
    finally { setSubmitting(false); }
  }

  if (loadError) {
    return (
      <AuthRecovery
        title="プロフィールを読み込めませんでした"
        message={loadError === "auth" ? "ログイン状態を確認できませんでした。もう一度ログインしてください。" : "通信状況を確認して、もう一度お試しください。"}
        retryLabel={loadError === "auth" ? "ログインする" : "もう一度試す"}
        onRetry={() => {
          if (loadError === "auth") { clearAuthCache(); router.replace("/login"); }
          else setLoadAttempt((value) => value + 1);
        }}
      />
    );
  }

  if (loading) {
    return (
      <PageBg>
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <div
              className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-t-transparent"
              style={{ borderColor: "var(--eb-green)", borderTopColor: "transparent" }}
            />
            <p className="text-[15px] text-[color:var(--eb-ink-muted)]">読み込み中...</p>
          </div>
        </div>
      </PageBg>
    );
  }

  // ═══ エイト社員（staff）: 簡素版フォーム（1 ステップ・会社名は自動固定） ═══
  if (role === "staff") {
    return (
      <PageBg>
        <div className="px-5 pt-8">
          <PageHeading
            title="プロフィール登録"
            subtitle="ご利用にあたり、基本情報をご入力ください。あとから変更もできます。"
          />
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

          {/* 連絡先 */}
          <GlassCard>
            <SectionHeading title="連絡先" />
            <div className="space-y-3">
              <Field label="メールアドレス" required>
                <input type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="example@8-design.net" autoComplete="email" className={inputClass} />
              </Field>
              <Field label="電話番号" required>
                <input type="tel" value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="090-1234-5678" autoComplete="tel" className={inputClass} />
              </Field>
            </div>
          </GlassCard>

          {/* 会社・職種 */}
          <GlassCard>
            <SectionHeading title="お仕事について" />
            <div className="space-y-3">
              <Field label="会社名" hint="会社名は自動で設定されます">
                <div className="flex h-14 items-center rounded-2xl px-4 text-[15px]" style={{ background: "var(--eb-tint)", color: "var(--eb-ink-muted)" }}>
                  エイトデザイン株式会社
                </div>
              </Field>
              <Field label="職種" required>
                <input type="text" value={form.jobTitle} onChange={(e) => updateForm("jobTitle", e.target.value)} placeholder="例: デザイナー / ディレクター / 経理" className={inputClass} />
              </Field>
            </div>
          </GlassCard>

          {/* 自己紹介（任意） */}
          <GlassCard>
            <SectionHeading title="自己紹介（任意）" />
            <p className="mb-2 text-[13px] text-[color:var(--eb-ink-muted)]">メンバーに一言。あとから変更もできます。</p>
            <textarea
              value={form.bio}
              onChange={(e) => updateForm("bio", e.target.value)}
              placeholder="例: 〇〇を担当しています。お気軽にお声がけください。"
              className="h-[120px] w-full resize-y rounded-2xl border px-4 py-3 text-[15px] focus:outline-none focus:border-2"
              style={{ background: "#fff", borderColor: "var(--eb-line)", color: "var(--eb-ink)" }}
            />
          </GlassCard>

          {/* LINE連絡先（任意） */}
          <GlassCard>
            <SectionHeading title="LINE連絡先（任意）" />
            <p className="mb-2 text-[13px] text-[color:var(--eb-ink-muted)]">
              登録すると、メンバー一覧・掲示板の「LINEで連絡」から直接連絡してもらえます。
            </p>
            <input type="url" value={form.lineUrl} onChange={(e) => updateForm("lineUrl", e.target.value)} placeholder="https://line.me/ti/p/～" className={inputClass} />
          </GlassCard>

          {error && <p className="text-[14px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}

          <Button type="button" variant="primary" loading={submitting} onClick={handleStaffSubmit}>
            登録して利用開始
          </Button>
        </div>
      </PageBg>
    );
  }

  return (
    <PageBg>
      <div className="px-5 pt-8">
        <PageHeading
          title="プロフィール登録"
          subtitle="ご利用にあたり、お客様情報をご入力ください。あとから変更もできます。"
        />
        <div className="mt-4 flex items-center gap-2">
          <StepPill n={1} label="基本情報" status={step === 1 ? "current" : "done"} />
          <StepPill n={2} label="住所情報" status={step === 2 ? "current" : step > 2 ? "done" : "future"} />
          <StepPill n={3} label="プロフィール" status={step === 3 ? "current" : "future"} />
        </div>
      </div>

      <div className="px-5 pt-6 pb-10">
        {/* ═══ Step 1: 基本情報 ═══ */}
        {step === 1 && (
          <div className="space-y-4">
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

            {/* 会社・職種・業種 */}
            <GlassCard>
              <SectionHeading title="お仕事について" />
              <div className="space-y-3">
                <Field label="会社名・屋号" required>
                  <input type="text" value={form.companyName} onChange={(e) => updateForm("companyName", e.target.value)} placeholder="例: 〇〇株式会社 / 〇〇事務所 / フリーランス" className={inputClass} />
                </Field>
                <Field label="職種" required hint="あなたの専門分野が伝わるように記入してください">
                  <input type="text" value={form.jobTitle} onChange={(e) => updateForm("jobTitle", e.target.value)} placeholder="例: Webデザイナー / 建築士 / 税理士" className={inputClass} />
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
              </div>
            </GlassCard>

            {error && <p className="text-[14px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}

            <Button type="button" variant="primary" onClick={() => handleNext(2, validateStep1)}>
              次へ（住所情報）
            </Button>
          </div>
        )}

        {/* ═══ Step 2: 住所情報 ═══ */}
        {step === 2 && (
          <div className="space-y-4">
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
                <Field label="建物名・部屋番号（任意）">
                  <input type="text" value={form.building} onChange={(e) => updateForm("building", e.target.value)} placeholder="〇〇マンション 101号室" className={inputClass} />
                </Field>
              </div>
            </GlassCard>

            {error && <p className="text-[14px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}

            <div className="flex gap-2">
              <Button type="button" variant="ghost" fullWidth={false} className="flex-1" onClick={() => { setStep(1); setError(null); window.scrollTo(0, 0); }}>
                戻る
              </Button>
              <Button type="button" variant="primary" fullWidth={false} className="flex-[2]" onClick={() => handleNext(3, validateStep2)}>
                次へ（プロフィール）
              </Button>
            </div>
          </div>
        )}

        {/* ═══ Step 3: プロフィール情報（任意） ═══ */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-[14px] text-[color:var(--eb-ink-muted)]">
              スキルと自己紹介は必須です。他の項目は任意で、あとから変更もできます。
            </p>

            {/* スキル */}
            <GlassCard>
              <SectionHeading title="スキル・得意分野" />
              <p className="mb-3 text-[13px] text-[color:var(--eb-ink-muted)]">メンバー検索で見つけてもらいやすくなります。</p>
              {form.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {form.skills.map((skill) => (
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
                    <ToggleButton key={skill} selected={form.skills.includes(skill)} onClick={() => toggleSkill(skill)} label={skill} small />
                  ))}
                </CategoryRow>
              ))}
              <div className="flex gap-2 mt-2">
                <input type="text" value={customSkill} onChange={(e) => setCustomSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomSkill())} placeholder="その他のスキルを追加" className={clsx("flex-1", inputClass)} />
                <Button type="button" variant="ghost" fullWidth={false} className="w-24" disabled={!customSkill.trim()} onClick={addCustomSkill}>
                  追加
                </Button>
              </div>
            </GlassCard>

            {/* 会社URL */}
            <GlassCard>
              <SectionHeading title="会社・事業のURL（任意）" />
              <p className="mb-2 text-[13px] text-[color:var(--eb-ink-muted)]">お仕事の依頼につながることがあります。</p>
              <input type="url" value={form.companyUrl} onChange={(e) => updateForm("companyUrl", e.target.value)} placeholder="https://example.com" className={inputClass} />
            </GlassCard>

            {/* SNSリンク */}
            <GlassCard>
              <SectionHeading title="SNSアカウント（任意）" />
              <p className="mb-3 text-[13px] text-[color:var(--eb-ink-muted)]">メンバーとの交流のきっかけになります。</p>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[15px]">𝕏</span>
                  <input type="text" value={form.socialLinks.x} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, x: e.target.value } }))} placeholder="@username" className={clsx("flex-1", inputClass)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[13px]">IG</span>
                  <input type="text" value={form.socialLinks.instagram} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, instagram: e.target.value } }))} placeholder="@username" className={clsx("flex-1", inputClass)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[13px]">FB</span>
                  <input type="text" value={form.socialLinks.facebook} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, facebook: e.target.value } }))} placeholder="https://facebook.com/..." className={clsx("flex-1", inputClass)} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[13px] text-[color:var(--eb-ink-muted)]">他</span>
                  <input type="text" value={form.socialLinks.other} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, other: e.target.value } }))} placeholder="その他のURL" className={clsx("flex-1", inputClass)} />
                </div>
              </div>
            </GlassCard>

            {/* LINE連絡先（任意・推奨） */}
            <GlassCard>
              <SectionHeading title="LINE連絡先（任意）" />
              <p className="mb-2 text-[13px] text-[color:var(--eb-ink-muted)]">
                登録すると、メンバー一覧・掲示板の「LINEで連絡」から直接連絡してもらえます。
              </p>
              <input type="url" value={form.lineUrl} onChange={(e) => updateForm("lineUrl", e.target.value)} placeholder="https://line.me/ti/p/～" className={inputClass} />
            </GlassCard>

            {/* 自己紹介 */}
            <GlassCard>
              <SectionHeading title="自己紹介・PR" />
              <Field label="自己紹介" required hint="事業内容やアピールを自由に記入してください">
                <textarea
                  value={form.bio}
                  onChange={(e) => updateForm("bio", e.target.value)}
                  placeholder="例: Webサイトのデザイン・制作を行っています。お気軽にお声がけください。"
                  className="h-[120px] w-full resize-y rounded-2xl border px-4 py-3 text-[15px] focus:outline-none focus:border-2"
                  style={{ background: "#fff", borderColor: "var(--eb-line)", color: "var(--eb-ink)" }}
                />
              </Field>
            </GlassCard>

            {error && <p className="text-[14px] font-bold text-[color:var(--eb-coral-text)]">{error}</p>}

            {/* ボタン */}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" fullWidth={false} className="flex-1" onClick={() => { setStep(2); setError(null); window.scrollTo(0, 0); }}>
                戻る
              </Button>
              <Button type="button" variant="primary" fullWidth={false} className="flex-[2]" loading={submitting} onClick={handleSubmit}>
                登録して利用開始
              </Button>
            </div>
          </div>
        )}
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

function StepPill({ n, label, status }: { n: number; label: string; status: "current" | "done" | "future" }) {
  return (
    <div
      className={clsx(
        "flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-bold",
        status === "current" ? "bg-[color:var(--eb-ink)] text-white" : "bg-white/60 text-[color:var(--eb-ink)]"
      )}
    >
      {status === "done" ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-white" style={{ background: "var(--eb-green)" }}>
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.5 2.5L9 1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      ) : (
        <span
          className={clsx(
            "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
            status === "current" ? "bg-white/20 text-white" : "text-[color:var(--eb-ink)]"
          )}
          style={status === "future" ? { background: "var(--eb-tint)" } : undefined}
        >
          {n}
        </span>
      )}
      {label}
    </div>
  );
}

function ToggleButton({ selected, onClick, label, small }: { selected: boolean; onClick: () => void; label: string; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-[14px] font-bold transition-colors",
        small ? "h-9 px-3 text-[13px]" : "h-12 px-4 text-[14px]",
        selected
          ? "border-2 text-white"
          : "border bg-white/60 text-[color:var(--eb-ink)]"
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
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[14px] font-bold"
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
      <button type="button" onClick={onToggle} className="flex w-full items-center justify-between rounded-xl bg-white/60 px-4 py-3 text-[15px] font-medium text-[color:var(--eb-ink)]">
        {label}
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={clsx("transition-transform", open && "rotate-90")}>
          <path d="M4 3l3 3-3 3" stroke="var(--eb-ink-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && <div className="flex flex-wrap gap-2 px-1 pb-2 pt-2">{children}</div>}
    </div>
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
