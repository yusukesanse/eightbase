/**
 * ダーツリーグ 当日進行（GM）の状態機械。要件: docs/games/darts/ダーツ-ルール草案.md §2.5〜§2.6・§3。
 *
 * 麻雀は「半荘ローテーション」だが、ダーツは **3 種目を順に進める直線状態機械**
 * （①ゼロワン → ②カウントアップ → ③クリケット）。チーム編成はクリケットのみ。
 * 状態は dartsDayState/{seasonId}_{eventDate} の単一 doc に集約（＝唯一の真実）。
 *
 * - GM「ゲーム開始」で dayState を作成＋受付締切（entryClosedAt）。参加者＝その時点の paid+staff で確定。
 * - ①はGMが種別選択（zeroOneVariant）→ 各自申告、②は各自申告、③はGMが編成 → チーム申告。
 * - 各種目は**参加者全員（全チーム）が自己申告 → GM が全員のスコアを確認し「確定」→ 次の種目へ**。
 *   自動確定はしない（GM の confirmDartsEvent が唯一の確定・前進の入口）。GM は確定後も修正可。
 * - 「本日終了」で3種目の順位ポイントを合算し、参加者ごとに scores を書く（既存ランキングに乗る）。
 * - 順位・ポイントは保存せず reports から都度算出（GM 修正時の陳腐化を防ぐ）。
 *
 * Firestore 読み取り節約: エントリー取得は where(seasonId==).where(eventDate==) の等値2条件。
 */

import { getDb } from "@/lib/firebaseAdmin";
import { deriveStatus } from "@/lib/dartsEntryStatus";
import { isDangerousObjectKey } from "@/lib/dartsEntryValidation";
import { isScheduledDartsDate } from "@/lib/dartsSchedule";
import { validateCricketTeams } from "@/lib/dartsAssign";
import { computeEventPoints, computeCricketPoints, rankDay } from "@/lib/dartsScore";
import {
  DARTS_EVENT_ORDER,
  DARTS_HIGHER_IS_BETTER,
  DARTS_MIN_PARTICIPANTS,
  DARTS_ENTRY_FEE,
  type DartsEntry,
  type DartsEventKind,
  type DartsEventState,
  type DartsDayState,
  type DartsDayMember,
  type DartsTeam,
  type DartsZeroOneVariant,
  type DartsEventResult,
  type DartsScoreDetails,
} from "@/types/darts";

const dartsDayId = (seasonId: string, eventDate: string) => `${seasonId}_${eventDate}`;

/** 当日の状態を取得（未開始なら null）。 */
export async function getDartsDayState(
  seasonId: string,
  eventDate: string
): Promise<DartsDayState | null> {
  const snap = await getDb().collection("dartsDayState").doc(dartsDayId(seasonId, eventDate)).get();
  return snap.exists ? (snap.data() as DartsDayState) : null;
}

/** この開催日の受付（参加表明・支払い）が締め切られているか＝GM が「ゲーム開始」を押したか。 */
export function isDartsEntryClosed(day: DartsDayState | null): boolean {
  return !!day?.entryClosedAt;
}

/**
 * 決済成立時に「通常 paid」か「返金待ち」かを判定する純関数（complete API 用・テスト可能）。
 * - 中止済み → 返金待ち
 * - entry が消えている（中止で削除された）→ 返金待ち
 * - 受付締切後で、開始時の確定参加者に含まれない（＝締切後に決済した人）→ 返金待ち
 * - それ以外 → 通常 paid
 */
export function classifyDartsCompletion(args: {
  cancelled: boolean;
  closed: boolean;
  isConfirmedParticipant: boolean;
  entryExists: boolean;
}): "paid" | "refundPending" {
  if (args.cancelled) return "refundPending";
  if (!args.entryExists) return "refundPending";
  if (args.closed && !args.isConfirmedParticipant) return "refundPending";
  return "paid";
}

/** エントリー doc 群から支払い済み参加者を FIFO（enteredAt 昇順）で抽出。 */
function paidParticipantsFromDocs(
  docs: FirebaseFirestore.QueryDocumentSnapshot[]
): DartsDayMember[] {
  return docs
    .map((d) => ({ ...(d.data() as DartsEntry), entryId: d.id }))
    .filter((e) => deriveStatus(e) === "paid")
    .sort((a, b) => a.enteredAt.localeCompare(b.enteredAt))
    .map((e) => ({ lineUserId: e.lineUserId, displayName: e.displayName, pictureUrl: e.pictureUrl }));
}

