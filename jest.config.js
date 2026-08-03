/**
 * ts-jest has been a devDependency with no config behind it, so the first
 * `.test.ts` anyone wrote would have failed to parse. Wired up 2026-08-02
 * alongside the CI workflow.
 *
 * passWithNoTests: the suite is currently empty and `npm test` exited 1 on
 * that alone, which would have made CI red from its first run.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  passWithNoTests: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
