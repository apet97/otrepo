# Testing Guide

How to write and run tests for OTPLUS.

## Table of Contents

- [Test Organization](#test-organization)
- [Running Tests](#running-tests)
- [Jest ESM Configuration](#jest-esm-configuration)
- [Setup and Cleanup Patterns](#setup-and-cleanup-patterns)
- [Mock Data and Fixtures](#mock-data-and-fixtures)
- [How to Write a Unit Test](#how-to-write-a-unit-test)
- [How to Write an E2E Test](#how-to-write-an-e2e-test)
- [Worker Test Patterns](#worker-test-patterns)
- [Coverage Requirements](#coverage-requirements)
- [Performance Test Handling](#performance-test-handling)
- [Mutation Testing](#mutation-testing)

---

## Test Organization

```
__tests__/
├── unit/              # Jest unit tests (108 suites)
│   ├── api-core.test.js
│   ├── calc-mutation-additions.test.js
│   ├── constants.test.js
│   ├── crypto-coverage.test.js
│   ├── export.test.js
│   ├── main-load.test.js
│   ├── settings-api.test.js
│   ├── state.test.js
│   ├── ui-*.test.js
│   └── ...
├── integration/       # Jest integration tests
├── performance/       # Jest performance benchmarks
│   ├── api-performance.test.js
│   └── calc-performance.test.js
├── fixtures/          # Shared test data files
├── helpers/           # Shared test utilities
│   ├── setup.js       # standardAfterEach, standardBeforeEach, createDOMCleanup
│   ├── mock-data.js   # createMockEntry, createMockUser, etc.
│   ├── entry-builder.js
│   ├── api-test-helpers.js
│   ├── calc-test-helpers.js
│   └── global-setup.js
├── e2e/               # Playwright E2E tests (8 specs)
│   ├── helpers/       # E2E test utilities
│   ├── api-failures.spec.ts
│   ├── authentication.spec.ts
│   ├── configuration.spec.ts
│   ├── export.spec.ts
│   ├── overrides.spec.ts
│   ├── report-generation.spec.ts
│   └── security.spec.ts
└── a11y/              # Playwright accessibility tests
    └── accessibility.spec.ts

worker/src/
├── *.test.ts          # Vitest worker tests (co-located, 4 suites)
```

---

## Running Tests

### Core Commands

```bash
# Unit + integration tests (Jest)
npm test

# Watch mode
npm run test:watch

# Coverage report with thresholds
npm run test:coverage

# Performance tests only
npm run test:perf

# E2E tests (Playwright — builds app first)
npm run test:e2e

# E2E with headed browser
npm run test:e2e:headed

# E2E with Playwright UI
npm run test:e2e:ui

# Accessibility tests only
npm run test:a11y

# Worker tests (Vitest)
npm --prefix worker test

# Type checking
npm run typecheck

# Linting
npm run lint

# Format check
npm run format:check
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RUN_PERF_TESTS` | unset | Set to `true` to include performance tests in `npm test` |
| `PERF_MULTIPLIER` | `1` | Multiply timing thresholds (e.g. `7` for CI, `3` for slow machines) |
| `CI` | unset | When set, Playwright retries once and limits to 2 workers |

---

## Jest ESM Configuration

OTPLUS uses ESM throughout. Jest runs via:

```bash
node --experimental-vm-modules node_modules/jest/bin/jest.js
```

Key configuration in `jest.config.js`:

| Setting | Value | Why |
|---------|-------|-----|
| `testEnvironment` | `jsdom` | UI tests need `window`, `document`, `localStorage` |
| `transform` | `ts-jest` with `useESM: true` | Transform TypeScript as ESM |
| `resolver` | `./jest.resolver.cjs` | Maps `.js` imports to `.ts` source files |
| `extensionsToTreatAsEsm` | `['.ts']` | Tell Jest to handle `.ts` files as ESM |
| `setupFilesAfterEnv` | `global-setup.js` | Shared setup (DOM helpers, global mocks) |
| `testMatch` | `**/__tests__/**/*.test.js` | Only discover `.test.js` files |
| `clearMocks` | `true` | Auto-reset mocks between tests |

### ESM Import Convention

TypeScript source uses `.js` extensions in imports (ESM convention):

```typescript
import { store } from './state.js';  // resolves to state.ts via custom resolver
```

Test files must use the same `.js` extension pattern when importing source modules.

---

## Setup and Cleanup Patterns

From `__tests__/helpers/setup.js`:

### standardAfterEach()

Use in every test file to prevent state leakage:

```javascript
import { standardAfterEach } from '../helpers/setup.js';

afterEach(standardAfterEach);
```

Does: `jest.clearAllMocks()`, `jest.restoreAllMocks()`, `localStorage.clear()`, `sessionStorage.clear()`, reset fake timers, reset mock ID counter.

### standardBeforeEach()

Lighter weight — just clears mocks:

```javascript
import { standardBeforeEach } from '../helpers/setup.js';

beforeEach(standardBeforeEach);
```

### createDOMCleanup()

For tests that modify `document.body`:

```javascript
import { createDOMCleanup } from '../helpers/setup.js';

afterEach(createDOMCleanup());  // clears body.innerHTML + standard cleanup
```

### resetStore(store)

Resets all store properties to defaults:

```javascript
import { resetStore } from '../helpers/setup.js';

beforeEach(() => resetStore(store));
```

---

## Mock Data and Fixtures

### `__tests__/helpers/mock-data.js`

Provides factory functions with deterministic IDs:

```javascript
import { createMockEntry, createMockUser, resetMockIdCounter } from '../helpers/mock-data.js';

const user = createMockUser({ name: 'Alice' });
const entry = createMockEntry({ userId: user.id, duration: 'PT8H' });
```

### `__tests__/helpers/entry-builder.js`

Fluent builder for complex entry creation:

```javascript
import { EntryBuilder } from '../helpers/entry-builder.js';

const entry = new EntryBuilder()
  .withUser('user-1', 'Alice')
  .onDate('2026-01-15')
  .withDuration('PT9H30M')
  .billable()
  .build();
```

### `__tests__/helpers/api-test-helpers.js`

Helpers for mocking fetch responses and API behavior.

### `__tests__/helpers/calc-test-helpers.js`

Helpers for setting up calculation scenarios and verifying results.

### `__tests__/helpers/setup.js`

`createMockFetch(responseData, options)` — creates a `jest.fn()` that resolves with a fetch-like response:

```javascript
import { createMockFetch } from '../helpers/setup.js';

global.fetch = createMockFetch([{ id: '1', name: 'Alice' }], { status: 200 });
```

---

## How to Write a Unit Test

Step-by-step pattern for a new unit test:

### 1. Create the test file

```
__tests__/unit/my-feature.test.js
```

### 2. Import with .js extensions

```javascript
import { standardAfterEach, standardBeforeEach } from '../helpers/setup.js';
```

### 3. Mock ESM modules with jest.unstable_mockModule

ESM mocking must happen **before** the dynamic import:

```javascript
import { jest } from '@jest/globals';

// Mock dependencies BEFORE importing the module under test
jest.unstable_mockModule('../../js/state.js', () => ({
  store: {
    token: 'mock-token',
    claims: { workspaceId: 'ws-1', backendUrl: 'https://api.clockify.me/api' },
    config: { /* defaults */ },
    calcParams: { dailyThreshold: 8, weeklyThreshold: 40, overtimeMultiplier: 1.5, tier2ThresholdHours: 0, tier2Multiplier: 2.0 },
    users: [],
    apiStatus: { profilesFailed: 0, holidaysFailed: 0, timeOffFailed: 0 },
    ui: { isAdmin: false },
  }
}));

// Dynamic import AFTER mocking
const { myFunction } = await import('../../js/my-module.js');
```

### 4. Structure with describe/it

```javascript
describe('myFunction', () => {
  beforeEach(standardBeforeEach);
  afterEach(standardAfterEach);

  it('should return correct result for valid input', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });

  it('should handle edge case', () => {
    expect(() => myFunction(null)).toThrow();
  });
});
```

### 5. DOM testing

```javascript
import { createDOMCleanup } from '../helpers/setup.js';

afterEach(createDOMCleanup());

it('should render correctly', () => {
  document.body.innerHTML = '<div id="target"></div>';
  renderMyComponent();
  expect(document.getElementById('target').textContent).toBe('Expected');
});
```

---

## How to Write an E2E Test

Playwright E2E tests run against the built application served on `localhost:8080`.

### Test file location

```
__tests__/e2e/my-feature.spec.ts
```

### Key patterns from E2E helpers

```typescript
import { test, expect } from '@playwright/test';

test.describe('My Feature', () => {
  test('should work end-to-end', async ({ page }) => {
    // 1. Set up API mocks (intercept Clockify API calls)
    await setupApiMocks(page);

    // 2. Create a mock JWT token
    const token = createMockToken({ workspaceId: 'ws-test' });

    // 3. Bypass RSA256 signature verification for tests
    await page.addInitScript(() => {
      (window as any).__OTPLUS_SKIP_SIGNATURE_VERIFY = true;
    });

    // 4. Navigate with auth token
    await page.goto(`/?auth_token=${token}`);

    // 5. Wait for app initialization
    await waitForAppReady(page);

    // 6. Interact and assert
    await page.click('[data-testid="generate-btn"]');
    await expect(page.locator('[data-testid="results-container"]')).toBeVisible();
  });
});
```

### waitForAppReady()

Guards against false-positive success by checking both `data-app-ready="true"` and the absence of `data-app-error="true"`:

```typescript
async function waitForAppReady(page: Page): Promise<void> {
  await page.waitForSelector('body[data-app-ready="true"]');
  const hasError = await page.evaluate(() =>
    document.body.dataset.appError === 'true'
  );
  if (hasError) throw new Error('App initialized with error');
}
```

### JWT Signature Bypass

Two mechanisms available:

```typescript
// Via Playwright addInitScript (preferred)
await page.addInitScript(() => {
  (window as any).__OTPLUS_SKIP_SIGNATURE_VERIFY = true;
});

// Via DOM attribute (alternative)
await page.addInitScript(() => {
  document.documentElement.dataset.skipSignatureVerify = 'true';
});
```

Both are wrapped in `process.env.NODE_ENV !== 'production'` and stripped from production builds.

---

## Worker Test Patterns

Worker tests use Vitest (not Jest) and are co-located with source files in `worker/src/`.

### Running

```bash
npm --prefix worker test
```

### Mocking KV and Request/Response

```typescript
// Mock KV namespace
const mockKV = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
};

// Mock Request
const request = new Request('https://worker.example.com/api/config', {
  headers: { 'X-Addon-Token': mockJwt },
});

// Mock environment
const env = {
  SETTINGS_KV: mockKV,
  GITHUB_PAGES_ORIGIN: 'https://user.github.io/otplus',
  ENVIRONMENT: 'production',
};

// Test handler
const response = await handleConfigGet(request, env);
expect(response.status).toBe(200);
```

### crypto.subtle Mocking

Worker tests mock `crypto.subtle` for RSA256 verification:

```typescript
vi.stubGlobal('crypto', {
  subtle: {
    importKey: vi.fn().mockResolvedValue({}),
    verify: vi.fn().mockResolvedValue(true),
  },
});
```

---

## Coverage Requirements

Enforced in `jest.config.js`:

| Metric | Threshold |
|--------|-----------|
| Branches | 80% |
| Functions | 80% |
| Lines | 80% |
| Statements | 80% |

Run coverage report:

```bash
npm run test:coverage
```

Coverage is collected from all `js/**/*.ts` files, excluding `.d.ts` declarations and `.backup.ts` files.

---

## Performance Test Handling

Two performance test suites exist in `__tests__/performance/`:

- `api-performance.test.js` — API pagination/fetch timing
- `calc-performance.test.js` — Calculation engine benchmarks

### Known Flakes

Both suites use environment-dependent timing thresholds. They fail intermittently on slower machines or under heavy CI load. These are **not regressions**.

### Triage Protocol

1. Run targeted repro: `npm run test:perf`
2. If it passes, run full suite: `npm test`
3. If full suite fails only on perf tests, it's a flake.

### PERF_MULTIPLIER for CI

```bash
# In CI, relax thresholds 7x
PERF_MULTIPLIER=7 npm test
```

The 50k-entry stress test uses this multiplier in CI for the timing threshold.

---

## Mutation Testing

OTPLUS uses [Stryker Mutator](https://stryker-mutator.io/) for mutation testing.

### Running

```bash
npm run test:mutants
```

### Configuration

See `jest.stryker.config.js` for Stryker-specific Jest configuration.

### CI Requirement

Mutation testing is **not required in CI** — it's an optional quality check for development. Run it locally when making changes to core calculation logic (`js/calc.ts`, `js/utils.ts`).
