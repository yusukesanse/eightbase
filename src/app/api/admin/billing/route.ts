import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import { GAME_PAYMENT_CONFIG } from "@/lib/gameEntryPayment";
import { todayJst } from "@/lib/date";
import {
  applyOrderPaymentIds,
  applyOrderRefundFlags,
  BILLING_GAMES,
  billingDate,
  gameEntryToBilling,
  isBillingSource,
  isWithinRange,
  jstDayEndIso,
  jstDayStartIso,
  monthRange,
  reservationToBilling,
  resolveSquareUrl,
  sortBillingRecords,
  summarizeBilling,
  yearRange,
  type BillingBasis,
  type BillingRecord,
  type BillingSource,
  type GameEntryDoc,
  type ReservationDoc,
  type SquareEnvName,
  type SquareOrderFlags,
} from "@/lib/billing";
import { getFacilitySquareStatusMap } from "@/lib/facilitySecrets";
import type { ScoreboardGameId, Season } from "@/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/billing
 * 請求（入金）一覧＋集計。施設予約（トレーラー等）とゲーム参加費を1つの軸で返す。
 *
 * Query:
 *   mode=month|year|season   期間の指定方法（既定 month）
 *   month=YYYY-MM            mode=month のとき（既定 今月 JST）
 *   year=YYYY                mode=year のとき
 *   seasonId=...             mode=season のとき（そのシーズンの参加費だけを対象にする）
 *   basis=use|paid           集計基準（既定 use＝利用日/開催日。paid＝入金日）
 *   source=all|reservation|mahjong|darts|billiards|poker
 *
 * ⚠️ 期間を必ず絞ってからクエリする（全コレクションスキャンをさせない）。
 *    範囲は単一フィールドの不等号だけで組み、複合インデックスを増やさない
 *    （seasonId・種別・ステータスの絞り込みはメモリ側で行う）。
 */

interface RangeSpec {
  from: string;
  to: string;
  seasonId: string | null;
  label: string;
}

async function resolveRange(req: NextRequest): Promise<RangeSpec | { error: string }> {
  const q = req.nextUrl.searchParams;
  const mode = q.get("mode") ?? "month";

  if (mode === "season") {
    const seasonId = q.get("seasonId") ?? "";
    if (!/^[A-Za-z0-9_-]+$/.test(seasonId)) return { error: "seasonId が不正です" };
    const snap = await getDb().collection("seasons").doc(seasonId).get();
    if (!snap.exists) return { error: "シーズンが見つかりません" };
    const s = snap.data() as Season;
    return {
      from: s.startDate || "1970-01-01",
      to: s.endDate || "2999-12-31",
      seasonId,
      label: s.name || seasonId,
    };
  }

  if (mode === "year") {
    const year = q.get("year") ?? todayJst().slice(0, 4);
    if (!/^\d{4}$/.test(year)) return { error: "year が不正です" };
    return { ...yearRange(year), seasonId: null, label: `${year}年` };
  }

  const month = q.get("month") ?? todayJst().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "month が不正です" };
  return { ...monthRange(month), seasonId: null, label: month };
}

/** 同じコレクションへの複数クエリを doc.id でマージする（重複取得を1件に潰す）。 */
async function mergeQueries(
  queries: FirebaseFirestore.Query[],
): Promise<{ id: string; data: FirebaseFirestore.DocumentData }[]> {
  const snaps = await Promise.all(queries.map((qq) => qq.get()));
  const map = new Map<string, FirebaseFirestore.DocumentData>();
  for (const snap of snaps) for (const d of snap.docs) map.set(d.id, d.data());
  return Array.from(map, ([id, data]) => ({ id, data }));
}

/**
 * 取得結果。`envById` は「Square を開くURL」をどのドメイン（本番/サンドボックス）で
 * 組み立てるかの対応表。URL は決済IDが確定してから作るので、ここでは環境だけ返す。
 */
interface FetchResult {
  records: BillingRecord[];
  envById: Map<string, SquareEnvName>;
}

