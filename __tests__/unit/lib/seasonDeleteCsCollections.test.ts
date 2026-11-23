import { readFileSync } from "fs";
import { join } from "path";
import { CS_RULES } from "@/lib/gameCsRules";

// Next.js の route は定数を export できないので、ソースを読んで確かめる。
// CS の保存先を足したのにシーズン削除で消し忘れると、消したシーズンの CS が残り続ける。
test("シーズン削除で消すコレクションに、ルール表の全種目の CS が入っている", () => {
  const src = readFileSync(join(process.cwd(), "src/app/api/admin/scoreboard/seasons/[seasonId]/route.ts"), "utf8");
  const start = src.indexOf("const SEASON_LINKED_COLLECTIONS");
  expect(start).toBeGreaterThan(0);
  const list = src.slice(start, src.indexOf("] as const", start));
  for (const rules of Object.values(CS_RULES)) expect(list).toContain(`"${rules.collection}"`);
});
