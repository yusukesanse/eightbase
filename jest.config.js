// JS設定にすることで ts-node 不要（CIでそのまま実行可能）。テストのTSは ts-jest が変換。
/** @type {import('jest').Config} */
const esModules = ["jose"].join("|");

module.exports = {
  displayName: "eight-canal-base",
  testEnvironment: "node",
  setupFiles: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
    [`node_modules/(${esModules})/.+\\.js$`]: ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  transformIgnorePatterns: [`<rootDir>/node_modules/(?!(${esModules})/)`],
  // 統合テスト（Firestore Emulator 必須）は通常の `npm test` から除外し、
  // 専用の `npm run test:emulator`（jest.emulator.config.js）でのみ実行する。
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/", "<rootDir>/__tests__/integration/"],
  testMatch: [
    "<rootDir>/__tests__/**/*.test.{ts,tsx}",
    "<rootDir>/src/**/*.test.{ts,tsx}",
  ],
};
