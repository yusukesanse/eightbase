# 開発検証専用コード（develop 専用 / main へ入れない）

EIGHTBASE の「開発検証だけで使う機能」を一箇所に集約し、本番（main）へ混入させないための運用メモ。

対象機能:

1. **LINE非連携ログイン**（URLごと固定ロールの自動ログイン）
2. **麻雀デモ進行補完**（当日デモ卓の申告→半荘成立→次半荘の自動生成）
3. **CSデモ進行**（トーナメントの勝敗を1人で入力→自動で次ラウンド／優勝確定）
4. **デモデータ投入**（管理アプリからダミー参加者・卓・CS を投入/削除）

---

## 1. 二重の安全装置（まず前提）

**開発検証コードは、たとえ main に紛れても本番では動かない**ように多層で守られている:

- すべての分岐は `isProduction()` / `isDevLoginEnabled()`（= `!isProduction()`）で囲む。本番（`NEXT_PUBLIC_APP_ENV=production`）では常に無効。
- dev 専用 API は先頭で本番 `404`（`/api/dev/*`・`/api/mahjong/cs/match`・`/api/admin/games/demo-data`）。
- `scripts/check-env.mjs` が本番ビルドの環境不整合を検出してビルドを止める。

→ この分離作業は「**本番の挙動を守る**」ためではなく（それは上記で担保済み）、**コードの見通しと混入事故の防止**が目的。

## 2. ファイルの置き場所

### `src/dev-only/`（ロジックはここに集約）
| ファイル | 役割 |
|---|---|
| `src/dev-only/demoSeed.ts` | 実シーズンへダミー参加者/順位/当日卓/CS を投入・削除 |
| `src/dev-only/devSeed.ts` | 麻雀ゲームデータ一式の投入（`/api/dev/seed`） |
| `src/dev-only/mahjongDemo.ts` | 当日デモ卓の自動補完＋次半荘生成（純関数） |

### Next.js のルーティング上ここに置くしかない dev 専用の入口（`src/app/…`）
これらは**丸ごと dev 専用**（本番 404）。ファイル単位で main から除外してよい:
- `src/app/api/dev/quick-login/route.ts` … 固定ロールの実セッション発行
- `src/app/api/dev/seed/route.ts` … 麻雀データ投入
- `src/app/api/mahjong/cs/match/route.ts` … CSデモの勝敗入力
- `src/app/api/admin/games/demo-data/route.ts` … ダミー投入/削除 API
- `src/app/admin/games/demo-data/page.tsx` … ダミー投入/削除 管理UI

### 本体ファイルに残る「呼び出し口」（最小限・`DEV-ONLY` マーカー付き）
本番フローと同じファイルに、ガード付きで数行だけ残っている。main へ持ち込む場合はこの行を外す:
- `src/app/page.tsx` … 非本番のみ固定ロール自動ログイン
- `src/components/AuthGuard.tsx` … `loginPath()` の dev 分岐（未認証→`/`）
- `src/components/mahjong/MahjongCsView.tsx` … デモCSの結果入力UI
- `src/app/api/mahjong/tables/[tableId]/report/route.ts` … デモ卓の自動補完呼び出し

> 補足: `src/lib/env.ts`（`isDevLoginEnabled`）・`src/lib/liff.ts`（開発スタブ）は本番でも import される共通基盤なので dev-only には移さない。分岐は `isProduction()` で無効化される。

## 3. 全部を一覧する（grep）

```sh
# 呼び出し口・入口をまとめて確認
grep -rn "DEV-ONLY\|develop 専用" src/
```

`DEV-ONLY` マーカーが「main へ入れない箇所」の唯一の目印。新しく dev 専用コードを足すときは
必ず `src/dev-only/` に置くか、`DEV-ONLY` マーカーを付けること。

## 4. main への反映手順（gitignore は使えない点に注意）

`.gitignore` は**ブランチ別にトラッキング済みファイルを除外できない**（develop で追跡しているファイルは
main でも追跡対象になる）。しかも `src/dev-only/` は demo 環境のビルド/デプロイに必要なので、
gitignore で無視するのは不可（develop からも消えてしまう）。したがって運用で担保する:

**develop → main を反映するときのチェックリスト**
1. `git checkout main`
2. 本番に必要なコミットだけを取り込む（cherry-pick 推奨。develop 全体を merge しない）。
3. 取り込み後に次を実行し、dev 専用が入っていないことを確認:
   ```sh
   git ls-files src/dev-only        # → 何も出ないこと
   grep -rn "DEV-ONLY" src/         # → 何も出ないこと
   git grep -n "dev-only/"          # → import が残っていないこと
   ```
4. もし呼び出し口（第2節の本体ファイル）を取り込んだ場合は、`DEV-ONLY` マーカー行を外してから commit。
5. `npx tsc --noEmit` が通ることを確認。

> 現状の運用（[dev-workflow] メモ）は「develop で作業 → 確認後 main へ **FF/cherry-pick は都度判断**」。
> 本ドキュメントの手順で「dev-only が main に乗っていないこと」を毎回確認する。
