"use client";
import GameCsAdminPage from "@/components/admin/mahjongCs/GameCsAdminPage";
import { DARTS_CS_RULES } from "@/lib/gameCsRules";

// シーズンのCS一覧と選択した大会の管理画面を表示する（麻雀と同じ画面・ダーツのルール）。
export default function SeasonDartsCsPage() {
  return <GameCsAdminPage rules={DARTS_CS_RULES} />;
}
