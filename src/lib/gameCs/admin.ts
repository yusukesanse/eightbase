/**
 * CS（管理者向け）の一覧・作成・詳細・変更・削除の本体。種目の違いは GameCsRules で受ける。
 * 麻雀の /api/admin/mahjong/cs から移したもの。データの形・文言・監査ログは麻雀と同じに保つ。
 */
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { getActiveSeason } from "@/lib/mahjong";
import { isProduction } from "@/lib/env";
import { jstDateFromIso } from "@/lib/date";
import { writeAuditLog, type AuditEventType } from "@/lib/auditLog";
import { isIsoWithOffset, isManualCs, rebalanceEntries, closeEntriesIfDue, entrantsFromEntries } from "@/lib/mahjongCsEntry";
import { auditLazyClose, ensureCsClosed } from "@/lib/mahjongCsServer";
import { validateBracket, buildRunningRounds, validAdvance } from "@/lib/mahjongCsBracket";
import { canvasToRounds } from "@/lib/mahjongCsCanvas";
import { fetchPriorityUserIds, leagueStanding } from "@/lib/gameCsLeague";
import { resolveProfile } from "@/lib/gameCs/entry";
import type { GameCsRules } from "@/lib/gameCsRules";
import type { MahjongCsEvent, MahjongCsEntry, MahjongCsRound, MahjongCsCanvas } from "@/types";

type Ctx = { params: Promise<{ csEventId: string }> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const capacityBelowPriority = (rules: GameCsRules, n: number) =>
  `定員が優先枠（${rules.tierLabels[0]}・${rules.tierLabels[1]} の ${n} 名）より少なくなっています`;

/** GET /api/admin/{game}/cs?seasonId= — CSイベント一覧（新しい順） */
export async function handleAdminCsList(req: NextRequest, rules: GameCsRules): Promise<NextResponse> {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const activeSeasonId = (await getActiveSeason(rules.game))?.seasonId ?? null;
    const seasonId = req.nextUrl.searchParams.get("seasonId") || activeSeasonId;
    if (!seasonId) {
      return NextResponse.json({ events: [], seasonId: null, activeSeasonId, priorityPreviewCount: 0 });
    }
    const snap = await getDb()
      .collection(rules.collection)
      .where("seasonId", "==", seasonId)
      .get();
    const events = snap.docs
      .map((d) => ({ ...(d.data() as MahjongCsEvent), csEventId: d.id }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    // 受付締切を過ぎた新方式の CS は参加者を確定する
    const closed = await Promise.all(events.map((e) => ensureCsClosed(e, rules.collection)));
    const priorityPreviewCount = (await fetchPriorityUserIds(rules.game, seasonId)).length;
    return NextResponse.json({ events: closed, seasonId, activeSeasonId, priorityPreviewCount });
  } catch (error) {
    console.error(`[admin/${rules.game}/cs] GET error:`, error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** POST /api/admin/{game}/cs — 定員と受付期間を指定して作成する。 */
export async function handleAdminCsCreate(req: NextRequest, rules: GameCsRules): Promise<NextResponse> {
  const admin = await checkAdminAuth(req);
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => null);
    const { name, eventDate, capacity, entryOpensAt, entryClosesAt } = body ?? {};
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name は必須です" }, { status: 400 });
    }
    if (typeof eventDate !== "string" || !DATE_RE.test(eventDate)) {
      return NextResponse.json({ error: "eventDate が不正です" }, { status: 400 });
    }
    if (!Number.isInteger(capacity) || capacity < 4 || capacity > 200) {
      return NextResponse.json({ error: "定員は4〜200の整数にしてください" }, { status: 400 });
    }
    if (!isIsoWithOffset(entryOpensAt) || !isIsoWithOffset(entryClosesAt)
      || Date.parse(entryClosesAt) <= Date.parse(entryOpensAt)) {
      return NextResponse.json({ error: "受付期間が不正です" }, { status: 400 });
    }
    if (eventDate < jstDateFromIso(entryClosesAt)) {
      return NextResponse.json({ error: "開催日は参加受付の締切日以降にしてください" }, { status: 400 });
    }
    const season = await getActiveSeason(rules.game);
    if (!season) return NextResponse.json({ error: "アクティブなシーズンがありません" }, { status: 400 });
    const db = getDb();
    const existing = await db.collection(rules.collection).where("seasonId", "==", season.seasonId).get();
    if (existing.docs.some((doc) => {
      const event = doc.data() as MahjongCsEvent;
      return isManualCs(event) && event.status !== "finished";
    })) {
      return NextResponse.json(
        { error: "進行中のCSがあります。終了するか削除してから作成してください" }, { status: 409 },
      );
    }
    const priorityUserIds = await fetchPriorityUserIds(rules.game, season.seasonId);
    if (capacity < priorityUserIds.length) {
      return NextResponse.json({ error: capacityBelowPriority(rules, priorityUserIds.length) }, { status: 400 });
    }
    const now = new Date().toISOString();
    const event: Omit<MahjongCsEvent, "csEventId"> = {
      seasonId: season.seasonId, name: name.trim(), eventDate, status: "entry",
      capacity, entryOpensAt, entryClosesAt, priorityUserIds, entries: [], entrants: [], rounds: [],
      createdAt: now, updatedAt: now,
    };
    const ref = db.collection(rules.collection).doc();
    await ref.set(event);
    await writeAuditLog({ eventType: "cs.created", actor: admin, target: { date: eventDate },
      afterStatus: "entry", meta: { csEventId: ref.id } });
    return NextResponse.json({ event: { ...event, csEventId: ref.id } }, { status: 201 });
  } catch (error) {
    console.error(`[admin/${rules.game}/cs] POST error:`, error);
    return NextResponse.json({ error: "作成に失敗しました" }, { status: 500 });
  }
}

/** GET /api/admin/{game}/cs/[csEventId] — CSイベント詳細 */
export async function handleAdminCsGet(req: NextRequest, { params }: Ctx, rules: GameCsRules): Promise<NextResponse> {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const doc = await getDb().collection(rules.collection).doc(csEventId).get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    }
    const event = await ensureCsClosed({ ...(doc.data() as MahjongCsEvent), csEventId: doc.id }, rules.collection);
    return NextResponse.json({ event });
  } catch (error) {
    console.error(`[admin/${rules.game}/cs/:id] GET error:`, error);
    return NextResponse.json({ error: "取得に失敗しました" }, { status: 500 });
  }
}