/** 支払い済み参加者（staff は POST 時点で paid）。enteredAt 昇順 FIFO。 */
export async function fetchDartsParticipants(
  seasonId: string,
  eventDate: string
): Promise<DartsDayMember[]> {
  const snap = await getDb()
    .collection("dartsEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate)
    .get();
  return paidParticipantsFromDocs(snap.docs);
}

/** DARTS_EVENT_ORDER 順の3種目を pending で初期化。 */
function buildInitialEvents(): DartsEventState[] {
  return DARTS_EVENT_ORDER.map((kind) => ({ kind, status: "pending" as const, reports: {} }));
}

function findEvent(day: DartsDayState, kind: DartsEventKind): DartsEventState | undefined {
  return day.events.find((e) => e.kind === kind);
}

// ─── 種目結果の算出（reports → rank/points。GET/finish 共用） ─────────────────

/** 参加者/チーム単位の算出結果（lineUserId 付き・dayState には保存しない）。 */
export interface DartsEventComputedResult {
  lineUserId: string;
  value: number | null;
  rank: number | null;
  points: number;
  teamId?: string;
}

/** 1種目の申告から順位ポイントを算出（個人＝残り点/合計点、クリケット＝チーム帯平均）。 */
export function computeDartsEventResults(
  day: DartsDayState,
  ev: DartsEventState
): DartsEventComputedResult[] {
  if (ev.kind === "cricket") {
    const teams = (day.cricketTeams ?? []).map((t) => ({
      teamId: t.teamId,
      points: ev.reports[t.teamId]?.value ?? null,
      memberIds: t.memberIds,
    }));
    const mps = computeCricketPoints(teams);
    return mps.map((m) => ({
      lineUserId: m.id,
      value: teams.find((t) => t.teamId === m.teamId)?.points ?? null,
      rank: m.teamRank,
      points: m.points,
      teamId: m.teamId,
    }));
  }

  const inputs = day.participants.map((p) => ({
    id: p.lineUserId,
    value: ev.reports[p.lineUserId]?.value ?? null,
  }));
  const pts = computeEventPoints(inputs, DARTS_HIGHER_IS_BETTER[ev.kind]);
  return day.participants.map((p) => {
    const r = pts.find((x) => x.id === p.lineUserId);
    return {
      lineUserId: p.lineUserId,
      value: ev.reports[p.lineUserId]?.value ?? null,
      rank: r?.rank ?? null,
      points: r?.points ?? 0,
    };
  });
}

/** その種目の申告が全員（全チーム）分揃っているか＝自動確定の条件。 */
function isEventFullyReported(day: DartsDayState, ev: DartsEventState): boolean {
  if (ev.kind === "cricket") {
    const teams = day.cricketTeams ?? [];
    if (teams.length === 0) return false;
    return teams.every((t) => ev.reports[t.teamId] !== undefined);
  }
  if (day.participants.length === 0) return false;
  return day.participants.every((p) => ev.reports[p.lineUserId] !== undefined);
}

// ─── GM: ゲーム開始（＝受付締切・参加者確定） ────────────────────────────────

export type StartResult =
  | { ok: true; already: boolean; paidCount: number }
  | { ok: false; error: string; paidCount: number };

/**
 * GM の「ゲーム開始」。dayState を作成し受付を締め切る。参加者＝その時点の paid+staff で確定。
 * - スケジュール登録済み・未中止の開催日のみ。支払い済みが4名未満なら開始しない。
 * - 冪等: すでに開始済みなら {ok:true, already:true}。
 */
export async function startDartsDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<StartResult> {
  const db = getDb();

  // スケジュール実在は管理登録の静的データ（レース対象外）なので tx 前に確認。
  if (!(await isScheduledDartsDate(seasonId, eventDate))) {
    return { ok: false, error: "開催日ではありません", paidCount: 0 };
  }

  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));
  const cancelRef = db.collection("dartsCancelledDates").doc(eventDate);
  const entriesQuery = db
    .collection("dartsEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate);

  // 参加者確定・締切打刻・中止判定を1トランザクションに閉じ、参加表明/中止と直列化する。
  // （entries POST は同じ entriesQuery 範囲・dayRef を tx 内で読むため、悲観ロックで競合が直列化される）
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    const cancelSnap = await tx.get(cancelRef);
    const entriesSnap = await tx.get(entriesQuery);

    if (cancelSnap.exists) {
      return { ok: false as const, error: "この開催日は中止されました", paidCount: 0 };
    }

    const participants = paidParticipantsFromDocs(entriesSnap.docs);

    // 既に開始済みなら冪等成功（participants は開始時に確定した dayState を正とする）。
    if (snap.exists && (snap.data() as DartsDayState).entryClosedAt) {
      const fixed = (snap.data() as DartsDayState).participants ?? participants;
      return { ok: true as const, already: true, paidCount: fixed.length };
    }
    if (participants.length < DARTS_MIN_PARTICIPANTS) {
      return {
        ok: false as const,
        error: `支払い済みが${DARTS_MIN_PARTICIPANTS}名以上必要です`,
        paidCount: participants.length,
      };
    }
    const now = new Date().toISOString();
    const day: DartsDayState = {
      seasonId,
      eventDate,
      participants,
      entryClosedAt: now,
      startedBy: gmUserId,
      zeroOneVariant: null,
      cricketTeams: null,
      events: buildInitialEvents(),
      finishedAt: null,
      finishedBy: null,
      updatedAt: now,
    };
    tx.set(dayRef, day);
    return { ok: true as const, already: false, paidCount: participants.length };
  });
}

