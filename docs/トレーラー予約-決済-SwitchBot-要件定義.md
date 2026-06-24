# トレーラー予約：Square決済 ＋ SwitchBot時限パスワード — 要件定義

> ステータス: **要件定義（実装前）**。コード実装は未着手。
> 対象: トレーラー施設の予約に、(1) Square決済 と (2) SwitchBotキーパッドの時限解錠パスワード を組み込む。

---

## 1. 背景・目的
トレーラー予約は通常予約と違い、次の2つが必要:
1. **決済**: 予約に Square 決済（¥20,000）が必要。「予約する」を「決済する」に変え、Square決済URLへ遷移→決済後に予約完了画面へ。
2. **解錠**: 予約完了画面に SwitchBot キーパッドの**解錠パスワード**を表示。**予約ごと**に API で**時間制限式**（予約開始〜終了のみ有効）の使い捨てパスワードを発行する。管理者用の永続パスワードは別物で**触らない**。

## 2. 用語・前提
- **トレーラー施設**: `Facility` に Square決済URL と SwitchBotデバイスID が設定された施設（後述フィールドで判定）。
- **時限パスコード**: SwitchBot `createKey`(type=`timeLimit`) で発行する、開始〜終了だけ有効な使い捨てコード。予約終了で自動失効。
- **管理者パスコード**: SwitchBot 側の `permanent` キー。**本機能では生成・削除・参照しない**。

## 3. 現状（調査サマリ）
- `Facility`（`src/types/index.ts`）に `requirePayment` / `hourlyRate` はあるが、**Square URL / SwitchBotデバイスID は無い** → 追加要。トレーラー種別も無い。
- `Reservation` に `paymentId/paymentAmount/paymentStatus` はあるが未使用。**パスコード保存欄は無い** → 追加要。`status` は `confirmed|cancelled` の2値。
- 予約API（`src/app/api/reservations/route.ts`）: `requirePayment=true` は現状 **501でオンライン予約不可**。二重予約防止は Firestore transaction＋`reservationLocks`＋`intervalsOverlap()`。
- Square（`src/lib/square.ts`）: `verifySquarePayment()` / `refundSquarePayment()` 等あるが**未使用**。`/api/payments*` は 501。
- **SwitchBot 連携は皆無** → `src/lib/switchbot.ts` 新規。公式API: `createKey`/`deleteKey`、認証は `token`+`secret` の HMAC-SHA256（`sign`/`t`/`nonce` ヘッダ）。`timeLimit` は `startTime`/`endTime`（epoch ms）対応。

## 4. 確定要件（意思決定済み）
1. **決済検証**: Square 決済URLは**管理画面記入の静的URL（Square Payment Link）**。決済後リダイレクトで `transactionId` を受け取り、**Square API で取引を照合**（金額¥20,000・COMPLETED・未使用）してから予約確定。
2. **スロット確保**: 「決済する」時点で **pending予約として枠を仮押さえ**し、**未決済はTTL（例: 15分）で自動解放**。
3. **パスワード表示**: **完了画面＋マイ予約＋LINE通知**の3箇所（到着時に見返せる）。
4. **発行失敗時**: SwitchBot発行は**自動リトライ**。なお失敗なら**管理者へ通知**＋利用者に「発行中／連絡ください」案内（管理者が手動再発行可能）。

---

## 5. 全体フロー
```
[Portal] トレーラー施設を選択 → 日時選択 → 「決済する」
   │  ① pending予約を作成（枠を仮押さえ・TTL15分）／pendingReservationId を署名Cookieに保存
   ▼
[Square] 静的決済リンク（¥20,000）で決済
   │  ② 決済完了 → Square が redirect_url?transactionId=… で完了画面へ戻す
   ▼
[App] /reservation/complete（完了エンドポイント）
   │  ③ Cookieの pendingReservationId ＋ query の transactionId を取得
   │  ④ Square API で取引照合（COMPLETED / 金額一致 / 未使用）
   │     └ NG → 予約は pending のまま（TTLで解放）。エラー案内
   │  ⑤ OK → 予約を confirmed 化（paymentStatus=completed・transactionId保存・再利用防止）
   │  ⑥ SwitchBot createKey(timeLimit, 予約開始〜終了, ランダムpass) 発行（失敗時リトライ→§要件4）
   │  ⑦ 予約に passcode/keyId/expiresAt 保存
   ▼
[Portal] 完了画面に解錠パスワードを表示（＋マイ予約・LINE通知にも）
```

