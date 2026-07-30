import { NextRequest, NextResponse } from "next/server";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getDb } from "@/lib/firebaseAdmin";
import { getFacilityById } from "@/lib/facilities";
import {
  generatePasscode,
  issueTimeLimitPasscodeWithRetry,
  deletePasscodeByName,
} from "@/lib/switchbot";
import { reservationEpochMs } from "@/lib/reservations";
import { FieldValue } from "firebase-admin/firestore";
import dayjs from "dayjs";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reservations/[id]/reissue
 * 解錠コードの手動再発行（switchBotStatus="failed" の救済など）。
 * 既存キーがあれば無効化してから、予約時間で有効な新しい6桁コードを発行する。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  const ref = db.collection("reservations").doc(id);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }
  const r = snap.data()!;
  if (r.status !== "confirmed") {
    return NextResponse.json(
      { error: "確定済みの予約のみ再発行できます" },
      { status: 400 }
    );
  }

  const facility = await getFacilityById(r.facilityId);
  if (!facility?.switchBotDeviceId) {
    return NextResponse.json(
      { error: "この施設は解錠デバイスが未設定です" },
      { status: 400 }
    );
  }

  // 既存キーを削除（重複・孤児キー防止）。
  // ⚠️ **name（予約ID）で消すこと**が必須。issueTimeLimitPasscode は同名キーがあると
  //    作成せず既存を返すので、消し漏れると「新コードを保存したのに端末は旧コードのまま」になる。
  //    switchBotKeyId が未保存（keyId 未取得）のケースも name 指定なら確実に消せる。
  try {
    await deletePasscodeByName(facility.switchBotDeviceId, id);
  } catch (e) {
    console.error("[admin/reservations/reissue] old key delete failed:", e);
    return NextResponse.json(
      {
        error: "REISSUE_FAILED",
        message:
          "古い解錠コードを削除できませんでした。端末に旧コードが残るため再発行を中止しました。",
      },
      { status: 502 }
    );
  }

  const code = generatePasscode();
  const startMs = reservationEpochMs(r.date, r.startTime);
  const endMs = reservationEpochMs(r.date, r.endTime);
  try {
    const { keyId } = await issueTimeLimitPasscodeWithRetry({
      deviceId: facility.switchBotDeviceId,
      name: id,
      password: code,
      startMs,
      endMs,
    });
    await ref.update({
      switchBotPasscode: code,
      // keyId は取れないことがある（createKey は id を返さず、keyList 反映が非同期）。
      // 取れなければフィールドを消しておく（古い id を残すと無関係なキーを消しかねない）。
      switchBotKeyId: keyId ?? FieldValue.delete(),
      switchBotPasscodeExpiresAt: new Date(endMs).toISOString(),
      switchBotStatus: "issued",
      updatedAt: dayjs().toISOString(),
    });
    return NextResponse.json({ success: true, passcode: code });
  } catch (e) {
    return NextResponse.json(
      {
        error: "REISSUE_FAILED",
        message: e instanceof Error ? e.message : "再発行に失敗しました",
      },
      { status: 502 }
    );
  }
}
