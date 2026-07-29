import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireMemberProfileComplete } from "@/lib/auth";
import { normalizeRole } from "@/lib/roles";

export const dynamic = "force-dynamic";

/**
 * 同伴者ピッカーの候補1件。
 * メンバー一覧（/api/members）とは別物: あちらは「スキル登録済みの人物カード」を返すのに対し、
 * こちらは「同伴者に指名できる利用者」＝ active かつゲスト以外を漏れなく返す。
 */
export interface CompanionCandidate {
  lineUserId: string;
  displayName: string;
  pictureUrl: string;
  companyName: string; // 同姓同名の判別補助。無ければ ""
}

/** Firestore の getAll は一度に大量に投げないよう分割する */
const CHUNK_SIZE = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * GET /api/reservations/companions
 * 同伴者に指名できる利用者の一覧（ゲスト・自分自身を除く）。
 *
 * 認可は予約 POST と同じ requireMemberProfileComplete。
 * 「候補は見えるのに予約できない」不整合を作らないため、閲覧系より一段強いゲートを使う。
 */
export async function GET(req: NextRequest) {
  try {
    const lineUserId = await requireMemberProfileComplete(req);
    if (!lineUserId) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }

    const db = getDb();

    // 身分の正は authorizedUsers。active の単一フィールド条件だけで引き、
    // role の判定はメモリで行う（複合インデックスを増やさない）。
    const authSnap = await db
      .collection("authorizedUsers")
      .where("active", "==", true)
      .get();

    // lineUserId → 表示名。同一 lineUserId の doc が複数ある場合（招待の再発行など）は
    // 最初に見つかった active な doc を採用する。
    const nameById = new Map<string, string>();
    for (const doc of authSnap.docs) {
      const d = doc.data();
      const id: string = typeof d.lineUserId === "string" ? d.lineUserId : "";
      if (!id) continue;                          // LINE 未連携は同伴者に指名できない
      if (id === lineUserId) continue;            // 自分は候補に出さない（サーバー側で除外する）
      if (normalizeRole(d.role) === "guest") continue;
      if (nameById.has(id)) continue;
      nameById.set(id, typeof d.displayName === "string" ? d.displayName : "");
    }

    const ids = Array.from(nameById.keys());

    // users は docId = lineUserId なので、全件スキャンせずピンポイントに引く。
    const userDocs: FirebaseFirestore.DocumentSnapshot[] = [];
    for (const part of chunk(ids, CHUNK_SIZE)) {
      const refs = part.map((id) => db.collection("users").doc(id));
      userDocs.push(...(await db.getAll(...refs)));
    }

    const profileById = new Map<string, { pictureUrl: string; companyName: string; fallbackName: string }>();
    for (const doc of userDocs) {
      if (!doc.exists) continue;
      const d = doc.data() ?? {};
      const mp = d.memberProfile || {};
      profileById.set(doc.id, {
        pictureUrl: d.pictureUrl || "",
        companyName: mp.companyName || "",
        fallbackName: d.displayName || d.lineDisplayName || "",
      });
    }

    const candidates: CompanionCandidate[] = ids
      .map((id) => {
        const p = profileById.get(id);
        return {
          lineUserId: id,
          // 表示名は管理画面で必ず入る authorizedUsers を優先し、画面間で名前がブレないようにする
          displayName: nameById.get(id) || p?.fallbackName || "",
          pictureUrl: p?.pictureUrl || "",
          companyName: p?.companyName || "",
        };
      })
      .filter((c) => c.displayName !== "")
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "ja"));

    // 鮮度管理はクライアント側のキャッシュに一元化する。
    return NextResponse.json({ candidates }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[reservations/companions] GET error:", error);
    return NextResponse.json({ error: "候補の取得に失敗しました" }, { status: 500 });
  }
}
