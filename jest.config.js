/**
 * Jest configuration for OTPLUS unit and integration tests.
 * Runs in ESM mode with ts-jest, jsdom environment, and custom
 * .js-to-.ts module resolver.
 */
export default {
  // Use jsdom to simulate a browser DOM (required for UI tests that
  // access window, document, localStorage, etc.)
  testEnvironment: 'jsdom',

  // Transform TypeScript files with ts-jest in ESM mode
  transform: {
    '\\.ts$': ['ts-jest', {
      useESM: true
    }]
  },

  // Use custom resolver to map .js imports to .ts source files,
  // so TypeScript's ESM-style ".js" extension imports resolve correctly
  resolver: './jest.resolver.cjs',

  // Run shared test setup (DOM helpers, global mocks) after the
  // test framework is installed but before each test suite executes
  setupFilesAfterEnv: [
    './__tests__/helpers/global-setup.js'
  ],

  // Only discover test files inside __tests__/ directories
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],

  // Collect coverage from all TypeScript source files, excluding
  // declaration files and legacy backups
  collectCoverageFrom: [
    'js/**/*.ts',
    '!js/**/*.d.ts',
    '!js/**/*.backup.ts'
  ],

  // Enforce minimum 80% coverage across all four metrics to prevent
  // regressions in test quality
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Exclude third-party code and test-only helpers from coverage reports
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'js/test-helpers.ts'
  ],

  // Recognize both .js and .ts when resolving module imports
  moduleFileExtensions: ['js', 'ts'],

  // Suppress per-test pass/fail output and console noise to keep CI logs clean;
  // failures still print full details
  verbose: false,
  silent: true,

  // Automatically reset mocks between tests so state doesn't leak across suites
  clearMocks: true,

  // Tell Jest to treat .ts files as ESM (required for ts-jest ESM transforms)
  extensionsToTreatAsEsm: ['.ts'],

  // Skip transforming node_modules (dependencies ship pre-compiled)
  transformIgnorePatterns: [
    '/node_modules/'
  ]
};