/** 下書きの構造と重複だけを検証し、接続や空席の検証は確定時に行う。 */
function isBracketCanvas(value: unknown, maxSeats: number): value is MahjongCsCanvas {
  const record = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);
  if (!record(value) || !Array.isArray(value.tables) || value.tables.length > 200) return false;
  const tableIds = new Set<string>();
  const playerTables = new Map<string, string>();
  for (const table of value.tables) {
    if (!record(table) || typeof table.id !== "string" || table.id.length < 1 || table.id.length > 64
      || (table.name !== undefined && (typeof table.name !== "string" || table.name.trim().length < 1 || table.name.trim().length > 20))
      || tableIds.has(table.id)
      || typeof table.x !== "number" || !(Math.abs(table.x) <= 1e6)
      || typeof table.y !== "number" || !(Math.abs(table.y) <= 1e6)
      || typeof table.advanceCount !== "number" || !validAdvance(table.advanceCount)
      || (table.to !== null && (typeof table.to !== "string" || table.to.length > 64))
      || !Array.isArray(table.playerIds) || table.playerIds.length > maxSeats
      || !table.playerIds.every((id): id is string => typeof id === "string")) return false;
    tableIds.add(table.id);
    for (const id of table.playerIds) {
      if (playerTables.has(id)) return false;
      playerTables.set(id, table.id);
    }
  }
  return true;
}

function normalizeCanvas(canvas: MahjongCsCanvas): MahjongCsCanvas {
  return { tables: canvas.tables.map(({ id, name, x, y, advanceCount, to, playerIds }) =>
    ({ id, ...(name !== undefined ? { name: name.trim() } : {}), x, y, advanceCount, to, playerIds: [...playerIds] })) };
}

const DEMO_SELF = { lineUserId: "dev-member-01", displayName: "demoユーザー" };