## 6. データモデル変更
### Facility（追加）
- `paymentProvider?: "square"`（or 既存 `requirePayment` を流用）
- `squarePaymentUrl?: string` … 管理者が用意する Square Payment Link（決済後 redirect 付き）
- `paymentAmount?: number` … 決済額（既定 ¥20,000。`hourlyRate` ではなく固定額）
- `switchBotDeviceId?: string` … トレーラーのキーパッド/ロックのデバイスID
- （判定）**`squarePaymentUrl` と `switchBotDeviceId` が設定された施設＝トレーラー扱い**（決済＋解錠フロー）。

### Reservation（追加）
- `status` に **`pending_payment`** を追加（`confirmed|cancelled|pending_payment`）。
- `pendingExpiresAt?: string` … 仮押さえの失効時刻（TTL）。
- `paymentTransactionId?: string` … Square取引ID（**再利用防止のため一意**）。
- `switchBotPasscode?: string` … 発行した時限パスワード。
- `switchBotKeyId?: number` … SwitchBotが返すキーID（`deleteKey` 用）。
- `switchBotPasscodeExpiresAt?: string` … パスコード失効（=予約終了）。
- `switchBotStatus?: "issued" | "pending" | "failed"` … 発行状態（失敗時の管理用）。

## 7. Square決済（静的URL＋API検証）
- 決済リンクは**管理者が Square で作成**し、**redirect_url を当アプリの完了エンドポイント**（例 `https://portal.eightbase.net/reservation/complete`）に設定して、その URL を管理画面に登録する。
- 完了エンドポイントは Square が付与する `transactionId`（または `orderId`）を受け取り、**Square Orders/Payments API で照合**:
  - ステータス COMPLETED / 金額 = 施設の `paymentAmount` / その取引IDが**未使用**であること。
  - 既存 `src/lib/square.ts` の `verifySquarePayment()` を流用/拡張。
- **再利用防止**: 検証済み `transactionId` を予約に保存し、同一IDの二重消費を拒否。
- env: `SQUARE_ACCESS_TOKEN` / `SQUARE_LOCATION_ID` / `SQUARE_ENVIRONMENT`（本番は production、demoは sandbox）。

## 8. SwitchBot 時限パスコード
- 新規 `src/lib/switchbot.ts`:
  - 認証ヘッダ: `Authorization: <token>` / `sign = base64(HMAC_SHA256(token+t+nonce, secret)).toUpperCase()` / `t`(13桁ms) / `nonce`(UUID)。
  - `issueTimeLimitPasscode(deviceId, {name, password, startMs, endMs})` → `POST /v1.1/devices/{deviceId}/commands` に `{command:"createKey", commandType:"command", parameter:{name, type:"timeLimit", password, startTime, endTime}}`。返り値の `id` を保存。
  - `deletePasscode(deviceId, keyId)` → `{command:"deleteKey", parameter:{id}}`。
- **パスワード生成**: 予約ごとにランダム数字（例 6桁。SwitchBotキーパッド準拠で6〜12桁）。使い回さない。
- **発行タイミング**: 決済検証OK後の**予約確定時**に発行。`startTime`=予約開始（epoch ms）、`endTime`=予約終了。未来開始でもOK。
- **失効**: 予約終了で自動失効（timeLimit）。**キャンセル時は `deleteKey` で即無効化**。
- **失敗時（要件4）**: 数回リトライ → なお失敗なら `switchBotStatus="failed"` で予約は確定のまま、**管理者通知**（LINE/メール）＋利用者へ「発行中・連絡ください」案内。管理者が手動再発行できる導線を用意。
- 管理者の `permanent` キーは**生成・削除・参照しない**（timeLimit キーのみ操作）。
- env: `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET`（グローバル）。デバイスIDは施設ごと（Firestore）。

## 9. 管理画面（施設管理）
- `src/app/admin/calendars/page.tsx` の施設編集に入力欄追加: **Square決済URL** / **決済額** / **SwitchBotデバイスID**。
- `src/app/api/admin/facilities/route.ts` の `ALLOWED_UPDATE_FIELDS` と `VALIDATION_RULES` に上記を追加（URL形式・必須長などの検証）。
- 失敗予約の**パスコード手動再発行**ボタン（管理者）も用意（§8 失敗時対応）。

