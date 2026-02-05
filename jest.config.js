export default {
  testEnvironment: 'jsdom',
  // Transform TypeScript files with ts-jest in ESM mode
  transform: {
    '\\.ts$': ['ts-jest', {
      useESM: true
    }]
  },
  // Use custom resolver to map .js to .ts for project files
  resolver: './jest.resolver.cjs',
  testMatch: [
    '**/__tests__/**/*.test.js'
  ],
  collectCoverageFrom: [
    'js/**/*.ts',
    '!js/**/*.d.ts',
    '!js/**/*.backup.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'js/test-helpers.ts'
  ],
  moduleFileExtensions: ['js', 'ts'],
  verbose: false,
  silent: true,
  clearMocks: true,
  extensionsToTreatAsEsm: ['.ts'],
  transformIgnorePatterns: [
    '/node_modules/'
  ]
};
