import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { requireGameUser } from "@/lib/auth";
import { getActiveSeason, isGameMaster } from "@/lib/mahjong";
import { deriveStatus } from "@/lib/mahjongEntryStatus";
import { validateGmAssignment, isAssignmentLocked, ASSIGN_VALID_LABELS, ASSIGN_MAX_SEATS, type AssignTable } from "@/lib/mahjongAssign";
import { writeAuditLog } from "@/lib/auditLog";
import type { MahjongDayState, MahjongEntry, MahjongTable } from "@/types";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/mahjong/day/assign
 * GM 専用: 「いまの半荘」の卓（A/B）と待機を手動確定する。
 * body: { eventDate, tables: [{ label, memberIds }], waiting: [lineUserId] }
 *
 * - 対象の半荘は**サーバーの dayState.round**（クライアントは指定できない）。
 *   GM は順位や前半荘の結果に関係なく、いつでも現半荘を自由に組める。
 * - 認可: requireGameUser ＋ アクティブシーズンの gameMasterIds に含まれること。
 * - 検証: paid のみ・重複なし・卓 ≤4名・全 paid を過不足なく配置（8名=待機0 を含む）。
 * - ロック: 確定済みの半荘で申告が1件でも入っていたら 409（isAssignmentLocked）。
 * - 確定: mahjongTables を upsert（reporting）、dayState.waiting 更新・awaitingAssignment=false。
 */
export async function POST(req: NextRequest) {
  const userId = await requireGameUser(req);
  if (!userId) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const season = await getActiveSeason();
  if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
  if (!isGameMaster(season, userId)) {
    return NextResponse.json({ error: "ゲームマスターのみ利用できます" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const eventDate: unknown = body?.eventDate;
  const tablesIn: unknown = body?.tables;
  const waitingIn: unknown = body?.waiting;

  if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
    return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
  }
  if (!Array.isArray(tablesIn) || !Array.isArray(waitingIn)) {
    return NextResponse.json({ error: "tables / waiting は配列で指定してください" }, { status: 400 });
  }

  // 卓の正規化（空卓は除外・ラベル形式のみ先に検証。人数/重複/paid は validateGmAssignment で）
  const tables: AssignTable[] = [];
  for (const t of tablesIn as AssignTable[]) {
    if (!t || !ASSIGN_VALID_LABELS.includes(t.label) || !Array.isArray(t.memberIds)) {
      return NextResponse.json({ error: "卓の指定が不正です" }, { status: 400 });
    }
    if (t.memberIds.some((id) => typeof id !== "string")) {
      return NextResponse.json({ error: "memberIds が不正です" }, { status: 400 });
    }
    if (t.memberIds.length > 0) tables.push({ label: t.label, memberIds: t.memberIds });
  }
  const waiting = (waitingIn as unknown[]).filter((v): v is string => typeof v === "string");

  const db = getDb();

  // 支払い済みプール（当日）
  const entrySnap = await db.collection("mahjongEntries").where("seasonId", "==", season.seasonId).get();
  const paid = entrySnap.docs
    .map((d) => d.data() as MahjongEntry)
    .filter((e) => e.eventDate === eventDate && deriveStatus(e) === "paid");
  const poolMap = new Map(paid.map((e) => [e.lineUserId, { displayName: e.displayName, pictureUrl: e.pictureUrl ?? "" }]));

  // 検証（paid のみ・重複なし・卓≤4名・全 paid を過不足なく配置＝8名待機0 を含む）
  const v = validateGmAssignment(Array.from(poolMap.keys()), tables, waiting);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const nowIso = new Date().toISOString();
  const dayRef = db.collection("mahjongDayState").doc(`${season.seasonId}_${eventDate}`);

  const result = await db.runTransaction(async (tx) => {
    const daySnap = await tx.get(dayRef);
    if (!daySnap.exists) return { status: 400 as const, error: "当日はまだ開始していません" };
    const day = daySnap.data() as MahjongDayState & { awaitingAssignment?: boolean };
    // 受付が締まる前に卓を組むと、あとから支払った人が入れない。開始（＝締切）が先。
    if (!day.entryClosedAt) {
      return { status: 400 as const, error: "先に「ゲーム開始」を押して受付を締め切ってください" };
    }
    // 対象の半荘はサーバーの dayState.round が唯一の真実。クライアントが送ってくる round は使わない。
    // 画面を開いたまま半荘が進むと round がずれ、GM が「現在は第N半荘の振り分け対象です」で
    // 弾かれて何も振り分けられなくなっていた。GM はいつでも「いまの半荘」を自由に組める。
    const round = day.round;

    // 現 round の既存卓（ロック判定＋不要ラベルの削除に使う）
    const tblSnap = await tx.get(db.collection("mahjongTables").where("seasonId", "==", season.seasonId));
    const existing = tblSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as MahjongTable) }))
      .filter((t) => t.eventDate === eventDate && (t.round ?? 1) === round);
    // GET /assignment と同じ判定を使う（ずれると画面は編集可なのに保存で 409 になる）。
    // 残骸の卓は下の upsert/delete で必ず上書きされる。
    if (isAssignmentLocked(day.awaitingAssignment === true, existing)) {
      return { status: 409 as const, error: "この半荘は申告が始まっているため変更できません" };
    }

    const newLabels = new Set(tables.map((t) => t.label));
    // 新しい編成に無いラベルの既存卓は削除
    for (const t of existing) {
      if (!newLabels.has(t.tableLabel ?? "")) tx.delete(db.collection("mahjongTables").doc(t.id));
    }
    // A/B 卓を upsert（reporting）
    for (const t of tables) {
      const members = t.memberIds.map((id) => {
        const p = poolMap.get(id)!;
        return { lineUserId: id, displayName: p.displayName, pictureUrl: p.pictureUrl, points: null, rank: null, reportedAt: null };
      });
      tx.set(db.collection("mahjongTables").doc(`tbl-${season.seasonId}-${eventDate}-r${round}-${t.label}`), {
        seasonId: season.seasonId,
        eventDate,
        createdBy: `gm:${userId}`,
        memberIds: t.memberIds,
        members,
        status: "reporting",
        round,
        tableLabel: t.label,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    tx.set(dayRef, {
      ...day,
      seasonId: season.seasonId,
      eventDate,
      round,
      waiting: waiting.map((id) => ({ lineUserId: id, displayName: poolMap.get(id)!.displayName, pictureUrl: poolMap.get(id)!.pictureUrl })),
      tableLabels: tables.map((t) => t.label),
      awaitingAssignment: false,
      roundAssignedAt: nowIso,
      roundAssignedBy: userId,
      lastSwap: null,
      updatedAt: nowIso,
    });

    return { status: 200 as const, round };
  });

  if (result.status !== 200) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // 確定した半荘は dayState 由来（トランザクションが返した値）。
  const round = result.round;

  await writeAuditLog({
    eventType: "day.manual_assigned",
    actor: userId,
    target: { date: eventDate },
    meta: { round, tables: tables.map((t) => ({ label: t.label, count: t.memberIds.length })), waiting: waiting.length },
  });

  return NextResponse.json({ success: true, round });
}
