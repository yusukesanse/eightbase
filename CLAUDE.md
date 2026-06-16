# 開発規約・メモ（EIGHTBASE）

## UI 規約

### カレンダー／日時入力は必ず自作コンポーネントを使う
ネイティブの `<input type="date">` / `<input type="time">` / `<input type="datetime-local">` は**使用禁止**。
OS依存のカレンダーUIになり、デザインがバラつくため。必ず以下の自作コンポーネントを使う:

- 日付: `src/components/ui/DatePicker.tsx` … `<DatePicker value onChange placeholder />`
- 時刻: `src/components/ui/TimePicker.tsx`
- 日時: `src/components/ui/DateTimePicker.tsx`

新規画面・既存画面の修正時もこの規約に従うこと。

## ブランチ運用
- `develop` で作業 → 確認後 `main` に反映（fast-forward）。
- 本番は `main`（Vercel 本番デプロイ）。

## 麻雀リーグ（現行仕様の要点）
- シーズンは**種目別**（`Season.gameCategory`）。麻雀の処理は `getActiveSeason("mahjong")`。
- リーグ戦: 参加表明 → 管理者が卓組み(自動) → 各自スコア申告(ミニアプリ) → 通算アベレージで順位 → 月次でリーグ確定(M1/M2/M3)。
- スコアは利用者がミニアプリで申告。管理画面は確認・修正のみ。
- CS（チャンピオンシップ）: **誰でも参加可**。リーグ上位はシード権で有利になるだけ（出場制限なし）。
- 日程の種別は**リーグ戦のみ**（CSは麻雀CSタブで個別管理）。
- 配色: M1=マゼンタ #E4007F / M2=シアン #00A0E9 / M3=イエロー(表示用 #F5B400)。ピラミッドは3D(正面・Three.js)。
