import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { FieldValue } from "firebase-admin/firestore";
import { isProduction } from "@/lib/env";
import { writeAuditLog, type AuditEventType } from "@/lib/auditLog";
import { isManualCs, rebalanceEntries, closeEntriesIfDue, entrantsFromEntries } from "@/lib/mahjongCsEntry";
import { validateBracket, buildRunningRounds } from "@/lib/mahjongCsBracket";
import type { MahjongCsEvent, MahjongCsRound } from "@/types";

export const dynamic = "force-dynamic";

/** GET /api/admin/mahjong/cs/[csEventId] — CSイベント詳細 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const doc = await getDb().collection("mahjongCsEvents").doc(csEventId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    }
    return NextResponse.json({ event: { ...(doc.data() as MahjongCsEvent), csEventId: doc.id } });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id] GET error:", error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** 下書きでは空席や未配置を許し、保存できる構造だけを確認する。 */
function isBracketRounds(value: unknown): value is MahjongCsRound[] {
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  return Array.isArray(value) && value.every((r) => record(r)
    && ["prelim", "semi", "final"].includes(r.type as string)
    && typeof r.label === "string" && typeof r.advanceCount === "number"
    && Array.isArray(r.matches) && r.matches.every((m) => record(m)
      && typeof m.matchId === "string" && typeof m.label === "string"
      && Array.isArray(m.players) && ["reporting", "completed"].includes(m.status as string)
      && Array.isArray(m.seats) && m.seats.length === 4
      && m.seats.every((s) => s === null || (record(s)
        && ((s.kind === "player" && typeof s.lineUserId === "string")
          || (s.kind === "ticket" && typeof s.fromMatchId === "string" && typeof s.place === "number"))))));
}

