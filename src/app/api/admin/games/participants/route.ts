import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { normalizeRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

const CHUNK_SIZE = 30;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * GET /api/admin/games/participants
 * 管理者が対戦結果を手入力するときの「参加者候補」一覧。
 *
 * ⚠️ **ゲストを除外しないこと。** ゲームはゲストも参加する（むしろゲスト救済のための機能）。
 *    会員向けの `/api/members` は使わない（スキル未登録者を意図的に落とすため候補が欠ける）。
 *
 * 身分の正は `authorizedUsers`（active かつ LINE 連携済み）。アイコンだけ `users`（docId=lineUserId）から補う。
 */
export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const snap = await db.collection("authorizedUsers").where("active", "==", true).get();

    // 同一 lineUserId の doc が複数ある場合（招待の再発行など）は最初の1件を採用。
    const byId = new Map<string, { lineUserId: string; displayName: string; role: string }>();
    for (const doc of snap.docs) {
      const d = doc.data();
      const id = typeof d.lineUserId === "string" ? d.lineUserId : "";
      if (!id || byId.has(id)) continue;         // LINE 未連携は対戦結果に紐づけられない
      byId.set(id, {
        lineUserId: id,
        displayName: typeof d.displayName === "string" ? d.displayName : "",
        role: normalizeRole(d.role),
      });
    }

    const ids = Array.from(byId.keys());
    const pictureById = new Map<string, string>();
    for (const part of chunk(ids, CHUNK_SIZE)) {
      const docs = await db.getAll(...part.map((id) => db.collection("users").doc(id)));
      for (const doc of docs) {
        if (doc.exists) pictureById.set(doc.id, (doc.data()?.pictureUrl as string) || "");
      }
    }

    const participants = Array.from(byId.values())
      .map((u) => ({ ...u, pictureUrl: pictureById.get(u.lineUserId) || "" }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));

    return NextResponse.json({ participants });
  } catch (error) {
    console.error("[admin/games/participants] GET error:", error);
    return NextResponse.json({ error: "候補の取得に失敗しました" }, { status: 500 });
  }
}