// ─── GM: ゼロワン種別の選択（申告の前提） ────────────────────────────────────

export type DayMutationResult =
  | { ok: true; already?: boolean }
  | { ok: false; status: number; error: string };

/** GM がゼロワンの元数・アウト条件を選択 → ゼロワンを申告受付（reporting）へ。 */
export async function setZeroOneVariant(
  seasonId: string,
  eventDate: string,
  variant: DartsZeroOneVariant
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as DartsDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了済みです" };
    const zeroOne = findEvent(day, "zeroOne");
    if (!zeroOne) return { ok: false as const, status: 400, error: "ゼロワンがありません" };
    if (zeroOne.status === "confirmed") {
      return { ok: false as const, status: 409, error: "ゼロワンは確定済みのため種別を変更できません" };
    }
    // 種別が変わったら、前の元数で入れた途中申告は前提が崩れるので破棄する
    // （例: 301で残り250を申告 → 101へ変更 → 250は不正なので消す）。
    const prev = day.zeroOneVariant;
    const changed = !prev || prev.start !== variant.start || prev.out !== variant.out;
    if (changed) zeroOne.reports = {};
    zeroOne.status = "reporting";
    day.zeroOneVariant = variant;
    day.updatedAt = new Date().toISOString();
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── GM: クリケットのチーム編成（申告の前提） ────────────────────────────────

/** GM が2人1組を編成 → クリケットを申告受付（reporting）へ。カウントアップ確定が前提。 */
export async function assignCricketTeams(
  seasonId: string,
  eventDate: string,
  teams: DartsTeam[]
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as DartsDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了済みです" };

    const countUp = findEvent(day, "countUp");
    if (!countUp || countUp.status !== "confirmed") {
      return { ok: false as const, status: 409, error: "先にカウントアップを終えてください" };
    }
    const cricket = findEvent(day, "cricket");
    if (!cricket) return { ok: false as const, status: 400, error: "クリケットがありません" };
    if (cricket.status === "confirmed") {
      return { ok: false as const, status: 409, error: "クリケットは確定済みです" };
    }

    const cleaned = teams
      .map((t) => ({ teamId: t.teamId, memberIds: t.memberIds.filter(Boolean) }))
      .filter((t) => t.memberIds.length > 0);
    const check = validateCricketTeams(
      day.participants.map((p) => p.lineUserId),
      cleaned
    );
    if (!check.ok) return { ok: false as const, status: 400, error: check.error };

    day.cricketTeams = cleaned;
    cricket.reports = {}; // 再編成時は旧チームの申告を破棄
    cricket.status = "reporting";
    day.updatedAt = new Date().toISOString();
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── 申告（自己申告 / GM 代理・修正） ────────────────────────────────────────

/**
 * スコア申告。個人種目は本人（キー=lineUserId）、クリケットは当該チームのメンバー（キー=teamId）。
 * GM は targetUserId 指定で代理入力／確定後の修正が可能。
 * 申告は**保存のみ**。確定（→次の種目へ）は GM の confirmDartsEvent に集約する（自動確定は廃止）。
 */
export async function reportDartsScore(
  seasonId: string,
  eventDate: string,
  actorId: string,
  kind: DartsEventKind,
  value: number | null,
  opts: { isGm: boolean; targetUserId?: string }
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as DartsDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了済みです" };

    const ev = findEvent(day, kind);
    if (!ev) return { ok: false as const, status: 400, error: "種目が不正です" };
    if (ev.status === "pending") {
      return { ok: false as const, status: 409, error: "この種目はまだ受付していません" };
    }
    if (ev.status === "confirmed" && !opts.isGm) {
      return { ok: false as const, status: 409, error: "この種目は確定済みです" };
    }

    // 申告キーの決定と権限チェック。
    let key: string;
    if (kind === "cricket") {
      const teams = day.cricketTeams ?? [];
      if (opts.isGm && opts.targetUserId) {
        // GM はチーム所属者を指定してそのチームへ入れる。
        const team = teams.find((t) => t.memberIds.includes(opts.targetUserId!));
        if (!team) return { ok: false as const, status: 400, error: "対象がチームに所属していません" };
        key = team.teamId;
      } else {
        const team = teams.find((t) => t.memberIds.includes(actorId));
        if (!team) return { ok: false as const, status: 403, error: "あなたはこのチームの申告者ではありません" };
        key = team.teamId;
      }
    } else {
      const targetId = opts.isGm && opts.targetUserId ? opts.targetUserId : actorId;
      if (!opts.isGm && opts.targetUserId && opts.targetUserId !== actorId) {
        return { ok: false as const, status: 403, error: "他の人の代理申告はできません" };
      }
      if (!day.participants.some((p) => p.lineUserId === targetId)) {
        return { ok: false as const, status: 403, error: "参加者ではありません" };
      }
      key = targetId;
    }

    // プロトタイプ汚染・特殊プロパティ防止（key は teamId or lineUserId）。
    if (isDangerousObjectKey(key)) {
      return { ok: false as const, status: 400, error: "申告キーが不正です" };
    }
    // 申告は保存のみ。確定（status→confirmed・次の種目の受付開始）は GM の confirmDartsEvent に集約する。
    ev.reports[key] = { value, reportedAt: new Date().toISOString() };
    day.updatedAt = new Date().toISOString();
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── GM: 種目の確定（全員申告済み → 確定 → 次の種目へ） ──────────────────────

/**
 * GM の「確定」。参加者全員（全チーム）が申告済みの種目を確定し、次の種目を受付へ進める。
 * - 前提: 対象種目が reporting かつ全員申告済み。未申告が残る間は確定できない（409）。
 * - ゼロワン確定 → カウントアップを受付（reporting）へ。カウントアップ確定 → クリケットは GM 編成待ち（pending）。
 * - 冪等: すでに confirmed なら {ok:true, already:true}。終了済みは 409。
 */
export async function confirmDartsEvent(
  seasonId: string,
  eventDate: string,
  kind: DartsEventKind
): Promise<DayMutationResult> {
  const db = getDb();
  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as DartsDayState;
    if (day.finishedAt) return { ok: false as const, status: 409, error: "本日は終了済みです" };

    const ev = findEvent(day, kind);
    if (!ev) return { ok: false as const, status: 400, error: "種目が不正です" };
    if (ev.status === "confirmed") return { ok: true as const, already: true };
    if (ev.status !== "reporting") {
      return { ok: false as const, status: 409, error: "この種目はまだ受付していません" };
    }
    if (!isEventFullyReported(day, ev)) {
      return { ok: false as const, status: 409, error: "全員の申告が揃っていません" };
    }

    ev.status = "confirmed";
    if (kind === "zeroOne") {
      const countUp = findEvent(day, "countUp");
      if (countUp && countUp.status === "pending") countUp.status = "reporting";
    }
    // countUp 確定 → クリケットは GM 編成待ち（pending のまま）。cricket 確定 →「本日終了」で集計。
    day.updatedAt = new Date().toISOString();
    tx.set(dayRef, day);
    return { ok: true as const };
  });
}

// ─── GM: 本日終了（3種目合算 → scores 書き込み） ─────────────────────────────

export type FinishResult =
  | { ok: true; already: boolean; participantCount: number }
  | { ok: false; status: number; error: string };

/** 参加者ごとの3種目結果・合計・当日順位を算出（純粋・テスト可能）。 */
export function computeDartsDayScores(day: DartsDayState): {
  lineUserId: string;
  totalScore: number;
  details: DartsScoreDetails;
}[] {
  // 種目ごとの算出結果を lineUserId で引けるよう Map 化。
  const byEvent = new Map<DartsEventKind, Map<string, DartsEventComputedResult>>();
  for (const ev of day.events) {
    const m = new Map<string, DartsEventComputedResult>();
    for (const r of computeDartsEventResults(day, ev)) m.set(r.lineUserId, r);
    byEvent.set(ev.kind, m);
  }

  const perPlayer = day.participants.map((p) => {
    const events: DartsEventResult[] = DARTS_EVENT_ORDER.map((kind) => {
      const r = byEvent.get(kind)?.get(p.lineUserId);
      return {
        kind,
        value: r?.value ?? null,
        rank: r?.rank ?? null,
        points: r?.points ?? 0,
        ...(r?.teamId ? { teamId: r.teamId } : {}),
      };
    });
    const totalScore = events.reduce((s, e) => s + e.points, 0);
    const ranks = events.map((e) => e.rank);
    return { lineUserId: p.lineUserId, events, totalScore, ranks };
  });

  const dayRanks = rankDay(
    perPlayer.map((p) => ({ id: p.lineUserId, total: p.totalScore, ranks: p.ranks }))
  );
  const rankMap = new Map(dayRanks.map((d) => [d.id, d]));

  return perPlayer.map((p) => {
    const dr = rankMap.get(p.lineUserId);
    return {
      lineUserId: p.lineUserId,
      totalScore: p.totalScore,
      details: {
        events: p.events,
        dayRank: dr?.dayRank ?? 0,
        firstCount: dr?.firstCount ?? 0,
      },
    };
  });
}

/**
 * GM の「本日終了」。3種目すべて確定済みが前提。順位ポイントを合算し scores を書く。
 * 決定的 docId で upsert（再 finish 冪等）。games doc も軽量作成（scoreboard 整合・将来の管理編集用）。
 */
export async function finishDartsDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<FinishResult> {
  const db = getDb();
  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(dayRef);
    if (!snap.exists) return { ok: false as const, status: 400, error: "まだ開始していません" };
    const day = snap.data() as DartsDayState;
    if (day.finishedAt) {
      return { ok: true as const, already: true, participantCount: day.participants.length };
    }
    if (!day.events.every((e) => e.status === "confirmed")) {
      return { ok: false as const, status: 409, error: "まだ確定していない種目があります" };
    }

    const now = new Date().toISOString();
    const gameId = `darts-${seasonId}-${eventDate}`;
    const yearMonth = eventDate.slice(0, 7);
    const scores = computeDartsDayScores(day);

    // games doc（軽量・冪等）。
    tx.set(
      db.collection("games").doc(gameId),
      {
        gameId,
        gameCategory: "darts",
        seasonId,
        eventDate,
        title: `ダーツリーグ ${eventDate}`,
        startAt: eventDate,
        scoreRegistered: true,
        updatedAt: now,
      },
      { merge: true }
    );

    // 参加者ごとに scores を決定的 docId で upsert。
    // displayName/pictureUrl を非正規化して持たせる（ランキングは users join に依存せず自己完結）。
    const memberById = new Map(day.participants.map((p) => [p.lineUserId, p]));
    for (const s of scores) {
      const m = memberById.get(s.lineUserId);
      tx.set(
        db.collection("scores").doc(`${gameId}-${s.lineUserId}`),
        {
          gameId,
          gameCategory: "darts",
          lineUserId: s.lineUserId,
          displayName: m?.displayName ?? "",
          pictureUrl: m?.pictureUrl ?? "",
          seasonId,
          yearMonth,
          totalScore: s.totalScore,
          details: s.details,
          playedAt: eventDate,
          recordedBy: `gm:${gmUserId}`,
          createdAt: now,
        },
        { merge: true }
      );
    }

    tx.update(dayRef, { finishedAt: now, finishedBy: gmUserId, updatedAt: now });
    return { ok: true as const, already: false, participantCount: scores.length };
  });
}

