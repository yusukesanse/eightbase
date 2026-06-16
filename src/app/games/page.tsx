import { redirect } from "next/navigation";

/**
 * /games 単体ページは持たない。ゲーム関連は Info（ゲームタブ）に集約しているため
 * 誤アクセス時は Info にリダイレクトする（404 防止）。
 */
export default function GamesIndexPage() {
  redirect("/info");
}
