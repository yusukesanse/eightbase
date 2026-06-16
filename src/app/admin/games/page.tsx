import { redirect } from "next/navigation";

/**
 * 旧「ゲーム管理」（単発ゲーム作成）は廃止。
 * 麻雀はシーズン＋日程＋卓組みのリーグ運用に一本化したため、
 * /admin/games はシーズン管理へリダイレクトする。
 */
export default function AdminGamesIndexPage() {
  redirect("/admin/games/seasons");
}