// ─── GM: 中止（流会）＝返金対象化 ───────────────────────────────────────────

export type DartsCancelResult =
  | { status: "already" }
  | { status: "finished" }
  | { status: "forfeited"; paidCount: number; refundCount: number };

/**
 * 開催日を中止（流会）。支払い済みは返金待ち（cancelRequested）にし、管理者へ一括依頼を通知。
 * 自動返金はしない（Square で手動）。冪等（dartsCancelledDates の create をガード）。
 * 終了済みの日は中止できない（finished）。中止すると dayState は破棄する。
 */
export async function cancelDartsDay(
  seasonId: string,
  eventDate: string,
  gmUserId: string
): Promise<DartsCancelResult> {
  const db = getDb();
  const cancelRef = db.collection("dartsCancelledDates").doc(eventDate);
  const dayRef = db.collection("dartsDayState").doc(dartsDayId(seasonId, eventDate));
  const entriesQuery = db
    .collection("dartsEntries")
    .where("seasonId", "==", seasonId)
    .where("eventDate", "==", eventDate);
  const month = eventDate.slice(0, 7);

  // 中止確定・返金対象化・ロック解放・状態破棄・管理者通知（永続doc）を1トランザクションで原子的に。
  // - finishedAt 検知を tx 内に置き「本日終了」との競合を防ぐ（batch では防げなかった）。
  // - cancelRef 存在チェックも tx 内なので二重中止は冪等成功。
  // - 通知（adminNotifications doc）も同 tx で作るので、中止と通知が「両方 or どちらも無し」＝返金対象を失わない。
  // - 対象は当日エントリー(≤定員)のみなので tx の書き込み上限に収まる。外部API呼び出しは行わない。
  return db.runTransaction(async (tx) => {
    const cancelSnap = await tx.get(cancelRef);
    if (cancelSnap.exists) return { status: "already" as const };

    const daySnap = await tx.get(dayRef);
    if (daySnap.exists && (daySnap.data() as DartsDayState).finishedAt) {
      return { status: "finished" as const };
    }

    const entriesSnap = await tx.get(entriesQuery);
    const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as DartsEntry) }));
    const seated = entries.filter((e) => deriveStatus(e) === "paid"); // 支払い済み（staff含む）
    const reserved = entries.filter((e) => deriveStatus(e) === "reserved");
    const refundable = seated.filter((e) => !!e.paymentTransactionId); // staff は免除＝対象外
    // 決済リンク発行済み（in-flight）の reserved は **削除しない**。
    // orderId は entry にしか無く、削除すると後から成立した決済を complete が照合できず取りこぼすため、
    // entry を残して complete 側で返金待ちに回す（cancelRef があるので paid にはならない）。
    const reservedToDelete = reserved.filter((e) => !e.paymentTransactionId);

    const nowIso = new Date().toISOString();

    // 書き込み（全ての読み取りの後）。
    tx.create(cancelRef, {
      seasonId,
      eventDate,
      reason: "manual",
      paidCount: seated.length,
      decidedAt: nowIso,
      decidedBy: gmUserId,
    });
    for (const e of refundable) {
      tx.set(
        db.collection("dartsEntries").doc(e.id),
        {
          status: "cancelRequested",
          paymentStatus: "cancelRequested",
          cancelReason: "forfeit",
          cancelRequestedAt: nowIso,
          updatedAt: nowIso,
        },
        { merge: true }
      );
    }
    for (const e of reservedToDelete) tx.delete(db.collection("dartsEntries").doc(e.id));
    // 月ロックは全員解放（in-flight reserved も枠を返す。決済成立時は complete が返金待ちにする）。
    for (const e of [...seated, ...reserved]) {
      tx.delete(db.collection("dartsMonthlyLocks").doc(`${seasonId}_${e.lineUserId}_${month}`));
    }
    if (daySnap.exists) tx.delete(dayRef); // 進行中の状態を破棄

    // 管理者通知を永続doc として同 tx で作成（通知の取りこぼしを防ぐ）。
    tx.create(db.collection("adminNotifications").doc(), {
      type: "darts_event_forfeit",
      message: `${eventDate} は中止（流会）。返金対象 ${refundable.length}名（Squareで手動返金）。`,
      data: {
        eventDate,
        paidCount: seated.length,
        refundCount: refundable.length,
        refunds: refundable.map((e) => ({
          entryId: e.id,
          displayName: e.displayName,
          amount: e.paymentAmount ?? DARTS_ENTRY_FEE,
          orderId: e.paymentTransactionId ?? null,
        })),
      },
      read: false,
      createdAt: nowIso,
    });

    return { status: "forfeited" as const, paidCount: seated.length, refundCount: refundable.length };
  });
}
