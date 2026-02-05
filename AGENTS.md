# AGENTS.md - AI Agent Instructions

> Universal instructions for AI coding agents (OpenAI Codex, GitHub Copilot Workspace, etc.)

## Quick Start

```bash
# Verify codebase health (run these first)
npm run typecheck    # TypeScript compilation check
npm run lint         # ESLint (0 errors, 0 warnings expected)
npm run deps:check   # Dependency cruiser (0 errors expected)
npm test             # 2904 tests (100% pass rate expected)
```

## Project Overview

**OTPLUS Overtime Addon** - A Clockify browser extension for enterprise overtime calculations.

| Metric | Value |
|--------|-------|
| Language | TypeScript 5.9.3 (strict mode) |
| Tests | 2904 passing (Jest + Playwright) |
| Coverage | 95.74% lines, 94.61% branches |
| Architecture | MVC with pure calculation engine |

## Codebase Structure

```
js/
├── api.ts              # API layer (circuit breaker, rate limiter, body signing, metrics)
├── calc.ts             # Pure calculation engine (deterministic, side-effect free)
├── state.ts            # Centralized state management + localStorage fallback + encryption
├── main.ts             # Entry point, orchestration, session management, worker offload
├── utils.ts            # Utilities (validation, hashing, CSV escape)
├── constants.ts        # Configuration constants, input bounds
├── types.ts            # TypeScript interfaces and types
├── logger.ts           # Structured JSON logging with correlation IDs, audit bypass
├── metrics.ts          # Performance metrics (Prometheus/StatsD format) - wired to API/calc
├── crypto.ts           # AES-GCM encryption for sensitive data - integrated with state
├── csp-reporter.ts     # Content Security Policy violation reporting - initialized in main
├── memory-profiler.ts  # Memory profiling for load testing
├── performance-dashboard.ts  # Real-time performance monitoring
├── streaming.ts        # Chunked processing for large datasets
├── worker-pool.ts      # Web Worker pooling for parallel calculations - used by main
├── calc.worker.ts      # Calculation web worker
├── export.ts           # CSV export with injection protection
└── ui/
    ├── dialogs.ts      # Error banners, session warnings, confirmations
    ├── summary.ts      # Summary table rendering
    ├── detailed.ts     # Detailed results rendering
    ├── shared.ts       # Shared UI utilities
    └── overrides.ts    # User override table

__tests__/
├── unit/               # Unit tests (Jest, jsdom/node environments)
├── performance/        # Performance benchmarks
├── e2e/                # End-to-end tests (Playwright)
└── a11y/               # Accessibility tests (axe-core)

docs/
├── CAPACITY.md         # Scalability limits and guidelines
├── RUNBOOK.md          # Operational procedures
├── SLA.md              # Service level agreements
├── TROUBLESHOOTING.md  # Common issues and solutions
└── adr/                # Architecture Decision Records
```

---

## Best Practices for AI Agents

### 1. Safety Rules (MUST FOLLOW)

- **Never log or persist auth tokens or PII**
- **Never modify CI/CD, auth, or security settings** without explicit request
- **Never add dependencies** without explicit approval
- **Always run verification commands** before claiming task completion
- **Preserve existing test patterns** - don't refactor working tests

### 2. Before Making Changes

```bash
# Read these files first for context
cat README.md
cat TODO.md          # Current task list and priorities
```

### 3. Code Style Guidelines

- **TypeScript strict mode** - All code must pass `npm run typecheck`
- **No `any` types** - Use proper typing or `unknown` with type guards
- **Pure functions preferred** - Especially in `calc.ts` (no side effects)
- **Small, focused changes** - Prefer small diffs over large refactors
- **Keep types in sync** - Update `js/types.ts` when interfaces change

### 4. Testing Requirements

| Change Type | Required Tests |
|-------------|----------------|
| Bug fix | Unit test reproducing the bug |
| New feature | Unit tests + integration if UI-facing |
| API changes | Unit tests in node environment |
| UI changes | Unit tests + consider E2E |
| Calculation changes | Unit tests + mutation coverage check |

**Test Environment Selection:**
```javascript
// Use node environment for API tests (crypto.subtle)
/** @jest-environment node */
import { webcrypto } from 'crypto';
global.crypto = webcrypto;

// Use jsdom environment for UI tests (DOM required)
/** @jest-environment jsdom */
```

**Async Rate Limiter Pattern:**
```javascript
// API calls with rate limiting need this pattern
const promise = Api.someMethod(...);
await jest.runAllTimersAsync();
const result = await promise;
```

### 5. Verification Checklist

Before completing any task:

```bash
npm run typecheck        # Must pass (0 errors)
npm run lint             # Must pass (0 errors, 0 warnings)
npm run deps:check       # Must pass (0 errors)
npm test                 # Must pass (2904+ tests)
```

For coverage-sensitive changes:
```bash
npm run test:coverage    # Check coverage thresholds (80% minimum)
```

---

## Common Tasks

### Adding a New Feature