/** PATCH /api/admin/mahjong/cs/[csEventId] — 受付・編成を action ごとに更新する。 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { csEventId } = await params;
    const body = await req.json().catch(() => null);
    const action = body?.action;
    if (action === "fillDummies" && isProduction()) {
      return NextResponse.json({ error: "Not Found" }, { status: 404 });
    }
    const allowedStatuses: Record<string, MahjongCsEvent["status"][]> = {
      updateEntry: ["entry"], closeNow: ["entry"], removeEntry: ["entry", "closed"],
      saveBracket: ["closed"], confirmBracket: ["closed"], reopenBracket: ["running"], fillDummies: ["entry"],
    };
    if (typeof action !== "string" || !Object.hasOwn(allowedStatuses, action)) {
      return NextResponse.json({ error: "action が不正です" }, { status: 400 });
    }
    const db = getDb();
    const ref = db.collection("mahjongCsEvents").doc(csEventId);
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません" };
      const event = { ...(doc.data() as MahjongCsEvent), csEventId };
      if (!isManualCs(event)) return { status: 409 as const, error: "旧形式のCSは変更できません" };
      if (!allowedStatuses[action].includes(event.status)) {
        return { status: 409 as const, error: "現在の状態ではこの操作はできません" };
      }
      const now = new Date().toISOString();
      const update: Partial<MahjongCsEvent> = { updatedAt: now };
      let audit: AuditEventType | undefined;
      const capacity = event.capacity!;
      const priorityUserIds = event.priorityUserIds ?? [];
      switch (action) {
        case "updateEntry": {
          const nextCapacity = body.capacity === undefined ? capacity : body.capacity;
          const entryOpensAt = body.entryOpensAt === undefined ? event.entryOpensAt : body.entryOpensAt;
          const entryClosesAt = body.entryClosesAt === undefined ? event.entryClosesAt : body.entryClosesAt;
          if (!Number.isInteger(nextCapacity) || nextCapacity < 4 || nextCapacity > 200) {
            return { status: 400 as const, error: "定員は4〜200の整数にしてください" };
          }
          if (nextCapacity < priorityUserIds.length) {
            return { status: 400 as const, error: `定員が優先枠（M1・M2 の ${priorityUserIds.length} 名）より少なくなっています` };
          }
          if (typeof entryOpensAt !== "string" || typeof entryClosesAt !== "string"
            || !Number.isFinite(Date.parse(entryOpensAt)) || !Number.isFinite(Date.parse(entryClosesAt))
            || Date.parse(entryClosesAt) <= Date.parse(entryOpensAt)) {
            return { status: 400 as const, error: "受付期間が不正です" };
          }
          Object.assign(update, { capacity: nextCapacity, entryOpensAt, entryClosesAt,
            entries: rebalanceEntries(event.entries ?? [], { capacity: nextCapacity, priorityUserIds, phase: "entry" }) });
          break;
        }
        case "closeNow":
          Object.assign(update, closeEntriesIfDue({ ...event, entryClosesAt: now }, now), { entryClosesAt: now });
          audit = "cs.entryClosed";
          break;
        case "removeEntry": {
          const id = body.lineUserId;
          if (typeof id !== "string" || !id.trim()) return { status: 400 as const, error: "lineUserId が不正です" };
          update.entries = rebalanceEntries((event.entries ?? []).filter((e) => e.lineUserId !== id), {
            capacity, priorityUserIds, phase: event.status === "entry" ? "entry" : "closed",
          });
          if (event.status === "closed") {
            const seeds = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));
            update.entrants = entrantsFromEntries(update.entries).map((e) => ({ ...e, seed: seeds.has(e.lineUserId) }));
            if (event.bracket) update.bracket = {
              seedUserIds: event.bracket.seedUserIds.filter((seed) => seed !== id),
              rounds: event.bracket.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({
                ...m, seats: (m.seats ?? []).map((s) => s?.kind === "player" && s.lineUserId === id ? null : s),
              })) })),
            };
          }
          break;
        }
        case "saveBracket":
        case "confirmBracket": {
          const { seedUserIds, rounds } = body;
          if (!Array.isArray(seedUserIds) || !seedUserIds.every((id) => typeof id === "string")
            || !isBracketRounds(rounds)) return { status: 400 as const, error: "編成の形式が不正です" };
          const entrantIds = event.entrants.map((e) => e.lineUserId);
          if (seedUserIds.some((id) => !entrantIds.includes(id))) {
            return { status: 400 as const, error: "参加確定者ではない人がシードに含まれています" };
          }
          if (action === "confirmBracket") {
            const errors = validateBracket(rounds, entrantIds);
            if (errors.length) return { status: 400 as const, error: "編成に不備があります", errors };
            update.entrants = event.entrants.map((e) => ({ ...e, seed: seedUserIds.includes(e.lineUserId) }));
            update.rounds = buildRunningRounds(rounds, update.entrants);
            update.status = "running";
            audit = "cs.bracketConfirmed";
          }
          update.bracket = { seedUserIds, rounds };
          break;
        }
        case "reopenBracket":
          update.status = "closed";
          update.rounds = [];
          audit = "cs.bracketReopened";
          break;
        case "fillDummies": {
          const entries = [...(event.entries ?? [])];
          const ids = new Set(entries.map((e) => e.lineUserId));
          for (let i = 1; entries.length < capacity; i++) {
            const lineUserId = `demo_cs_${i}`;
            if (ids.has(lineUserId)) continue;
            entries.push({ lineUserId, displayName: `ダミー${i}`, tier: "M3", rank: 100000,
              enteredAt: new Date(Date.now() + i).toISOString(), state: "confirmed", demoDummy: true });
            ids.add(lineUserId);
          }
          update.entries = rebalanceEntries(entries, { capacity, priorityUserIds, phase: "entry" });
          update.demoDummy = true;
          break;
        }
      }
      tx.update(ref, { ...update, ...(action === "reopenBracket" ? { championId: FieldValue.delete() } : {}) });
      const updated = { ...event, ...update };
      if (action === "reopenBracket") delete updated.championId;
      return { status: 200 as const, event: updated, beforeStatus: event.status, audit };
    });
    if (result.status !== 200) {
      return NextResponse.json({ error: result.error, ...(result.errors ? { errors: result.errors } : {}) }, { status: result.status });
    }
    if (result.audit) await writeAuditLog({ eventType: result.audit, actor: admin,
      target: { date: result.event.eventDate }, beforeStatus: result.beforeStatus,
      afterStatus: result.event.status, meta: { csEventId } });
    return NextResponse.json({ event: result.event });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id] PATCH error:", error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/admin/mahjong/cs/[csEventId] — CS削除 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    await getDb().collection("mahjongCsEvents").doc(csEventId).delete();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id] DELETE error:", error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
