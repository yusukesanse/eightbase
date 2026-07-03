import { NextRequest, NextResponse } from "next/server";
import { signSession, setSessionCookie } from "@/lib/session";
import { getDb } from "@/lib/firebaseAdmin";
import { isDevLoginEnabled } from "@/lib/env";
import { isGamesOnlyRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * DEV-ONLY（develop 専用 / main へ入れない）
 * POST /api/dev/quick-login  （検証環境専用・LINE切り離し）
 *
 * ワンクリックで「会員 / ゲスト / 新規」のテストユーザーとして実 `__session` を発行する。
 * authorizedUsers にレコードを upsert するので、**管理者アプリの顧客一覧にも表示される**
 * （＝管理側で確認・昇格・無効化などの操作対象になる）。
 *
 * - 非本番（Dev ログイン）でのみ動作。本番は 404。
 * - OTP / LINE を通さないため無限ループが起きない（home は AuthGuard の判定と一致させる）。
 *
 * Body: { role: "member" | "guest" | "new" }
 */
const PRESETS = {
  member: { lineUserId: "dev-member-01", displayName: "demoユーザー", role: "member" as const, profileComplete: true },
  guest: { lineUserId: "dev-guest-01", displayName: "ゲストテスト", role: "guest" as const, profileComplete: false },
  staff: { lineUserId: "dev-staff-01", displayName: "エイト社員テスト", role: "staff" as const, profileComplete: false },
};

export async function POST(req: NextRequest) {
  if (!isDevLoginEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const kind: "member" | "guest" | "staff" | "new" =
      body?.role === "guest"
        ? "guest"
        : body?.role === "staff"
          ? "staff"
          : body?.role === "new"
            ? "new"
            : "member";

    // 目標のテストユーザー（member/guest は固定ID、new は毎回別ID＝オンボーディング検証用）
    const target =
      kind === "new"
        ? {
            lineUserId: `dev-new-${Date.now().toString(36)}`,
            displayName: "新規テスト",
            role: "member" as const,
            profileComplete: false, // 新規はプロフィール設定から
          }
        : PRESETS[kind];

    const db = getDb();
    const nowIso = new Date().toISOString();

    // authorizedUsers を upsert（テスト用フィクスチャなので role/profileComplete は決め打ちで揃える）
    const snap = await db
      .collection("authorizedUsers")
      .where("lineUserId", "==", target.lineUserId)
      .limit(1)
      .get();
    if (snap.empty) {
      await db.collection("authorizedUsers").doc().set({
        displayName: target.displayName,
        email: "",
        passwordHash: "",
        salt: "",
        lineUserId: target.lineUserId,
        active: true,
        role: target.role,
        profileComplete: target.profileComplete,
        createdAt: nowIso,
        lastLoginAt: nowIso,
        invitationId: null,
        inviteStatus: "linked",
      });
    } else {
      await snap.docs[0].ref.update({
        active: true,
        role: target.role,
        profileComplete: target.profileComplete,
        lastLoginAt: nowIso,
      });
    }

    // users コレクション（表示名/アバターの元）
    await db.collection("users").doc(target.lineUserId).set(
      {
        lineUserId: target.lineUserId,
        displayName: target.displayName,
        lineDisplayName: target.displayName,
        pictureUrl: "",
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    // 遷移先は AuthGuard の判定と一致させる（ループ防止）:
    // guest/staff→Info(ゲーム) / member未完了→プロフィール設定 / member完了→予約ホーム
    const home = isGamesOnlyRole(target.role)
      ? "/info"
      : target.profileComplete
        ? "/reservation"
        : "/setup-profile";

    const token = await signSession(target.lineUserId);
    const res = NextResponse.json({
      success: true,
      home,
      role: target.role,
      profileComplete: target.profileComplete,
      lineUserId: target.lineUserId,
      displayName: target.displayName,
    });
    setSessionCookie(res, token);
    return res;
  } catch (error) {
    console.error("[dev/quick-login] error:", error);
    return NextResponse.json({ error: "Dev ログインに失敗しました" }, { status: 500 });
  }
}