1. Read relevant source files first
2. Add types to `js/types.ts` if needed
3. Implement in appropriate module
4. Add unit tests with proper environment
5. Run verification checklist
6. Update documentation if user-facing

### Fixing a Bug

1. Write a failing test that reproduces the bug
2. Fix the bug
3. Verify test passes
4. Run full verification checklist
5. Document fix in commit message

### Writing Tests

```javascript
// Standard test structure
describe('ModuleName', () => {
    beforeEach(() => {
        jest.useFakeTimers({ advanceTimers: true });
        // Reset any module state
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('should describe expected behavior', () => {
        // Arrange
        const input = createTestInput();

        // Act
        const result = functionUnderTest(input);

        // Assert
        expect(result).toEqual(expectedOutput);
    });
});
```

### Debugging Test Failures

1. Check test environment (node vs jsdom)
2. Check for missing mocks (especially `crypto`, `fetch`)
3. Check for timer issues (use `runAllTimersAsync` pattern)
4. Check for state leaking between tests (reset in `beforeEach`)

---

## Architecture Constraints

### Module Dependencies (Enforced by dependency-cruiser)

```
constants.ts, types.ts  →  No imports from other modules
calc.ts                 →  Only constants.ts, types.ts (pure functions)
api.ts                  →  No UI imports
ui/*                    →  No direct API calls (go through state)
```

### State Management

- All state lives in `js/state.ts`
- UI reads from store, never modifies directly
- API updates go through store actions
- localStorage has fallback to in-memory storage
- Encryption support via `encryptStorage` config flag

### Security Patterns

- Tokens: Memory only, never persisted
- CSV export: Formula injection protection (OWASP)
- URLs in logs: Sanitized (IDs redacted)
- User data: Hashed before logging
- Overrides: Optional AES-GCM encryption

---

## Feature Flags & Configuration

### Feature Flags

| Flag | Location | Description |
|------|----------|-------------|
| `encryptStorage` | `store.config.encryptStorage` | Enable AES-GCM encryption for localStorage |

### Environment Variables (Build Time)

| Variable | Default | Description |
|----------|---------|-------------|
| `VERSION` | from package.json | App version injected at build |
| `NODE_ENV` | 'development' | Build mode (production/development) |
| `SENTRY_DSN` | '' | Sentry DSN for error reporting |
| `MANIFEST_BASE_URL` | unchanged | Override manifest.json baseUrl |

---

## Debugging Tools (Browser Console)

```javascript
// Performance dashboard
window.__OTPLUS_PERF_DASHBOARD__.getStatus()
window.__OTPLUS_PERF_DASHBOARD__.getReport()

// Metrics (wired to API and calculations)
window.__OTPLUS_METRICS__.summary()
window.__OTPLUS_METRICS__.prometheus()
window.__OTPLUS_METRICS__.get('api_request_duration')

// Memory profiling
window.__OTPLUS_MEMORY_PROFILER__.start()
window.__OTPLUS_MEMORY_PROFILER__.analyze()

// Health check
window.__OTPLUS_HEALTH_CHECK__()

// CSP Reporter
window.__OTPLUS_CSP__.getConfig()
window.__OTPLUS_CSP__.getStats()

// Encryption
window.__OTPLUS_CRYPTO__.isSupported()
```

---

## Current Status (February 2, 2026)

| Item | Status |
|------|--------|
| Tests | 2904 passing (100%) |
| TypeScript | ✅ Passing |
| ESLint | ✅ Passing (0 errors, 0 warnings) |
| Coverage | 95.74% lines |
| Enterprise Features | All P0-P3 complete + 5 prioritized features |

### Recent Changes

- Implemented 5 prioritized enterprise features:
  1. Fixed E2E tests (version placeholder replacement)
  2. Fixed deployment config (SENTRY_DSN, MANIFEST_BASE_URL)
  3. Wired up observability (CSP reporter, metrics, audit logs)
  4. Enabled localStorage encryption (AES-GCM via crypto.ts)
  5. Enabled worker offload for large calculations (500+ entries)
- Added comprehensive test coverage (+140 tests)
- Fixed Jest fake timers compatibility with async rate limiter
- Added session timeout warnings and expiration dialogs
- Implemented metrics, memory profiling, streaming, worker pool

### Known Issues

- `calc-mutation-killers.test.js` is large (7,198 lines) - split deferred
- `worker-pool.ts` has 86% coverage (executeStream async generator hard to test)

---

## Session Handoff Notes

When starting a new session:

1. Run verification commands first
2. Check `TODO.md` for current priorities
3. Check git status for any uncommitted work

When ending a session:

1. Run verification commands
2. Update `TODO.md` if tasks completed/added
3. Commit with descriptive message including "Co-Authored-By" if applicable

---

## Contact & Resources

- **Documentation:** `docs/` directory
- **Architecture Decisions:** `docs/adr/`
- **Test Strategy:** `docs/test-strategy.md`
- **Troubleshooting:** `docs/TROUBLESHOOTING.md`
