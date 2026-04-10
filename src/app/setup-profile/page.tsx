"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

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
  "リモートワーク",
  "フリーランス",
  "勉強・学習",
  "会議・打ち合わせ",
  "副業",
  "起業準備",
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
  phone: string;
  birthday: string;
  gender: string;
  occupation: string;
  purpose: string;
  postalCode: string;
  prefecture: string;
  city: string;
  address: string;
  building: string;
  addressType: string;
}

const EMPTY_FORM: FormData = {
  lastName: "",
  firstName: "",
  lastNameKana: "",
  firstNameKana: "",
  phone: "",
  birthday: "",
  gender: "",
  occupation: "",
  purpose: "",
  postalCode: "",
  prefecture: "",
  city: "",
  address: "",
  building: "",
  addressType: "home",
};

export default function SetupProfilePage() {
  const router = useRouter();
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(1); // 1: 基本情報, 2: 住所情報

  // 既存プロフィールを読み込み
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch("/api/auth/profile", { credentials: "include" });
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        if (data.profileComplete) {
          router.replace("/reservation");
          return;
        }
        if (data.profile) {
          setForm({ ...EMPTY_FORM, ...data.profile });
        }
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    loadProfile();
  }, [router]);

  // 郵便番号から住所自動入力
  async function lookupPostalCode() {
    const code = form.postalCode.replace(/[-\s]/g, "");
    if (code.length !== 7) return;

    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${code}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const r = data.results[0];
        setForm((prev) => ({
          ...prev,
          prefecture: r.address1,
          city: r.address2 + r.address3,
        }));
      }
    } catch {
      // 無視
    }
  }

  function updateForm(key: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // ステップ1バリデーション
  function validateStep1(): string | null {
    if (!form.lastName.trim() || !form.firstName.trim()) return "氏名を入力してください";
    if (!form.lastNameKana.trim() || !form.firstNameKana.trim()) return "氏名（カナ）を入力してください";
    const kanaRegex = /^[\u30A0-\u30FF\u3000\s]+$/;
    if (!kanaRegex.test(form.lastNameKana) || !kanaRegex.test(form.firstNameKana)) {
      return "氏名（カナ）はカタカナで入力してください";
    }
    if (!form.phone.trim()) return "電話番号を入力してください";
    if (!form.birthday) return "生年月日を入力してください";
    if (!form.gender) return "性別を選択してください";
    if (!form.occupation.trim()) return "職業・会社名を入力してください";
    if (!form.purpose) return "利用目的を選択してください";
    return null;
  }

  function handleNext() {
    const err = validateStep1();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setStep(2);
    window.scrollTo(0, 0);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.postalCode.trim()) { setError("郵便番号を入力してください"); return; }
    if (!form.prefecture) { setError("都道府県を選択してください"); return; }
    if (!form.city.trim()) { setError("市区町村を入力してください"); return; }
    if (!form.address.trim()) { setError("番地を入力してください"); return; }

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
        router.replace("/reservation");
      } else {
        setError(data.error || "保存に失敗しました");
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setSubmitting(false);
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ヘッダー */}
      <div className="bg-[#A5C1C8] px-5 pt-12 pb-6">
        <h1 className="text-xl font-bold tracking-wide text-[#231714]">プロフィール登録</h1>
        <p className="text-sm text-[#231714]/60 mt-1">
          ご利用にあたり、お客様情報をご入力ください
        </p>
        {/* ステップインジケーター */}
        <div className="flex items-center gap-2 mt-4">
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
            step === 1 ? "bg-[#231714] text-white" : "bg-white/40 text-[#231714]/60"
          }`}>
            <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">1</span>
            基本情報
          </div>
          <div className="w-4 h-px bg-[#231714]/20" />
          <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
            step === 2 ? "bg-[#231714] text-white" : "bg-white/40 text-[#231714]/60"
          }`}>
            <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center text-[10px]">2</span>
            住所情報
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 pt-5 pb-8">
        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* ステップ1: 基本情報 */}
        {step === 1 && (
          <div className="space-y-4">
            {/* 氏名 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-[#231714] mb-3 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2a3.5 3.5 0 013.5 3.5v0A3.5 3.5 0 018 9v0a3.5 3.5 0 01-3.5-3.5v0A3.5 3.5 0 018 2z" stroke="#A5C1C8" strokeWidth="1.3" />
                  <path d="M2.5 14c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5" stroke="#A5C1C8" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
                氏名
                <span className="text-[10px] text-red-400 font-normal">必須</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-[#231714]/40 mb-1">姓</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={(e) => updateForm("lastName", e.target.value)}
                    placeholder="山田"
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#231714]/40 mb-1">名</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={(e) => updateForm("firstName", e.target.value)}
                    placeholder="太郎"
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div>
                  <label className="block text-[11px] text-[#231714]/40 mb-1">セイ</label>
                  <input
                    type="text"
                    value={form.lastNameKana}
                    onChange={(e) => updateForm("lastNameKana", e.target.value)}
                    placeholder="ヤマダ"
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-[#231714]/40 mb-1">メイ</label>
                  <input
                    type="text"
                    value={form.firstNameKana}
                    onChange={(e) => updateForm("firstNameKana", e.target.value)}
                    placeholder="タロウ"
                    className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                  />
                </div>
              </div>
            </div>

            {/* 電話番号 & 生年月日 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-[#231714] mb-3 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M5.5 2H4a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2h-1.5" stroke="#A5C1C8" strokeWidth="1.3" />
                  <rect x="5" y="1" width="6" height="3" rx="1" stroke="#A5C1C8" strokeWidth="1.3" />
                </svg>
                連絡先・基本情報
                <span className="text-[10px] text-red-400 font-normal">必須</span>
              </h3>

              <div>
                <label className="block text-[11px] text-[#231714]/40 mb-1">電話番号</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateForm("phone", e.target.value)}
                  placeholder="090-1234-5678"
                  autoComplete="tel"
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>

              <div className="mt-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">生年月日</label>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <select
                      value={form.birthday ? form.birthday.split("-")[0] : ""}
                      onChange={(e) => {
                        const parts = (form.birthday || "--").split("-");
                        parts[0] = e.target.value;
                        updateForm("birthday", parts.join("-"));
                      }}
                      className={`w-full px-2 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] bg-white ${
                        !form.birthday?.split("-")[0] ? "text-[#231714]/30" : "text-[#231714]"
                      }`}
                    >
                      <option value="">年</option>
                      {Array.from({ length: 80 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                        <option key={y} value={String(y)}>{y}年</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select
                      value={form.birthday ? form.birthday.split("-")[1] : ""}
                      onChange={(e) => {
                        const parts = (form.birthday || "--").split("-");
                        parts[1] = e.target.value;
                        updateForm("birthday", parts.join("-"));
                      }}
                      className={`w-full px-2 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] bg-white ${
                        !form.birthday?.split("-")[1] ? "text-[#231714]/30" : "text-[#231714]"
                      }`}
                    >
                      <option value="">月</option>
                      {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")).map((m) => (
                        <option key={m} value={m}>{Number(m)}月</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <select
                      value={form.birthday ? form.birthday.split("-")[2] : ""}
                      onChange={(e) => {
                        const parts = (form.birthday || "--").split("-");
                        parts[2] = e.target.value;
                        updateForm("birthday", parts.join("-"));
                      }}
                      className={`w-full px-2 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] bg-white ${
                        !form.birthday?.split("-")[2] ? "text-[#231714]/30" : "text-[#231714]"
                      }`}
                    >
                      <option value="">日</option>
                      {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, "0")).map((d) => (
                        <option key={d} value={d}>{Number(d)}日</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">性別</label>
                <div className="grid grid-cols-4 gap-2">
                  {GENDER_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => updateForm("gender", opt.value)}
                      className={`py-2 text-xs rounded-xl border transition-colors ${
                        form.gender === opt.value
                          ? "bg-[#231714] text-white border-[#231714]"
                          : "bg-white text-[#231714]/60 border-[#231714]/10 hover:border-[#231714]/30"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 職業 & 利用目的 */}
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-[#231714] mb-3 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2" y="4" width="12" height="10" rx="2" stroke="#A5C1C8" strokeWidth="1.3" />
                  <path d="M5 4V3a2 2 0 012-2h2a2 2 0 012 2v1" stroke="#A5C1C8" strokeWidth="1.3" />
                </svg>
                ご利用について
                <span className="text-[10px] text-red-400 font-normal">必須</span>
              </h3>

              <div>
                <label className="block text-[11px] text-[#231714]/40 mb-1">職業・会社名</label>
                <input
                  type="text"
                  value={form.occupation}
                  onChange={(e) => updateForm("occupation", e.target.value)}
                  placeholder="例: フリーランスエンジニア / 株式会社〇〇"
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>

              <div className="mt-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">利用目的</label>
                <div className="flex flex-wrap gap-2">
                  {PURPOSE_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => updateForm("purpose", opt)}
                      className={`px-3 py-2 text-xs rounded-xl border transition-colors ${
                        form.purpose === opt
                          ? "bg-[#231714] text-white border-[#231714]"
                          : "bg-white text-[#231714]/60 border-[#231714]/10 hover:border-[#231714]/30"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 次へボタン */}
            <button
              type="button"
              onClick={handleNext}
              className="w-full py-3.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 transition-colors flex items-center justify-center gap-2"
            >
              次へ — 住所情報
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M5 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        )}

        {/* ステップ2: 住所情報 */}
        {step === 2 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
              <h3 className="text-sm font-semibold text-[#231714] mb-3 flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 1.5l6 5v7.5a1 1 0 01-1 1H3a1 1 0 01-1-1V6.5l6-5z" stroke="#A5C1C8" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M6 15v-4h4v4" stroke="#A5C1C8" strokeWidth="1.3" />
                </svg>
                住所
                <span className="text-[10px] text-red-400 font-normal">必須</span>
              </h3>

              {/* 住所種別 */}
              <div className="mb-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">住所種別</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => updateForm("addressType", "home")}
                    className={`py-2.5 text-xs rounded-xl border transition-colors ${
                      form.addressType === "home"
                        ? "bg-[#231714] text-white border-[#231714]"
                        : "bg-white text-[#231714]/60 border-[#231714]/10 hover:border-[#231714]/30"
                    }`}
                  >
                    自宅住所
                  </button>
                  <button
                    type="button"
                    onClick={() => updateForm("addressType", "office")}
                    className={`py-2.5 text-xs rounded-xl border transition-colors ${
                      form.addressType === "office"
                        ? "bg-[#231714] text-white border-[#231714]"
                        : "bg-white text-[#231714]/60 border-[#231714]/10 hover:border-[#231714]/30"
                    }`}
                  >
                    会社住所
                  </button>
                </div>
              </div>

              {/* 郵便番号 */}
              <div className="mb-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">郵便番号</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={form.postalCode}
                    onChange={(e) => updateForm("postalCode", e.target.value)}
                    placeholder="123-4567"
                    maxLength={8}
                    className="flex-1 px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                  />
                  <button
                    type="button"
                    onClick={lookupPostalCode}
                    className="px-4 py-2.5 text-xs bg-[#A5C1C8]/30 text-[#231714] rounded-xl hover:bg-[#A5C1C8]/40 transition-colors whitespace-nowrap"
                  >
                    住所検索
                  </button>
                </div>
              </div>

              {/* 都道府県 */}
              <div className="mb-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">都道府県</label>
                <select
                  value={form.prefecture}
                  onChange={(e) => updateForm("prefecture", e.target.value)}
                  className={`w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714] ${
                    !form.prefecture ? "text-[#231714]/30" : "text-[#231714]"
                  }`}
                >
                  <option value="">選択してください</option>
                  {PREFECTURES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              {/* 市区町村 */}
              <div className="mb-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">市区町村</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => updateForm("city", e.target.value)}
                  placeholder="渋谷区神宮前"
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>

              {/* 番地 */}
              <div className="mb-3">
                <label className="block text-[11px] text-[#231714]/40 mb-1">番地</label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => updateForm("address", e.target.value)}
                  placeholder="1-2-3"
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>

              {/* 建物名 */}
              <div>
                <label className="block text-[11px] text-[#231714]/40 mb-1">
                  建物名・部屋番号
                  <span className="text-[#231714]/20 ml-1">任意</span>
                </label>
                <input
                  type="text"
                  value={form.building}
                  onChange={(e) => updateForm("building", e.target.value)}
                  placeholder="〇〇マンション 101号室"
                  className="w-full px-3 py-2.5 text-sm border border-[#231714]/10 rounded-xl focus:outline-none focus:border-[#231714] focus:ring-1 focus:ring-[#231714]"
                />
              </div>
            </div>

            {/* ボタン */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setStep(1); setError(null); window.scrollTo(0, 0); }}
                className="flex-1 py-3.5 text-sm border border-[#231714]/10 rounded-xl text-[#231714]/60 hover:bg-[#231714]/5 transition-colors flex items-center justify-center gap-1"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9 3l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                戻る
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-[2] py-3.5 text-sm font-medium bg-[#231714] text-white rounded-xl hover:bg-[#231714]/80 disabled:opacity-50 transition-colors"
              >
                {submitting ? "登録中..." : "登録して利用開始"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