/** PATCH /api/admin/{game}/cs/[csEventId] — 受付・編成を action ごとに更新する。 */
export async function handleAdminCsPatch(req: NextRequest, { params }: Ctx, rules: GameCsRules): Promise<NextResponse> {
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
      updateEntry: ["entry"], closeNow: ["entry"], removeEntry: ["entry", "closed"], addEntry: ["entry", "closed"],
      saveBracket: ["closed"], confirmBracket: ["closed"], fillDummies: ["entry"],
    };
    if (typeof action !== "string" || !Object.hasOwn(allowedStatuses, action)) {
      return NextResponse.json({ error: "action が不正です" }, { status: 400 });
    }
    const db = getDb();
    const ref = db.collection(rules.collection).doc(csEventId);
    // 管理者の追加: 受付期間・参加資格は見ない（定員は守る）。利用者の照合と名前・段の解決は transaction の外で行う。
    let added: Pick<MahjongCsEntry, "displayName" | "pictureUrl" | "tier" | "rank"> | undefined;
    if (action === "addEntry") {
      const id = body.lineUserId;
      if (typeof id !== "string" || !id.trim()) {
        return NextResponse.json({ error: "lineUserId が不正です" }, { status: 400 });
      }
      const authSnap = await db.collection("authorizedUsers")
        .where("lineUserId", "==", id).where("active", "==", true).limit(1).get();
      if (authSnap.empty) return NextResponse.json({ error: "利用者が見つかりません" }, { status: 404 });
      const pre = await ref.get();
      if (!pre.exists) return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
      const [profile, standing] = await Promise.all([
        resolveProfile(id),
        leagueStanding(rules.game, (pre.data() as MahjongCsEvent).seasonId, id),
      ]);
      // users に名前が無い人（ゲスト等）は authorizedUsers の名前を使う（addGameEntryByAdmin と同じ順）。
      const authName = authSnap.docs[0].data().displayName;
      const displayName = profile.displayName !== "ユーザー" ? profile.displayName
        : (typeof authName === "string" && authName) || "ユーザー";
      added = { ...profile, displayName, ...standing };
    }
    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { status: 404 as const, error: "CSが見つかりません", lazyClosed: false as const };
      const event = { ...(doc.data() as MahjongCsEvent), csEventId };
      if (!isManualCs(event)) return { status: 409 as const, error: "旧形式のCSは変更できません", lazyClosed: false as const };
      const beforeStatus = event.status;
      // 未登録の参加者への削除要求では、遅延締切も保存しない。
      if (action === "removeEntry" && typeof body.lineUserId === "string" && body.lineUserId.trim()
        && !(event.entries ?? []).some((entry) => entry.lineUserId === body.lineUserId)) {
        return { status: 404 as const, error: "参加者が見つかりません", lazyClosed: false as const };
      }
      const now = new Date().toISOString();
      const change = closeEntriesIfDue(event, now);
      const lazyClosed = change !== null;
      const closeUpdate = { ...change, updatedAt: now };
      const update: Partial<MahjongCsEvent> = { ...closeUpdate };
      if (change) Object.assign(event, closeUpdate);
      const lazyCloseEvent = { ...event };
      const reject = (status: 400 | 409, error: string, errors?: string[]) => {
        if (lazyClosed) tx.update(ref, closeUpdate);
        return { status, error, errors, lazyClosed, lazyCloseEvent };
      };
      if (!allowedStatuses[action].includes(event.status) && !(action === "closeNow" && lazyClosed)) {
        return reject(409, "現在の状態ではこの操作はできません");
      }
      let audit: AuditEventType | undefined;
      let addedBefore: "none" | "confirmed" | undefined;
      const capacity = event.capacity!;
      const priorityUserIds = event.priorityUserIds ?? [];
      // 締切後に参加確定者が変わったら、シードを保って entrants を作り直す。
      const entrantsKeepingSeeds = (entries: MahjongCsEntry[]) => {
        const seeds = new Set(event.entrants.filter((e) => e.seed).map((e) => e.lineUserId));
        return entrantsFromEntries(entries).map((e) => ({ ...e, seed: seeds.has(e.lineUserId) }));
      };
      switch (action) {
        case "updateEntry": {
          const nextCapacity = body.capacity === undefined ? capacity : body.capacity;
          const entryOpensAt = body.entryOpensAt === undefined ? event.entryOpensAt : body.entryOpensAt;
          const entryClosesAt = body.entryClosesAt === undefined ? event.entryClosesAt : body.entryClosesAt;
          if (!Number.isInteger(nextCapacity) || nextCapacity < 4 || nextCapacity > 200) {
            return reject(400, "定員は4〜200の整数にしてください");
          }
          if (nextCapacity < priorityUserIds.length) {
            return reject(400, capacityBelowPriority(rules, priorityUserIds.length));
          }
          if (!isIsoWithOffset(entryOpensAt) || !isIsoWithOffset(entryClosesAt)
            || Date.parse(entryClosesAt) <= Date.parse(entryOpensAt)) {
            return reject(400, "受付期間が不正です");
          }
          if (event.eventDate < jstDateFromIso(entryClosesAt)) {
            return reject(400, "開催日は参加受付の締切日以降にしてください");
          }
          Object.assign(update, { capacity: nextCapacity, entryOpensAt, entryClosesAt,
            entries: rebalanceEntries(event.entries ?? [], { capacity: nextCapacity, priorityUserIds, phase: "entry" }) });
          break;
        }
        case "closeNow":
          Object.assign(update, closeEntriesIfDue({ ...event, entryClosesAt: now }, now), { entryClosesAt: now });
          if (event.entryOpensAt && Date.parse(now) < Date.parse(event.entryOpensAt)) {
            update.entryOpensAt = now;
          }
          audit = "cs.entryClosed";
          break;
        case "removeEntry": {
          const id = body.lineUserId;
          if (typeof id !== "string" || !id.trim()) return reject(400, "lineUserId が不正です");
          audit = "cs.entryRemoved";
          update.entries = rebalanceEntries((event.entries ?? []).filter((e) => e.lineUserId !== id), {
            capacity, priorityUserIds, phase: event.status === "entry" ? "entry" : "closed",
          });
          if (event.status === "closed") {
            update.entrants = entrantsKeepingSeeds(update.entries);
            if (event.bracket) update.bracket = {
              seedUserIds: event.bracket.seedUserIds.filter((seed) => seed !== id),
              ...(event.bracket.canvas ? { canvas: normalizeCanvas({
                tables: event.bracket.canvas.tables.map((table) => ({
                  ...table, playerIds: table.playerIds.filter((playerId) => playerId !== id),
                })),
              }) } : {}),
              rounds: event.bracket.rounds.map((r) => ({ ...r, matches: r.matches.map((m) => ({
                ...m, seats: (m.seats ?? []).map((s) => s?.kind === "player" && s.lineUserId === id ? null : s),
              })) })),
            };
          }
          break;
        }
        case "addEntry": {
          const id: string = body.lineUserId;
          const entries = event.entries ?? [];
          const existing = entries.find((e) => e.lineUserId === id);
          const next = rebalanceEntries(existing
            ? entries.map((e) => (e.lineUserId === id ? { ...e, adminAdded: true } : e))
            : [...entries, { lineUserId: id, ...added!, enteredAt: now, state: "confirmed", adminAdded: true }], {
            capacity, priorityUserIds, phase: event.status === "entry" ? "entry" : "closed",
          });
          // 定員は守る: 本人が確定にならない、または確定していた人が押し出されるなら追加しない。
          const confirmedNow = new Set(next.filter((e) => e.state === "confirmed").map((e) => e.lineUserId));
          if (!confirmedNow.has(id) || entries.some((e) => e.state === "confirmed" && !confirmedNow.has(e.lineUserId))) {
            return reject(409, "定員に達しているため追加できません");
          }
          addedBefore = existing ? "confirmed" : "none";
          audit = "cs.entryAdded";
          update.entries = next;
          // bracket は触らない。追加された人は未配置の人として編成画面に出る。
          if (event.status === "closed") update.entrants = entrantsKeepingSeeds(update.entries);
          break;
        }
        case "saveBracket":
        case "confirmBracket": {
          const { canvas } = body;
          const seedUserIds = Array.isArray(body.seedUserIds) ? [...new Set<unknown>(body.seedUserIds)] : null;
          if (!seedUserIds || !seedUserIds.every((id): id is string => typeof id === "string")
            || !isBracketCanvas(canvas, rules.maxSeats)) return reject(400, "編成の形式が不正です");
          const entrantIds = event.entrants.map((e) => e.lineUserId);
          if (seedUserIds.some((id) => !entrantIds.includes(id))) {
            return reject(400, "参加確定者ではない人がシードに含まれています");
          }
          if (canvas.tables.some((table) => table.playerIds.some((id) => !entrantIds.includes(id)))) {
            return reject(400, "参加確定者ではない人が入っています");
          }
          const normalized = normalizeCanvas(canvas);
          let rounds: MahjongCsRound[] = [];
          if (action === "confirmBracket") {
            const converted = canvasToRounds(normalized.tables, rules);
            if (converted.errors.length) return reject(400, "編成に不備があります", converted.errors);
            rounds = converted.rounds;
            const errors = validateBracket(rounds, entrantIds, rules);
            if (errors.length) return reject(400, "編成に不備があります", errors);
            update.entrants = event.entrants.map((e) => ({ ...e, seed: seedUserIds.includes(e.lineUserId) }));
            update.rounds = buildRunningRounds(rounds, update.entrants);
            update.status = "running";
            audit = "cs.bracketConfirmed";
          }
          update.bracket = { seedUserIds, canvas: normalized, rounds };
          break;
        }
        case "fillDummies": {
          const entries = [...(event.entries ?? [])];
          const ids = new Set(entries.map((e) => e.lineUserId));
          // demo の簡易ログイン利用者（/api/dev/quick-login の member）も入れて、点数入力を試せるようにする。
          if (!ids.has(DEMO_SELF.lineUserId) && entries.length < capacity) {
            entries.push({ ...DEMO_SELF, tier: rules.tierLabels[2], rank: 100000, enteredAt: new Date().toISOString(), state: "confirmed" });
            ids.add(DEMO_SELF.lineUserId);
          }
          for (let i = 1; entries.length < capacity; i++) {
            const lineUserId = `demo_cs_${i}`;
            if (ids.has(lineUserId)) continue;
            entries.push({ lineUserId, displayName: `ダミー${i}`, tier: rules.tierLabels[2], rank: 100000,
              enteredAt: new Date(Date.now() + i).toISOString(), state: "confirmed", demoDummy: true });
            ids.add(lineUserId);
          }
          update.entries = rebalanceEntries(entries, { capacity, priorityUserIds, phase: "entry" });
          update.demoDummy = true;
          break;
        }
      }
      tx.update(ref, update);
      const updated = { ...event, ...update };
      return { status: 200 as const, event: updated, beforeStatus, audit, addedBefore, lazyClosed, lazyCloseEvent };
    });
    if (result.lazyClosed && !(action === "closeNow" && result.status === 200)) {
      await auditLazyClose(result.lazyCloseEvent);
    }
    if (result.status !== 200) {
      return NextResponse.json({ error: result.error, ...("errors" in result && result.errors ? { errors: result.errors } : {}) }, { status: result.status });
    }
    if (result.audit) await writeAuditLog({ eventType: result.audit, actor: admin,
      target: { date: result.event.eventDate,
        ...(result.audit === "cs.entryRemoved" || result.audit === "cs.entryAdded" ? { lineUserId: body.lineUserId } : {}) },
      beforeStatus: result.beforeStatus, afterStatus: result.event.status,
      meta: { csEventId,
        ...(result.audit === "cs.entryRemoved" ? { lineUserId: body.lineUserId, phase: result.beforeStatus } : {}),
        ...(result.audit === "cs.entryAdded"
          ? { lineUserId: body.lineUserId, phase: result.event.status, before: result.addedBefore } : {}) } });
    return NextResponse.json({ event: result.event });
  } catch (error) {
    console.error(`[admin/${rules.game}/cs/:id] PATCH error:`, error);
    return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
  }
}

/** DELETE /api/admin/{game}/cs/[csEventId] — CS削除（旧形式も削除できる） */
export async function handleAdminCsDelete(req: NextRequest, { params }: Ctx, rules: GameCsRules): Promise<NextResponse> {
  const admin = await checkAdminAuth(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const ref = getDb().collection(rules.collection).doc(csEventId);
    const snap = await ref.get();
    const event = snap.data() as MahjongCsEvent | undefined;
    await ref.delete();
    if (event) {
      await writeAuditLog({
        eventType: "cs.deleted", actor: admin, target: {}, meta: { csEventId, status: event.status },
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[admin/${rules.game}/cs/:id] DELETE error:`, error);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
}
