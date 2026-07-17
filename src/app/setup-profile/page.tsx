"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SKILL_CATEGORIES, INDUSTRY_OPTIONS } from "@/types";
import { lookupAddressByPostalCode } from "@/lib/address";
import { clearAuthCache } from "@/components/AuthGuard";
import { normalizeRole, type UserRole } from "@/lib/roles";

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

const INPUT_CLASS =
  "w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]";

export default function SetupProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<UserRole>("member");
  const [customSkill, setCustomSkill] = useState("");
  const [openCategory, setOpenCategory] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/auth/profile", { credentials: "include" });
        if (!res.ok) { router.replace("/login"); return; }
        const data = await res.json();
        if (data.profileComplete) { router.replace("/reservation"); return; }
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
  }

  function validateStep1(): string | null {
    if (!form.lastName.trim() || !form.firstName.trim()) return "氏名を入力してください";
    if (!form.lastNameKana.trim() || !form.firstNameKana.trim()) return "氏名（カナ）を入力してください";
    const kanaRegex = /^[\u30A0-\u30FF\u3000\s]+$/;
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

  // ═══ エイト社員（staff）: 簡素版フォーム（1 ステップ・会社名は自動固定） ═══
  if (role === "staff") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-[#A5C1C8] px-5 pt-12 pb-6">
          <h1 className="text-xl font-bold tracking-wide text-[#231714]">プロフィール登録</h1>
          <p className="text-sm text-[#231714]/60 mt-1">
            ご利用にあたり、基本情報をご入力ください
          </p>
        </div>

        <div className="flex-1 px-4 pt-5 pb-8">
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            {/* 氏名 */}
            <Card title="氏名" icon="person" required>
              <div className="grid grid-cols-2 gap-2">
                <Field label="姓"><input type="text" value={form.lastName} onChange={(e) => updateForm("lastName", e.target.value)} placeholder="山田" className={INPUT_CLASS} /></Field>
                <Field label="名"><input type="text" value={form.firstName} onChange={(e) => updateForm("firstName", e.target.value)} placeholder="太郎" className={INPUT_CLASS} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Field label="セイ"><input type="text" value={form.lastNameKana} onChange={(e) => updateForm("lastNameKana", e.target.value)} placeholder="ヤマダ" className={INPUT_CLASS} /></Field>
                <Field label="メイ"><input type="text" value={form.firstNameKana} onChange={(e) => updateForm("firstNameKana", e.target.value)} placeholder="タロウ" className={INPUT_CLASS} /></Field>
              </div>
            </Card>

            {/* 連絡先 */}
            <Card title="連絡先" icon="clipboard" required>
              <Field label="メールアドレス">
                <input type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="example@8-design.net" autoComplete="email" className={INPUT_CLASS} />
              </Field>
              <div className="mt-3">
                <Field label="電話番号">
                  <input type="tel" value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="090-1234-5678" autoComplete="tel" className={INPUT_CLASS} />
                </Field>
              </div>
            </Card>

            {/* 会社・職種 */}
            <Card title="お仕事について" icon="briefcase" required>
              <Field label="会社名">
                <div className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl bg-[#231714]/5 text-[#231714]/60">
                  エイトデザイン株式会社
                </div>
                <p className="text-[10px] text-[#231714]/55 mt-1">会社名は自動で設定されます</p>
              </Field>
              <div className="mt-3">
                <Field label="職種">
                  <input type="text" value={form.jobTitle} onChange={(e) => updateForm("jobTitle", e.target.value)} placeholder="例: デザイナー / ディレクター / 経理" className={INPUT_CLASS} />
                </Field>
              </div>
            </Card>

            {/* 自己紹介（任意） */}
            <Card title="自己紹介（任意）" icon="edit">
              <p className="text-[10px] text-[#231714]/60 mb-2">メンバーに一言。あとから変更もできます。</p>
              <textarea value={form.bio} onChange={(e) => updateForm("bio", e.target.value)} placeholder="例: 〇〇を担当しています。お気軽にお声がけください。" rows={3} className={`${INPUT_CLASS} resize-y`} />
            </Card>

            {/* LINE連絡先（任意） */}
            <Card title="LINE連絡先（任意）" icon="share">
              <p className="text-[10px] text-[#231714]/60 mb-2 leading-relaxed">
                登録すると、メンバー一覧・掲示板の「LINEで連絡」から他のメンバーが直接連絡できます。LINEアプリ → ホーム → 友だち追加 → QRコード/招待 で取得した自分の追加用URLを貼り付けてください。
              </p>
              <input type="url" value={form.lineUrl} onChange={(e) => updateForm("lineUrl", e.target.value)} placeholder="https://line.me/ti/p/～" className={INPUT_CLASS} />
            </Card>

            <button type="button" onClick={handleStaffSubmit} disabled={submitting} className="w-full py-3.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50 transition-colors">
              {submitting ? "登録中..." : "登録して利用開始"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <div className="bg-[#A5C1C8] px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold tracking-wide text-[#231714]">プロフィール登録</h1>
        <p className="text-sm text-[#231714]/60 mt-1">
          ご利用にあたり、お客様情報をご入力ください
        </p>
        <div className="flex items-center gap-2 mt-4">
          {[
            { n: 1, label: "基本情報" },
            { n: 2, label: "住所情報" },
            { n: 3, label: "プロフィール" },
          ].map((s, i) => (
            <div key={s.n} className="contents">
              {i > 0 && <div className="w-4 h-px bg-[#231714]/20" />}
              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                step === s.n ? "bg-[#231714] text-white" : "bg-white/40 text-[#231714]/60"
              }`}>
                <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">{s.n}</span>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pt-5 pb-8">
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* ═══ Step 1: 基本情報 ═══ */}
        {step === 1 && (
          <div className="space-y-4">
            {/* 氏名 */}
            <Card title="氏名" icon="person" required>
              <div className="grid grid-cols-2 gap-2">
                <Field label="姓"><input type="text" value={form.lastName} onChange={(e) => updateForm("lastName", e.target.value)} placeholder="山田" className={INPUT_CLASS} /></Field>
                <Field label="名"><input type="text" value={form.firstName} onChange={(e) => updateForm("firstName", e.target.value)} placeholder="太郎" className={INPUT_CLASS} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <Field label="セイ"><input type="text" value={form.lastNameKana} onChange={(e) => updateForm("lastNameKana", e.target.value)} placeholder="ヤマダ" className={INPUT_CLASS} /></Field>
                <Field label="メイ"><input type="text" value={form.firstNameKana} onChange={(e) => updateForm("firstNameKana", e.target.value)} placeholder="タロウ" className={INPUT_CLASS} /></Field>
              </div>
            </Card>

            {/* 連絡先・基本情報 */}
            <Card title="連絡先・基本情報" icon="clipboard" required>
              <Field label="メールアドレス">
                <input type="email" value={form.email} onChange={(e) => updateForm("email", e.target.value)} placeholder="example@company.com" autoComplete="email" className={INPUT_CLASS} />
              </Field>
              <div className="mt-3">
              <Field label="電話番号">
                <input type="tel" value={form.phone} onChange={(e) => updateForm("phone", e.target.value)} placeholder="090-1234-5678" autoComplete="tel" className={INPUT_CLASS} />
              </Field>
              </div>
              <div className="mt-3">
                <Field label="生年月日">
                  <BirthdaySelect value={form.birthday} onChange={(v) => updateForm("birthday", v)} />
                </Field>
              </div>
              <div className="mt-3">
                <Field label="性別">
                  <div className="grid grid-cols-4 gap-2">
                    {GENDER_OPTIONS.map((opt) => (
                      <ToggleButton key={opt.value} selected={form.gender === opt.value} onClick={() => updateForm("gender", opt.value)} label={opt.label} />
                    ))}
                  </div>
                </Field>
              </div>
            </Card>

            {/* 会社・職種・業種 */}
            <Card title="お仕事について" icon="briefcase" required>
              <Field label="会社名・屋号">
                <input type="text" value={form.companyName} onChange={(e) => updateForm("companyName", e.target.value)} placeholder="例: 〇〇株式会社 / 〇〇事務所 / フリーランス" className={INPUT_CLASS} />
              </Field>
              <div className="mt-3">
                <Field label="職種">
                  <input type="text" value={form.jobTitle} onChange={(e) => updateForm("jobTitle", e.target.value)} placeholder="例: Webデザイナー / 建築士 / 税理士 / 映像ディレクター / 営業" className={INPUT_CLASS} />
                  <p className="text-[10px] text-[#231714]/55 mt-1">あなたの専門分野が伝わるように記入してください</p>
                </Field>
              </div>
              <div className="mt-3">
                <Field label="業種">
                  <select value={form.industry} onChange={(e) => updateForm("industry", e.target.value)} className={`${INPUT_CLASS} ${!form.industry ? "text-[#231714]/55" : ""}`}>
                    <option value="">選択してください</option>
                    {INDUSTRY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </Field>
              </div>
              <div className="mt-3">
                <Field label="利用目的">
                  <div className="flex flex-wrap gap-2">
                    {PURPOSE_OPTIONS.map((opt) => (
                      <ToggleButton key={opt} selected={form.purpose === opt} onClick={() => updateForm("purpose", opt)} label={opt} />
                    ))}
                  </div>
                </Field>
              </div>
            </Card>

            <button type="button" onClick={() => handleNext(2, validateStep1)} className="w-full py-3.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors flex items-center justify-center gap-2">
              次へ — 住所情報
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        )}

        {/* ═══ Step 2: 住所情報 ═══ */}
        {step === 2 && (
          <div className="space-y-4">
            <Card title="住所" icon="home" required>
              <Field label="住所種別">
                <div className="grid grid-cols-2 gap-2">
                  <ToggleButton selected={form.addressType === "home"} onClick={() => updateForm("addressType", "home")} label="自宅住所" />
                  <ToggleButton selected={form.addressType === "office"} onClick={() => updateForm("addressType", "office")} label="会社住所" />
                </div>
              </Field>
              <div className="mt-3">
                <Field label="郵便番号">
                  <div className="flex gap-2">
                    <input type="text" value={form.postalCode} onChange={(e) => updateForm("postalCode", e.target.value)} placeholder="123-4567" maxLength={8} className={`flex-1 ${INPUT_CLASS}`} />
                    <button type="button" onClick={lookupPostalCode} className="px-4 py-2.5 text-xs bg-[#A5C1C8]/30 text-[#231714] rounded-xl hover:bg-[#A5C1C8]/40 transition-colors whitespace-nowrap">住所検索</button>
                  </div>
                </Field>
              </div>
              <div className="mt-3">
                <Field label="都道府県">
                  <select value={form.prefecture} onChange={(e) => updateForm("prefecture", e.target.value)} className={`${INPUT_CLASS} ${!form.prefecture ? "text-[#231714]/55" : ""}`}>
                    <option value="">選択してください</option>
                    {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </Field>
              </div>
              <div className="mt-3"><Field label="市区町村"><input type="text" value={form.city} onChange={(e) => updateForm("city", e.target.value)} placeholder="渋谷区神宮前" className={INPUT_CLASS} /></Field></div>
              <div className="mt-3"><Field label="番地"><input type="text" value={form.address} onChange={(e) => updateForm("address", e.target.value)} placeholder="1-2-3" className={INPUT_CLASS} /></Field></div>
              <div className="mt-3"><Field label="建物名・部屋番号" optional><input type="text" value={form.building} onChange={(e) => updateForm("building", e.target.value)} placeholder="〇〇マンション 101号室" className={INPUT_CLASS} /></Field></div>
            </Card>

            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep(1); setError(null); window.scrollTo(0, 0); }} className="flex-1 py-3.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors flex items-center justify-center gap-1">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                戻る
              </button>
              <button type="button" onClick={() => handleNext(3, validateStep2)} className="flex-[2] py-3.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors">
                次へ — プロフィール
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step 3: プロフィール情報（任意） ═══ */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-[#A5C1C8]/10 rounded-xl px-4 py-3">
              <p className="text-xs text-[#231714]/60">
                メンバー同士のコミュニティを広げるための情報です。スキルと自己紹介は必須です。あとから変更もできます。
              </p>
            </div>

            {/* スキル */}
            <Card title="スキル・得意分野" icon="star" required>
              <p className="text-[10px] text-[#231714]/60 mb-3">メンバー検索であなたが見つけてもらいやすくなります</p>
              {form.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {form.skills.map((skill) => (
                    <button key={skill} onClick={() => toggleSkill(skill)} className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] rounded-full bg-[#A5C1C8]/15 text-[#4f757e] font-medium">
                      {skill}
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                    </button>
                  ))}
                </div>
              )}
              {SKILL_CATEGORIES.map((cat) => (
                <div key={cat.id} className="mb-2">
                  <button onClick={() => setOpenCategory(openCategory === cat.id ? null : cat.id)} className="w-full flex items-center justify-between py-2 text-xs font-medium text-[#231714]/70">
                    {cat.label}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={`transition-transform ${openCategory === cat.id ? "rotate-90" : ""}`}><path d="M4 3l3 3-3 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  {openCategory === cat.id && (
                    <div className="flex flex-wrap gap-1.5 pb-2">
                      {cat.skills.map((skill) => (
                        <ToggleButton key={skill} selected={form.skills.includes(skill)} onClick={() => toggleSkill(skill)} label={skill} small />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex gap-2 mt-2">
                <input type="text" value={customSkill} onChange={(e) => setCustomSkill(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addCustomSkill())} placeholder="その他のスキルを追加" className={`flex-1 ${INPUT_CLASS}`} />
                <button type="button" onClick={addCustomSkill} disabled={!customSkill.trim()} className="px-4 py-2.5 text-xs bg-[#231714]/5 text-[#231714]/60 rounded-xl hover:bg-[#231714]/10 disabled:opacity-30 transition-colors">追加</button>
              </div>
            </Card>

            {/* 会社URL */}
            <Card title="会社・事業のURL" icon="link">
              <p className="text-[10px] text-[#231714]/60 mb-2">
                URLを登録すると、メンバーページからあなたの事業が見つけやすくなります。お仕事の依頼につながることも。
              </p>
              <input type="url" value={form.companyUrl} onChange={(e) => updateForm("companyUrl", e.target.value)} placeholder="https://example.com" className={INPUT_CLASS} />
            </Card>

            {/* SNSリンク */}
            <Card title="SNSアカウント" icon="share">
              <p className="text-[10px] text-[#231714]/60 mb-3">メンバーとの交流のきっかけになります</p>
              <div className="space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-sm">𝕏</span>
                  <input type="text" value={form.socialLinks.x} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, x: e.target.value } }))} placeholder="@username" className={`flex-1 ${INPUT_CLASS}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[13px]">IG</span>
                  <input type="text" value={form.socialLinks.instagram} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, instagram: e.target.value } }))} placeholder="@username" className={`flex-1 ${INPUT_CLASS}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[13px]">FB</span>
                  <input type="text" value={form.socialLinks.facebook} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, facebook: e.target.value } }))} placeholder="https://facebook.com/..." className={`flex-1 ${INPUT_CLASS}`} />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-center text-[11px] text-[#231714]/60">他</span>
                  <input type="text" value={form.socialLinks.other} onChange={(e) => setForm((prev) => ({ ...prev, socialLinks: { ...prev.socialLinks, other: e.target.value } }))} placeholder="その他のURL" className={`flex-1 ${INPUT_CLASS}`} />
                </div>
              </div>
            </Card>

            {/* LINE連絡先（任意・推奨） */}
            <Card title="LINE連絡先（任意）" icon="share">
              <p className="text-[10px] text-[#231714]/60 mb-2 leading-relaxed">
                登録すると、メンバー一覧・掲示板の「LINEで連絡」から他のメンバーがあなたに直接連絡できます（任意・後からでも設定できます）。LINEアプリ → ホーム → 友だち追加 → QRコード/招待 で取得した自分の追加用URLを貼り付けてください。
              </p>
              <input type="url" value={form.lineUrl} onChange={(e) => updateForm("lineUrl", e.target.value)} placeholder="https://line.me/ti/p/～" className={INPUT_CLASS} />
            </Card>

            {/* 自己紹介 */}
            <Card title="自己紹介・PR" icon="edit" required>
              <p className="text-[10px] text-[#231714]/60 mb-2">事業内容やアピールを自由に記入してください</p>
              <textarea value={form.bio} onChange={(e) => updateForm("bio", e.target.value)} placeholder="例: Webサイトのデザイン・制作を行っています。お気軽にお声がけください。" rows={4} className={`${INPUT_CLASS} resize-y`} />
            </Card>

            {/* ボタン */}
            <div className="flex gap-2">
              <button type="button" onClick={() => { setStep(2); setError(null); window.scrollTo(0, 0); }} className="flex-1 py-3.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors flex items-center justify-center gap-1">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                戻る
              </button>
              <button type="button" onClick={handleSubmit} disabled={submitting} className="flex-[2] py-3.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50 transition-colors">
                {submitting ? "登録中..." : "登録して利用開始"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══ 共通コンポーネント ═══ */

function Card({ title, icon, required, children }: { title: string; icon: string; required?: boolean; children: React.ReactNode }) {
  const icons: Record<string, React.ReactNode> = {
    person: <><path d="M8 2a3.5 3.5 0 013.5 3.5v0A3.5 3.5 0 018 9v0a3.5 3.5 0 01-3.5-3.5v0A3.5 3.5 0 018 2z" stroke="#A5C1C8" strokeWidth="1.3" /><path d="M2.5 14c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="#A5C1C8" strokeWidth="1.3" strokeLinecap="round" /></>,
    clipboard: <><path d="M5.5 2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2h-1.5" stroke="#A5C1C8" strokeWidth="1.3" /><rect x="5" y="1" width="6" height="3" rx="1" stroke="#A5C1C8" strokeWidth="1.3" /></>,
    briefcase: <><rect x="2" y="4" width="12" height="10" rx="2" stroke="#A5C1C8" strokeWidth="1.3" /><path d="M5 4V3a2 2 0 012-2h2a2 2 0 012 2v1" stroke="#A5C1C8" strokeWidth="1.3" /></>,
    home: <><path d="M8 1.5l6 5v7.5a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5l6-5z" stroke="#A5C1C8" strokeWidth="1.3" strokeLinejoin="round" /><path d="M6 15v-4h4v4" stroke="#A5C1C8" strokeWidth="1.3" /></>,
    star: <><path d="M8 1.5l1.76 3.52 3.84.56-2.8 2.72.64 3.84L8 10.44l-3.44 1.8.64-3.84-2.8-2.72 3.84-.56L8 1.5z" stroke="#A5C1C8" strokeWidth="1.2" strokeLinejoin="round" /></>,
    link: <><path d="M6.5 9.5l3-3M5 11a2.83 2.83 0 01-1-4l2-2a2.83 2.83 0 014 0" stroke="#A5C1C8" strokeWidth="1.3" strokeLinecap="round" /><path d="M11 5a2.83 2.83 0 011 4l-2 2a2.83 2.83 0 01-4 0" stroke="#A5C1C8" strokeWidth="1.3" strokeLinecap="round" /></>,
    share: <><circle cx="12" cy="4" r="2" stroke="#A5C1C8" strokeWidth="1.2" /><circle cx="4" cy="8" r="2" stroke="#A5C1C8" strokeWidth="1.2" /><circle cx="12" cy="12" r="2" stroke="#A5C1C8" strokeWidth="1.2" /><path d="M6 7l4-2M6 9l4 2" stroke="#A5C1C8" strokeWidth="1.2" /></>,
    edit: <><path d="M11 2l3 3-8 8H3v-3l8-8z" stroke="#A5C1C8" strokeWidth="1.2" strokeLinejoin="round" /></>,
  };

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
      <h3 className="text-sm font-semibold text-[#231714] mb-3 flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">{icons[icon]}</svg>
        {title}
        {required && <span className="text-[10px] text-red-400 font-normal">必須</span>}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] text-[#231714]/60 mb-1">
        {label}
        {optional && <span className="text-[#231714]/55 ml-1">任意</span>}
      </label>
      {children}
    </div>
  );
}

function ToggleButton({ selected, onClick, label, small }: { selected: boolean; onClick: () => void; label: string; small?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${small ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"} rounded-xl border transition-colors ${
        selected
          ? "bg-[#231714] text-white border-[#231714]"
          : "bg-white text-[#231714]/60 border-[#231714]/10 hover:border-[#231714]/30"
      }`}
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
  const selectClass = `w-full px-2 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] bg-white`;

  return (
    <div className="grid grid-cols-3 gap-2">
      <select value={parts[0] || ""} onChange={(e) => update(0, e.target.value)} className={`${selectClass} ${!parts[0] ? "text-[#231714]/55" : ""}`}>
        <option value="">年</option>
        {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={String(y)}>{y}年</option>)}
      </select>
      <select value={parts[1] || ""} onChange={(e) => update(1, e.target.value)} className={`${selectClass} ${!parts[1] ? "text-[#231714]/55" : ""}`}>
        <option value="">月</option>
        {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => <option key={m} value={m}>{Number(m)}月</option>)}
      </select>
      <select value={parts[2] || ""} onChange={(e) => update(2, e.target.value)} className={`${selectClass} ${!parts[2] ? "text-[#231714]/55" : ""}`}>
        <option value="">日</option>
        {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => <option key={d} value={d}>{Number(d)}日</option>)}
      </select>
    </div>
  );
}
