"use client";
import GameCsAdminPage from "@/components/admin/mahjongCs/GameCsAdminPage";
import { BILLIARDS_CS_RULES } from "@/lib/gameCsRules";

// シーズンのCS一覧と選択した大会の管理画面を表示する（麻雀と同じ画面・ビリヤードのルール）。
export default function SeasonBilliardsCsPage() {
  return <GameCsAdminPage rules={BILLIARDS_CS_RULES} />;
}