## 10. Portal UI
- トレーラー施設では「予約する」を **「決済する」**ボタンに切替（`squarePaymentUrl` 有無で分岐）。
- 「決済する」→ pending予約作成 → `openExternalUrl()` 等で Square URL へ遷移（LIFF外部ブラウザ）。
- 完了画面（`/reservation/complete`）: 予約詳細＋**解錠パスワード**＋有効時間（予約開始〜終了）を表示。
- **マイ予約**（`/my-reservations`）: トレーラー予約に解錠パスワードと有効時間を表示（要ログイン）。
- **LINE通知**: 予約確定通知にパスワードと有効時間を含める。

## 11. スロット確保（pending＋TTL）
- 「決済する」時に Firestore transaction で `reservationLocks` を取り、**pending_payment** 予約を作成（`pendingExpiresAt`=now+15分）。
- **空き判定/二重予約防止**は pending も「占有」として扱うが、**`pendingExpiresAt` 超過の pending は空きとみなす**（lazy 解放）。
- **Cron**（`src/app/api/cron/*` に追加）で期限切れ pending を定期的に cancelled 化＋ロック解放（掃除）。
- 決済成功で confirmed 化（pendingExpiresAt クリア）。

## 12. キャンセル・返金
- 予約キャンセル時: `deleteKey` でパスコード無効化＋スロット解放。
- 返金は Square 側（`refundSquarePayment()` 流用可）。自動返金とするか手動かは §15 で要確認。
- Google Calendar 連携: トレーラーをカレンダー管理対象にするかは要確認（§15）。

## 13. セキュリティ
- **決済の真正性**: Square API 照合＋transactionId 再利用防止＋pendingReservationId は**署名httpOnly Cookie**で改ざん防止。
- **完了画面直叩き対策**: 完了処理は「有効な pending予約 ＋ 照合済み未使用 transactionId」が揃わない限りパスコードを出さない。
- **パスコード秘匿**: 表示は HTTPS＋ログイン必須コンテキスト（マイ予約）。LINE通知は本人宛のみ。ログ/レスポンスに不要露出しない。
- **SwitchBot権限**: timeLimitキーのみ作成/削除。permanentキーには触れない。

## 14. 環境変数（追加）
```
SQUARE_ACCESS_TOKEN= / SQUARE_LOCATION_ID= / SQUARE_ENVIRONMENT=   # 本番=production / demo=sandbox
SWITCHBOT_TOKEN= / SWITCHBOT_SECRET=                                # SwitchBot Open API
```
- 施設ごとの `squarePaymentUrl` / `switchBotDeviceId` は Firestore（管理画面）で管理（env不要）。
- demo/preview ではダミー（Square sandbox / SwitchBot はモック）。本番フラグ漏れ防止は既存 env ガードに準拠。

## 15. 未決事項・リスク
- 管理者が用意する Square URL が **Payment Link（redirect＋transactionId付与）**であること（そうでない決済URLだと API 照合の紐付けが弱くなる → その場合は「予約ごと動的リンク」へ方針変更）。
- キャンセル時の**返金**を自動化するか手動か。
- **Google Calendar** にトレーラー予約を載せるか（現状 予約APIはCalendarイベントを作る）。
- pending TTL の具体値（既定15分）。
- パスコード桁数（既定6桁）と SwitchBot デバイス側設定の整合。
- 決済中に LIFF 外部ブラウザへ出て戻る導線（セッション維持/再ログイン）の検証。
- 同一トレーラーに複数デバイス（複数キーパッド）がある場合の扱い。

## 16. 実装ブレークダウン（参考・本書では実装しない）
1. **データモデル**: Facility/Reservation のフィールド追加＋`status: pending_payment`。
2. **管理画面**: Square URL / 決済額 / SwitchBotデバイスID 入力＋検証＋許可リスト。
3. **SwitchBot lib**: `src/lib/switchbot.ts`（HMAC認証・createKey/deleteKey）。
4. **Square検証**: `square.ts` の検証を有効化（取引照合・再利用防止）。env整備。
5. **予約API改修**: pending作成（TTL・ロック）／完了エンドポイントで検証→confirmed→パスコード発行（リトライ/失敗時通知）。
6. **Cron**: 期限切れ pending の掃除。
7. **Portal UI**: 決済するボタン分岐・完了画面・マイ予約・LINE通知にパスワード。
8. **キャンセル**: deleteKey＋スロット解放（＋返金方針）。
9. **テスト**: Square sandbox／SwitchBotモックで決済・発行・二重予約・失効を検証。

> 関連: 予約の二重予約防止・決済の現行仕様は `CLAUDE.md`、環境構成は `docs/環境構築.md` を参照。
