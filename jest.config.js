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
  testPathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/.next/"],
  testMatch: [
    "<rootDir>/__tests__/**/*.test.{ts,tsx}",
    "<rootDir>/src/**/*.test.{ts,tsx}",
  ],
};
