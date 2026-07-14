import { NextRequest, NextResponse } from "next/server";
import { requireMember, requireMemberWithRole } from "@/lib/auth";
import { getDb } from "@/lib/firebaseAdmin";
import { normalizeRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** エイト社員の会社名はサーバー側で固定（入力不要・同一社内で重複しても意味がないため）。 */
const STAFF_COMPANY_NAME = "エイトデザイン株式会社";

/**
 * プロフィール情報の型定義
 */
interface ProfileData {
  lastName: string;         // 姓
  firstName: string;        // 名
  lastNameKana: string;     // セイ
  firstNameKana: string;    // メイ
  email: string;            // メールアドレス
  phone: string;            // 電話番号
  birthday: string;         // 生年月日 (YYYY-MM-DD)
  gender: string;           // 性別
  companyName: string;      // 会社名
  jobTitle: string;         // 職種
  industry: string;         // 業種
  purpose: string;          // 利用目的
  postalCode: string;       // 郵便番号
  prefecture: string;       // 都道府県
  city: string;             // 市区町村
  address: string;          // 番地
  building: string;         // 建物名
  addressType: string;      // 住所種別: "home" | "office"
  // Step 3（任意）
  skills?: string[];        // スキル
  companyUrl?: string;      // 会社URL
  bio?: string;             // 自己紹介
  socialLinks?: {           // SNSリンク
    instagram?: string;
    x?: string;
    facebook?: string;
    other?: string;
  };
  lineUrl?: string;         // LINE友だち追加URL（任意・メンバー同士の直接連絡用）
  // 後方互換（旧データ）
  occupation?: string;
}

// 会員（member）の必須項目（3 ステップ）。
const REQUIRED_FIELDS: (keyof ProfileData)[] = [
  "lastName",
  "firstName",
  "lastNameKana",
  "firstNameKana",
  "email",
  "phone",
  "birthday",
  "gender",
  "companyName",
  "jobTitle",
  "industry",
  "purpose",
  "postalCode",
  "prefecture",
  "city",
  "address",
  "addressType",
];

// エイト社員（staff）の必須項目（簡素版）。会社名は自動固定、住所・生年月日・性別・業種等は不要。
const STAFF_REQUIRED_FIELDS: (keyof ProfileData)[] = [
  "lastName",
  "firstName",
  "lastNameKana",
  "firstNameKana",
  "email",
  "phone",
  "jobTitle",
];

/**
 * GET /api/auth/profile
 * セッションユーザーのプロフィール情報を取得する
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireMember(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const db = getDb();

    // authorizedUsers から lineUserId で検索
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", userId)
      .limit(1)
      .get();

    if (snap.empty) {
      // 審査モードチェック: 未登録ユーザーにはダミープロフィールを返す
      let isReviewMode = false;
      try {
        const settingsDoc = await db.collection("settings").doc("app").get();
        isReviewMode = settingsDoc.exists && settingsDoc.data()?.reviewMode === true;
      } catch (e) {
        console.warn("[auth/profile] settings fetch error:", e);
      }

      if (isReviewMode) {
        return NextResponse.json({
          profileComplete: true,
          profile: {
            lastName: "審査", firstName: "太郎",
            lastNameKana: "シンサ", firstNameKana: "タロウ",
            phone: "09012345678", birthday: "1990-01-01", gender: "male",
            occupation: "審査担当", purpose: "プロジェクト利用",
            postalCode: "1000001", prefecture: "東京都", city: "千代田区",
            address: "1-1", building: "", addressType: "office",
          },
          displayName: "審査 太郎",
        });
      }

      return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
    }

    const userData = snap.docs[0].data();
    const profile = userData.profile || null;
    const profileComplete = !!userData.profileComplete;

    return NextResponse.json({
      profileComplete,
      profile,
      // 登録フォームの分岐用（member=3 ステップ / staff=簡素版）。
      role: normalizeRole(userData.role),
      displayName: userData.displayName,
    });
  } catch (error) {
    console.error("[auth/profile] GET error:", error);
    return NextResponse.json(
      { error: "プロフィール取得に失敗しました" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/profile
 * プロフィール情報を保存する
 * Body: ProfileData
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireMemberWithRole(req);
    if (!auth) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const userId = auth.lineUserId;
    const isStaff = auth.role === "staff";

    const body = await req.json();
    const profile = body as ProfileData;

    // 必須項目は身分で分岐（member=3 ステップ / staff=簡素版）。
    const requiredFields = isStaff ? STAFF_REQUIRED_FIELDS : REQUIRED_FIELDS;
    // バリデーション（必須フィールドは全て string 型）
    const missing = requiredFields.filter((f) => {
      const v = profile[f];
      return typeof v !== "string" || !v.trim();
    });
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `入力が不足しています: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // 電話番号の簡易バリデーション
    const phoneClean = profile.phone.replace(/[-\s]/g, "");
    if (!/^0\d{9,10}$/.test(phoneClean)) {
      return NextResponse.json(
        { error: "電話番号の形式が正しくありません" },
        { status: 400 }
      );
    }

    // カナのバリデーション
    const kanaRegex = /^[\u30A0-\u30FF\u3000\s]+$/;
    if (!kanaRegex.test(profile.lastNameKana) || !kanaRegex.test(profile.firstNameKana)) {
      return NextResponse.json(
        { error: "氏名（カナ）はカタカナで入力してください" },
        { status: 400 }
      );
    }

    // メールアドレスのバリデーション
    if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email.trim())) {
      return NextResponse.json(
        { error: "メールアドレスの形式が正しくありません" },
        { status: 400 }
      );
    }

    const db = getDb();

    // authorizedUsers から lineUserId で検索
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", userId)
      .limit(1)
      .get();

    if (snap.empty) {
      // 審査モード: 保存はスキップして成功を返す
      let isReviewMode = false;
      try {
        const settingsDoc = await db.collection("settings").doc("app").get();
        isReviewMode = settingsDoc.exists && settingsDoc.data()?.reviewMode === true;
      } catch (e) {
        console.warn("[auth/profile] settings fetch error:", e);
      }

      if (isReviewMode) {
        return NextResponse.json({ success: true });
      }

      return NextResponse.json({ error: "ユーザーが見つかりません" }, { status: 404 });
    }

    const docRef = snap.docs[0].ref;

    // プロフィールを保存（身分で保存内容を分岐）。
    // - 共通: 氏名・カナ・メール・電話・職種
    // - staff: 会社名は自動固定（エイトデザイン株式会社）。住所・生年月日・性別・業種・利用目的・
    //          スキル・会社URL・SNS は登録させないので保存もしない。任意で自己紹介・LINE連絡先のみ。
    // - member: 従来どおり全項目（3 ステップ）。
    const cleanProfile: Record<string, unknown> = isStaff
      ? {
          lastName: profile.lastName.trim(),
          firstName: profile.firstName.trim(),
          lastNameKana: profile.lastNameKana.trim(),
          firstNameKana: profile.firstNameKana.trim(),
          email: profile.email.trim().toLowerCase(),
          phone: phoneClean,
          companyName: STAFF_COMPANY_NAME,
          jobTitle: profile.jobTitle.trim(),
        }
      : {
          lastName: profile.lastName.trim(),
          firstName: profile.firstName.trim(),
          lastNameKana: profile.lastNameKana.trim(),
          firstNameKana: profile.firstNameKana.trim(),
          email: profile.email.trim().toLowerCase(),
          phone: phoneClean,
          birthday: profile.birthday.trim(),
          gender: profile.gender.trim(),
          companyName: profile.companyName.trim(),
          jobTitle: profile.jobTitle.trim(),
          industry: profile.industry.trim(),
          purpose: profile.purpose.trim(),
          postalCode: profile.postalCode.trim(),
          prefecture: profile.prefecture.trim(),
          city: profile.city.trim(),
          address: profile.address.trim(),
          building: (profile.building || "").trim(),
          addressType: profile.addressType.trim(),
        };

    // 任意フィールド（自己紹介・LINE連絡先は staff/member 共通で保存可）。
    if (profile.bio?.trim()) {
      cleanProfile.bio = profile.bio.trim();
    }
    if (profile.lineUrl?.trim()) {
      cleanProfile.lineUrl = profile.lineUrl.trim().slice(0, 300);
    }
    // 会社URL・SNS は会員のみ（staff は登録画面に出さない）。
    if (!isStaff) {
      if (profile.companyUrl?.trim()) {
        cleanProfile.companyUrl = profile.companyUrl.trim();
      }
      if (profile.socialLinks) {
        const sl: Record<string, string> = {};
        if (profile.socialLinks.instagram?.trim()) sl.instagram = profile.socialLinks.instagram.trim();
        if (profile.socialLinks.x?.trim()) sl.x = profile.socialLinks.x.trim();
        if (profile.socialLinks.facebook?.trim()) sl.facebook = profile.socialLinks.facebook.trim();
        if (profile.socialLinks.other?.trim()) sl.other = profile.socialLinks.other.trim();
        if (Object.keys(sl).length > 0) cleanProfile.socialLinks = sl;
      }
    }

    const displayName = `${cleanProfile.lastName} ${cleanProfile.firstName}`;

    // memberProfile にも会社名・職種等を同期（メンバー検索用）。
    const memberProfileUpdate: Record<string, unknown> = {
      companyName: cleanProfile.companyName,
      jobTitle: cleanProfile.jobTitle,
    };
    if (!isStaff) memberProfileUpdate.industry = cleanProfile.industry;
    if (profile.bio?.trim()) memberProfileUpdate.bio = cleanProfile.bio;
    if (profile.lineUrl?.trim()) memberProfileUpdate.lineUrl = cleanProfile.lineUrl;
    if (!isStaff && profile.companyUrl?.trim()) memberProfileUpdate.companyUrl = cleanProfile.companyUrl;
    if (!isStaff && profile.socialLinks && cleanProfile.socialLinks) memberProfileUpdate.socialLinks = cleanProfile.socialLinks;

    await docRef.update({
      profile: cleanProfile,
      profileComplete: true,
      displayName,
      profileUpdatedAt: new Date().toISOString(),
    });

    // users コレクションにも氏名・メンバー情報を同期
    const userRef = db.collection("users").doc(userId);
    const userUpdateData: Record<string, unknown> = {
      displayName,
      updatedAt: new Date().toISOString(),
    };

    // skills は Step 3 で設定された場合に同期（staff はスキル登録なし＝同期しない）
    if (!isStaff && Array.isArray(profile.skills) && profile.skills.length > 0) {
      memberProfileUpdate.skills = profile.skills;
    }

    // 既存の memberProfile とマージ
    const existingUser = await userRef.get();
    const existingMp = existingUser.exists ? (existingUser.data()?.memberProfile || {}) : {};
    userUpdateData.memberProfile = { ...existingMp, ...memberProfileUpdate };

    await userRef.set(userUpdateData, { merge: true });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[auth/profile] POST error:", error);
    return NextResponse.json(
      { error: "プロフィール保存に失敗しました" },
      { status: 500 }
    );
  }
}
