"use client";
import GameCsAdminPage from "@/components/admin/mahjongCs/GameCsAdminPage";
import { MAHJONG_CS_RULES } from "@/lib/gameCsRules";

// シーズンのCS一覧と選択した大会の管理画面を表示する。
export default function SeasonMahjongCsPage() {
  return <GameCsAdminPage rules={MAHJONG_CS_RULES} />;
}
