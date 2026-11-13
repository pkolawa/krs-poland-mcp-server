/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Only crawl src/. Without this Jest also picks up tests from git worktrees under .claude/worktrees/,
  // which broke prepublishOnly. (testPathIgnorePatterns here would not help: test:unit overrides it on the CLI.)
  roots: ["<rootDir>/src"],
  setupFilesAfterEnv: ["<rootDir>/src/test-setup.ts"],
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "Node",
        },
      },
    ],
  },
};
