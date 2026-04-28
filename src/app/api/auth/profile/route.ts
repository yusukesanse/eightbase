import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";

export const dynamic = "force-dynamic";

/**
 * プロフィール情報の型定義
 */
interface ProfileData {
  lastName: string;         // 姓
  firstName: string;        // 名
  lastNameKana: string;     // セイ
  firstNameKana: string;    // メイ
  phone: string;            // 電話番号
  birthday: string;         // 生年月日 (YYYY-MM-DD)
  gender: string;           // 性別
  occupation: string;       // 職業 or 会社名
  purpose: string;          // 利用目的
  postalCode: string;       // 郵便番号
  prefecture: string;       // 都道府県
  city: string;             // 市区町村
  address: string;          // 番地
  building: string;         // 建物名
  addressType: string;      // 住所種別: "home" | "office"
}

const REQUIRED_FIELDS: (keyof ProfileData)[] = [
  "lastName",
  "firstName",
  "lastNameKana",
  "firstNameKana",
  "phone",
  "birthday",
  "gender",
  "occupation",
  "purpose",
  "postalCode",
  "prefecture",
  "city",
  "address",
  "addressType",
];

/**
 * GET /api/auth/profile
 * セッションユーザーのプロフィール情報を取得する
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await getSessionUserId(req);
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
    const userId = await getSessionUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const body = await req.json();
    const profile = body as ProfileData;

    // バリデーション
    const missing = REQUIRED_FIELDS.filter((f) => !profile[f]?.trim());
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

    // プロフィールを保存
    const cleanProfile: ProfileData = {
      lastName: profile.lastName.trim(),
      firstName: profile.firstName.trim(),
      lastNameKana: profile.lastNameKana.trim(),
      firstNameKana: profile.firstNameKana.trim(),
      phone: phoneClean,
      birthday: profile.birthday.trim(),
      gender: profile.gender.trim(),
      occupation: profile.occupation.trim(),
      purpose: profile.purpose.trim(),
      postalCode: profile.postalCode.trim(),
      prefecture: profile.prefecture.trim(),
      city: profile.city.trim(),
      address: profile.address.trim(),
      building: (profile.building || "").trim(),
      addressType: profile.addressType.trim(),
    };

    await docRef.update({
      profile: cleanProfile,
      profileComplete: true,
      displayName: `${cleanProfile.lastName} ${cleanProfile.firstName}`,
      profileUpdatedAt: new Date().toISOString(),
    });

    // users コレクションにも氏名を同期
    const userRef = db.collection("users").doc(userId);
    await userRef.set(
      {
        displayName: `${cleanProfile.lastName} ${cleanProfile.firstName}`,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[auth/profile] POST error:", error);
    return NextResponse.json(
      { error: "プロフィール保存に失敗しました" },
      { status: 500 }
    );
  }
}
