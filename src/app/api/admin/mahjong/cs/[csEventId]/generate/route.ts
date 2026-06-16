import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebaseAdmin";
import { checkAdminAuth } from "@/lib/adminAuth";
import {
  generatePrelimRound,
  generateNextRound,
  generateSingleFinal,
  isRoundComplete,
} from "@/lib/mahjongCs";
import type { MahjongCsEvent } from "@/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/mahjong/cs/[csEventId]/generate
 * 次のラウンドを生成する（半自動）。
 * - ラウンドが空: 予選を生成（非シードが0人なら一発決勝）
 * - 直前ラウンドが完了済み: 次ラウンド（予選→準決→決勝）を生成
 * - 直前が未完了 or 決勝後: エラー
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ csEventId: string }> }
) {
  if (!(await checkAdminAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const { csEventId } = await params;
    const ref = getDb().collection("mahjongCsEvents").doc(csEventId);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "CSが見つかりません" }, { status: 404 });
    }
    const event = doc.data() as MahjongCsEvent;

    if (event.entrants.length < 2) {
      return NextResponse.json(
        { error: "参戦者が少なすぎます（2名以上必要）" },
        { status: 400 }
      );
    }

    const rounds = [...event.rounds];
    const seeds = event.entrants.filter((e) => e.seed);

    if (rounds.length === 0) {
      // 最初のラウンド: 予選 or 一発決勝
      if (event.entrants.length <= 4) {
        rounds.push(generateSingleFinal(event.entrants));
      } else {
        const prelim = generatePrelimRound(event.entrants);
        if (!prelim) {
          // 非シードがいない（全員M1など）→ シードのみで決勝
          rounds.push(generateSingleFinal(event.entrants));
        } else {
          rounds.push(prelim);
        }
      }
    } else {
      const last = rounds[rounds.length - 1];
      if (last.type === "final") {
        return NextResponse.json(
          { error: "決勝まで生成済みです" },
          { status: 400 }
        );
      }
      if (!isRoundComplete(last)) {
        return NextResponse.json(
          { error: `${last.label}の結果入力が未完了です` },
          { status: 400 }
        );
      }
      const next = generateNextRound(last, seeds);
      if (!next) {
        return NextResponse.json({ error: "次のラウンドがありません" }, { status: 400 });
      }
      rounds.push(next);
    }

    await ref.update({
      rounds,
      status: "running",
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true, rounds });
  } catch (error) {
    console.error("[admin/mahjong/cs/:id/generate] error:", error);
    return NextResponse.json({ error: "生成に失敗しました" }, { status: 500 });
  }
}
