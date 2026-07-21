/**
 * Firestore Emulator 統合テスト用の安全 setup（本番Firestoreへ絶対に接続させない）。
 *
 * - `FIRESTORE_EMULATOR_HOST` が未設定なら即座に throw してテストを失敗させる
 *   （＝素の `jest` で誤って実行しても本番に触れない。必ず `npm run test:emulator` 経由）。
 * - ホストがローカル（localhost/127.0.0.1/::1）でなければ throw（リモート/本番誤接続の防止）。
 * - 実際の本番認証情報（GOOGLE_APPLICATION_CREDENTIALS 等）を無効化し、Emulator 専用の
 *   ダミー projectId を使わせる。統合テストは自前の Admin app を projectId のみで初期化する。
 */

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) {
  throw new Error(
    "[emulator-guard] FIRESTORE_EMULATOR_HOST が未設定です。" +
      "この統合テストは Firestore Emulator 上でのみ実行できます。" +
      "`npm run test:emulator` を使ってください（firebase emulators:exec が自動で設定します）。"
  );
}
if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?):\d+$/.test(host)) {
  throw new Error(
    `[emulator-guard] FIRESTORE_EMULATOR_HOST がローカルではありません: "${host}"。` +
      "本番/リモート Firestore への誤接続を防ぐため中断します。"
  );
}

// 本番の認証情報を絶対に読ませない（Emulator は projectId だけで動く）。
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.FIREBASE_CLIENT_EMAIL;
// Emulator 専用の projectId（firebase emulators:exec --project で上書きされる）。
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "eightbase-emulator-test";
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;

// eslint-disable-next-line no-console
console.log(`[emulator-guard] OK: Firestore Emulator=${host} project=${process.env.GCLOUD_PROJECT}`);
