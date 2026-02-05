// Jest config for Stryker mutation testing
// Inherits from base config with mutation-testing specific overrides
import baseConfig from './jest.config.js';

export default {
  ...baseConfig,
  // Use Stryker-compatible jsdom environment for perTest coverage analysis
  testEnvironment: './jest-stryker-env.cjs',
  // Disable coverage thresholds for mutation testing (Stryker handles this)
  coverageThreshold: undefined,
  // Reduce verbosity for faster mutation runs
  verbose: false,
  silent: true,
  // Faster test timeout for mutation testing (default 5000 is too slow for timeout-based mutants)
  testTimeout: 10000,
  // Exclude legacy 6408-line api.test.js to prevent Stryker timeouts
  // The focused API test files (api-fetch-core, api-users, api-entries, etc.) cover the same code
  testPathIgnorePatterns: [
    ...(baseConfig.testPathIgnorePatterns || []),
    'api\\.test\\.js$'
  ]
};
