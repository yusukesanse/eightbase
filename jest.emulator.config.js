// Firestore Emulator 統合テスト専用の jest 設定。
// 通常の `npm test`（jest.config.js）とは testMatch を分離し、__tests__/integration のみを対象にする。
// 実行は必ず `npm run test:emulator`（firebase emulators:exec 経由で FIRESTORE_EMULATOR_HOST を設定）。
/** @type {import('jest').Config} */
module.exports = {
  displayName: "eightbase-emulator",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.emulator.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  testMatch: ["<rootDir>/__tests__/integration/**/*.test.ts"],
  testTimeout: 30000,
};