async function fetchGameRecords(
  game: ScoreboardGameId,
  range: RangeSpec,
  basis: BillingBasis,
  now: string,
): Promise<FetchResult> {
  const cfg = GAME_PAYMENT_CONFIG[game];
  const col = getDb().collection(cfg.entries);

  const queries: FirebaseFirestore.Query[] = range.seasonId
    ? // シーズン指定は等値1条件で足りる（開催日はシーズン期間に収まる）。
      [col.where("seasonId", "==", range.seasonId)]
    : [col.where("eventDate", ">=", range.from).where("eventDate", "<=", range.to)];

  // 入金日基準のときは「開催日は範囲外だが入金がこの期間」も拾う。
  if (!range.seasonId && basis === "paid") {
    queries.push(
      col.where("paidAt", ">=", jstDayStartIso(range.from)).where("paidAt", "<=", jstDayEndIso(range.to)),
    );
  }

  const docs = await mergeQueries(queries);
  // 種目ごとの Square 環境（SQUARE_{GAME}_ENVIRONMENT ＞ SQUARE_ENVIRONMENT）。
  // 参加費は施設と違い環境変数だけで決まるので追加の読み取りは不要。
  const env: SquareEnvName =
    (process.env[`SQUARE_${game.toUpperCase()}_ENVIRONMENT`] ?? process.env.SQUARE_ENVIRONMENT) ===
    "production"
      ? "production"
      : "sandbox";

  const records = docs.map((d) =>
    gameEntryToBilling(game, d.id, d.data as GameEntryDoc, cfg.fee, now),
  );
  return { records, envById: new Map(records.map((r) => [r.id, env])) };
}

async function fetchReservationRecords(
  range: RangeSpec,
  basis: BillingBasis,
  now: string,
): Promise<FetchResult> {
  const db = getDb();
  const col = db.collection("reservations");

  const queries: FirebaseFirestore.Query[] = [
    col.where("date", ">=", range.from).where("date", "<=", range.to),
  ];
  if (basis === "paid") {
    // 予約の入金日は paidAt（新しいデータ）。旧データは createdAt/updatedAt で代用するため、
    // 決済は仮押さえ(createdAt)から15分以内という前提で createdAt にも範囲をかけて拾う。
    queries.push(
      col.where("paidAt", ">=", jstDayStartIso(range.from)).where("paidAt", "<=", jstDayEndIso(range.to)),
      col.where("createdAt", ">=", jstDayStartIso(range.from)).where("createdAt", "<=", jstDayEndIso(range.to)),
    );
  }

  const docs = await mergeQueries(queries);

  // 表示名は予約docに無いので users から引く（必要なユーザーだけ getAll＝全件スキャンしない）。
  const ids = Array.from(new Set(docs.map((d) => (d.data as ReservationDoc).lineUserId).filter(Boolean))) as string[];
  const nameById = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const refs = ids.slice(i, i + 200).map((id) => db.collection("users").doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      const name = (s.data() as { displayName?: string } | undefined)?.displayName;
      if (name) nameById.set(s.id, name);
    }
  }

  const records = docs
    .map((d) => {
      const doc = d.data as ReservationDoc & { facilityId?: string };
      const rec = reservationToBilling(d.id, doc, nameById.get(doc.lineUserId ?? "") ?? "", now);
      return rec ? { rec, facilityId: doc.facilityId ?? "" } : null;
    })
    .filter((v): v is { rec: BillingRecord; facilityId: string } => v !== null);

  // Square を開くURLは環境（本番/サンドボックス）でドメインが違う。
  // 施設ごとにSquare設定を持てるので、施設の環境を優先し、未設定は環境変数にフォールバックする。
  const envDefault: SquareEnvName =
    process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
  const facilityIds = Array.from(new Set(records.map((v) => v.facilityId).filter(Boolean)));
  const statusMap = facilityIds.length > 0 ? await getFacilitySquareStatusMap(facilityIds) : {};

  return {
    records: records.map((v) => v.rec),
    envById: new Map(
      records.map(({ rec, facilityId }) => {
        const st = statusMap[facilityId];
        return [rec.id, st?.configured ? st.environment ?? envDefault : envDefault] as const;
      }),
    ),
  };
}

/**
 * `squareOrders`（docId=orderId）から、請求管理が必要とする2つを拾う。
 *   1. 返金フラグ（refundPending / expiredRefund）＝「課金済みなのに席を渡せていない」
 *   2. 決済ID（paymentId）＝ 参加費エントリーが持っていないので、ここから補う
 *
 * 引くのは「未入金（返金フラグを見たい）」と「決済IDが未解決」のレコードの注文IDだけ。
 * 決済時に paymentId が入っている予約は読まない（全件スキャンも無駄読みもしない）。
 */
