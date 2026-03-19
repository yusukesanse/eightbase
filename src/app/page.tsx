import { redirect } from "next/navigation";

// ホームは施設予約へリダイレクト
export default function HomePage() {
  redirect("/reservation");
}