async function fetchSquareOrderInfo(records: BillingRecord[]): Promise<Map<string, SquareOrderFlags>> {
  const db = getDb();
  const ids = Array.from(
    new Set(
      records
        .filter((r) => r.orderId && (r.status === "unpaid" || !r.paymentId))
        .map((r) => r.orderId as string),
    ),
  );
  const info = new Map<string, SquareOrderFlags>();
  for (let i = 0; i < ids.length; i += 200) {
    const refs = ids.slice(i, i + 200).map((id) => db.collection("squareOrders").doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() as SquareOrderFlags;
      if (d.refundPending || d.expiredRefund || d.paymentId) {
        info.set(s.id, {
          refundPending: d.refundPending,
          expiredRefund: d.expiredRefund,
          paymentId: d.paymentId,
        });
      }
    }
  }
  return info;
}

export async function GET(req: NextRequest) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const q = req.nextUrl.searchParams;
    const basis: BillingBasis = q.get("basis") === "paid" ? "paid" : "use";
    const sourceParam = q.get("source") ?? "all";
    if (sourceParam !== "all" && !isBillingSource(sourceParam)) {
      return NextResponse.json({ error: "source が不正です" }, { status: 400 });
    }
    const source = sourceParam as BillingSource | "all";

    const range = await resolveRange(req);
    if ("error" in range) return NextResponse.json({ error: range.error }, { status: 400 });

    const now = new Date().toISOString();
    const wantGame = (g: ScoreboardGameId) => source === "all" || source === g;
    // シーズン指定はゲーム参加費だけの概念（施設予約はシーズンに属さない）。
    const wantReservation = !range.seasonId && (source === "all" || source === "reservation");

    const empty: FetchResult = { records: [], envById: new Map() };
    const results = await Promise.all([
      wantReservation ? fetchReservationRecords(range, basis, now) : Promise.resolve(empty),
      ...BILLING_GAMES.map((g) =>
        wantGame(g) ? fetchGameRecords(g, range, basis, now) : Promise.resolve(empty),
      ),
    ]);
    const envById = new Map(results.flatMap((r) => Array.from(r.envById)));

    let records = results
      .flatMap((r) => r.records)
      // 計上日（基準日）で最終的に期間へ収める。クエリは基準ごとに広めに取っているのでここで揃える。
      .filter((r) => isWithinRange(billingDate(r, basis), range.from, range.to));

    // squareOrders と1回だけ突き合わせる。
    //  - 返金フラグ … Square 側で課金が成立している「要返金」を未入金・失効に埋もれさせない
    //  - 決済ID    … 参加費は決済IDを持たないので補う（無いと Square へ辿れない）
    const orderInfo = await fetchSquareOrderInfo(records);
    records = applyOrderPaymentIds(applyOrderRefundFlags(records, orderInfo), orderInfo);

    // Square を開くURLは決済ID/レシートURLが確定してから作る（環境でドメインが変わる）。
    const envDefault: SquareEnvName =
      process.env.SQUARE_ENVIRONMENT === "production" ? "production" : "sandbox";
    records = records.map((r) => ({
      ...r,
      squareUrl: resolveSquareUrl(r, envById.get(r.id) ?? envDefault),
    }));

    // シーズン名を付ける（表示用。seasons は件数が少ないので1回読む）。
    if (records.some((r) => r.seasonId)) {
      const snap = await getDb().collection("seasons").get();
      const nameById = new Map(snap.docs.map((d) => [d.id, (d.data() as Season).name ?? d.id]));
      records = records.map((r) =>
        r.seasonId ? { ...r, seasonName: nameById.get(r.seasonId) ?? r.seasonId } : r,
      );
    }

    records = sortBillingRecords(records, basis);

    return NextResponse.json({
      range: { from: range.from, to: range.to, label: range.label },
      basis,
      records,
      summary: summarizeBilling(records),
    });
  } catch (error) {
    console.error("[admin/billing] GET error:", error);
    return NextResponse.json({ error: "請求データの取得に失敗しました" }, { status: 500 });
  }
}
