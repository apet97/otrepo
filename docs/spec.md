# OTPLUS v2.0.0 — Technical Specification

**Version:** 2.0.0
**Last Updated:** February 2026
**Status:** Implementation Complete / Optimized

---

## 1. Architecture Overview
OTPLUS is a modular vanilla JavaScript application built with ES Modules. It follows a Controller-driven architecture with a centralized, reactive state store.

### File-level Module Map
```
js/
├── main.ts          # Entry point, orchestration, event binding
├── api.ts           # Clockify API client, rate limiting, auth
├── calc.ts          # Pure overtime/billable calculation engine
├── state.ts         # Centralized store, persistence, overrides
├── utils.ts         # Date parsing, escaping, precision math
├── export.ts        # CSV generation with formula injection protection
├── constants.ts     # Configuration defaults, storage keys
├── types.ts         # TypeScript interfaces for all data structures
├── logger.ts        # Structured JSON logging with correlation IDs
├── metrics.ts       # Performance metrics (Prometheus/StatsD export)
├── crypto.ts        # AES-GCM encryption for localStorage (Web Crypto API)
├── worker-pool.ts   # Web Worker pooling for parallel calculations
├── streaming.ts     # Chunked array processing for UI responsiveness
├── memory-profiler.ts # Snapshot-based memory tracking and leak detection
├── performance-dashboard.ts # Real-time metrics visualization overlay
├── csp-reporter.ts  # Content Security Policy violation reporting
├── error-reporting.ts # Sentry integration (optional)
├── calc.worker.ts   # Web Worker for background calculations
├── worker-manager.ts # Worker lifecycle management
└── ui/
    ├── index.ts     # UI module exports
    ├── summary.ts   # Summary strip + grouped table rendering
    ├── detailed.ts  # Paginated detailed entry table
    ├── dialogs.ts   # Error banners, prompts, status indicators
    ├── shared.ts    # Common UI helpers (formatting, colors)
    └── overrides.ts # User override editor UI
```

### Data Flow Diagram
```mermaid
flowchart TB
    subgraph UI_Layer["UI Layer (ui.js)"]
        Components[DOM Components]
        Pagination[Client-side Pagination]
        Events[Event Listeners]
    end
    
    subgraph Controller["Controller (main.js)"]
        Init[Initialization]
        Orchestrator[Parallel Fetch Orchestrator]
        Aborts[AbortController Management]
    end

    subgraph Logic["Business Logic"]
        Calc[calc.js (Pure Logic)]
        Utils[utils.js (Smart Escaping / Precision Math)]
        Export[export.js (Secure CSV)]
    end
    
    subgraph State["State Management (state.js)"]
        Store[Central Reactive Store]
        PubSub[Pub/Sub Engine]
        Persistence[LocalStorage Sync]
    end
    
    subgraph Data["Data Layer (api.js)"]
        API[Clockify API]
        Limiter[Iterative Token Bucket]
        Auth[X-Addon-Token Handler]
    end
    
    UI_Layer --> Controller
    Controller --> Logic
    Controller --> State
    Controller --> Data
    Logic --> State
    Data --> API
```

---

## 2. State Management (Pub/Sub)
The `Store` class implements a simple Publisher/Subscriber pattern to allow UI components to react to state changes without direct coupling.

```javascript
class Store {
    constructor() {
        this.listeners = new Set();
        this.ui = { 
            detailedPage: 1, 
            detailedPageSize: 50, 
            activeDetailedFilter: 'all' 
        };
        // ... initial state
    }
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    notify() { this.listeners.forEach(l => l(this)); }
}
```

### 2.1 UI Rendering Notes
- **Decimal Time Toggle:** `config.showDecimalTime` switches display formatting between `xh ym` and decimal hours without changing calculations.
- **Detailed Columns:** `Date`, `Start`, `End`, `User`, `Regular`, `Overtime`, `Billable`, `Rate $/h`, `Regular $`, `OT $`, `T2 $`, `Total $`, `Status`.
- **Status Tags:** Status combines system tags (HOLIDAY, OFF-DAY, TIME-OFF, BREAK) derived from API day context plus entry tags (HOLIDAY ENTRY, TIME-OFF ENTRY). PTO entry tags are informational and do not affect capacity.

---

## 3. High-Performance Data Orchestration
OTPLUS uses parallel fetches with cache-aware orchestration to saturate the client-side rate limiter and minimize waiting time.

```javascript
// Orchestration Logic in main.js
const promises = [
    Api.fetchDetailedReport(..., { signal }),
    Api.fetchAllProfiles(..., { signal }),
    Api.fetchAllHolidays(..., { signal }),
    Api.fetchAllTimeOff(..., { signal })
];
await Promise.allSettled(promises);
```

Cached profiles, holidays, and time-off maps are loaded from localStorage first (6-hour TTL, versioned).
Only missing user IDs or ranges are fetched over the network, and successful results are persisted back to cache.

---

## 4. Rate Limiting Logic
A global token bucket ensures we never exceed 50 requests per second. The `waitForToken` function uses an iterative approach to prevent stack overflow.

```javascript
async function waitForToken() {
    while (true) {
        if (tokens > 0) {
            tokens--;
            return;
        }
        await delay(REFILL_INTERVAL - (now - lastRefill));
    }
}
```

---

## 5. Calculation Logic: Timezone Awareness
To prevent evening work from shifting to the next day, date extraction is performed using a canonical timezone instead of raw string splitting.
The canonical timezone is resolved in this order: viewer profile time zone (if provided by Clockify), workspace claim (if present), then browser default.

```javascript
// extractDateKey in utils.js
extractDateKey(isoString) {
    const date = new Date(isoString);
    return formatDateKeyInTimeZone(date, canonicalTimeZone);
}
```

### 5.1 Overtime Basis Modes
OTPLUS supports three overtime bases:
- `daily` (default): overtime is calculated when daily capacity is exceeded.
- `weekly`: overtime is calculated when weeklyThreshold is exceeded across a Monday-based week.
- `both`: calculates daily and weekly overtime in parallel; combined OT uses the maximum of the two with overlap tracked separately.

### 5.2 Entry Types vs Day Status (Important Distinction)

OTPLUS distinguishes between **entry-level types** and **day-level status**:

**Entry Types** (from `entry.type` field):
- `REGULAR` (or undefined): Normal work entry - can become overtime
- `BREAK`: Break entry - always regular hours, does NOT accumulate toward capacity
- `HOLIDAY`, `HOLIDAY_TIME_ENTRY`: PTO entry - always regular hours, informational only
- `TIME_OFF`, `TIME_OFF_TIME_ENTRY`: PTO entry - always regular hours, informational only

**Day Status** (from API holiday/time-off maps):
- `isHoliday`: Day is a holiday for this user (capacity → 0, all work becomes OT)
- `isNonWorking`: Day is outside user's working days (capacity → 0)
- `isTimeOff`: User has approved time-off (capacity reduced by time-off hours)

**Key Point**: Entry types are purely informational. An entry with `type: 'HOLIDAY'` logged on a regular workday does NOT make that day a holiday. Only the API-provided holiday/time-off maps (fetched via `fetchAllHolidays`/`fetchAllTimeOff`) affect capacity calculations.

This separation ensures:
1. Users can log PTO entries without affecting overtime calculations
2. Holidays and time-off are driven by authoritative API data, not user-entered entry types
3. Entry tags provide visual indicators in the Status column without changing business logic

---

## 6. Secure CSV Export
CSV generation uses a specialized `escapeCsv` utility to ensure data integrity and security.

| Feature | Implementation |
|----------------|----------------|
| **Smart Quoting** | Only adds double quotes if field contains `,`, `"`, `\n`, or `\r`. |
| **Quote Escaping** | Replaces `"` with `""`.
| **Injection Mitigation** | Prepends `'` to fields starting with dangerous formula characters (`=`, `+`, `-`, `@`). |
| **Decimal Hours Column** | Adds `TotalHoursDecimal` alongside `TotalHours` for decimal-friendly exports. |
| **OT Breakdown Columns** | Exports daily/weekly/overlap/combined overtime columns in addition to total OT. |

--- 

## 7. API Integration Reference

| Feature | Endpoint | Method | Note |
|---------|----------|--------|------|
| Detailed Report | `/v1/workspaces/{wid}/reports/detailed` | POST | Paginated (200/page), includes amounts |
| Time Entries (legacy) | `/v1/workspaces/{wid}/user/{uid}/time-entries` | GET | Paginated (500/page), legacy path |
| Profiles | `/v1/workspaces/{wid}/member-profile/{uid}` | GET | Batched (5 parallel) |
| Holidays | `/v1/workspaces/{wid}/holidays/in-period` | GET | Full ISO 8601 datetime (`YYYY-MM-DDTHH:mm:ssZ`) |
| Time Off | `/v1/workspaces/{wid}/time-off/requests` | POST | Approved status filter |

---

## 8. Guide & Operational Reference
- The new `docs/guide.md` summarizes how each module (state, calc, UI) consumes these APIs, plus the storage schema and override workflow.
- Use the guide as a quick reference when triaging bugs or onboarding new team members—its API catalog explicitly states headers (`X-Addon-Token`), rate limiting expectations (token bucket), and abort handling via `AbortController`.

## 9. Persistence Schema (localStorage)

| Key | Value |
|-----|-------|
| `otplus_config` | JSON object containing toggles and daily/multiplier thresholds. |
| `overtime_overrides_{workspaceId}` | Map of userId -> manual overrides. |
| `otplus_profiles_{workspaceId}` | Cached profile map with `{ version, timestamp, entries }`. |
| `otplus_holidays_{workspaceId}_{start}_{end}` | Cached holiday map scoped to the report range. |
| `otplus_timeoff_{workspaceId}_{start}_{end}` | Cached time-off map scoped to the report range. |

`otplus_config.config` includes `showDecimalTime` (boolean) to persist the UI formatting toggle.

--- 

## 10. Known Technical Constraints
- **Memory Management:** Analysis results are kept in memory. Extremely large date ranges (>1 year) for large teams may exceed memory limits on low-end devices.
- **Clockify API Limits:** While we throttle to 50 req/s, concurrent usage of multiple addons or browser tabs by the same user might still trigger a server-side 429.
- **Midnight Attribution:** Entries are attributed to the day they *started*. A shift from 10 PM to 2 AM will count as 4 hours on Day 1.

---

## 11. Testing Architecture

### 11.1 Unit Testing
- Framework: Jest with ES Modules (`--experimental-vm-modules`)
- **2908 tests** across 68 test files (100% pass rate)
- Coverage: 95.77% lines, 94.71% branches
- Test files: `__tests__/unit/*.test.js`

### 11.2 Integration Testing
- Framework: Jest + jsdom
- Scope: orchestration (cache decisions, request races, optional fetch failures)

### 11.2 Mutation Testing
- Framework: Stryker Mutator
- Purpose: Validates test effectiveness (not just coverage)
- Config: `stryker.config.json`, `jest.stryker.config.js`
- Cadence: Not run on every PR; executed nightly or manually via CI workflow dispatch.

**Mutation Score (Achieved)**:
| File | Score |
|------|-------|
| calc.ts | 100% |
| utils.ts | 100% |
| api.ts | 100% |

All equivalent mutants have been addressed through targeted Stryker disable comments wrapping complete if-else chains.

### 11.3 E2E Testing
- Framework: Playwright (Chromium/Firefox/WebKit)
- Determinism: time frozen per test and dialogs auto-accepted
- Scope: auth, report generation, export, and error handling

See `docs/test-strategy.md` for tiering and determinism rules.

---

## 12. API Error Handling

OTPLUS handles Clockify API errors as follows:

### HTTP Status Codes

| Status | Behavior |
|--------|----------|
| **200-299** | Success - parse response and continue |
| **401** | Unauthorized - invalid token, show auth error (no retry) |
| **403** | Forbidden - insufficient permissions, show error (no retry) |
| **404** | Not Found - resource missing, show error (no retry) |
| **429** | Rate Limited - respect `Retry-After` header, exponential backoff with 2-minute total cap |
| **500-599** | Server Error - exponential backoff retry (1s, 2s, 4s), max 2 retries |

### Error Classification

Errors are classified via `classifyError()` in `js/api.ts`:

- **AUTH_ERROR**: 401/403, invalid tokens, permission issues
- **VALIDATION_ERROR**: 400, bad request parameters
- **RATE_LIMIT_ERROR**: 429, throttling
- **NETWORK_ERROR**: Timeouts, connection failures
- **SERVER_ERROR**: 5xx responses
- **UNKNOWN_ERROR**: Other errors

### Graceful Degradation

| API | Failure Behavior |
|-----|------------------|
| **Users** | Required - show error state, cannot continue |
| **Entries** | Required - show error state, cannot continue |
| **Profiles** | Optional - continue with default 8h capacity |
| **Holidays** | Optional - continue without holiday adjustments |
| **Time-Off** | Optional - continue without time-off adjustments |

### User-Facing Errors

Error messages are shown via `UI.showError()` with:
- Human-readable description
- Retry button (for retryable errors)
- Clear data option (for corrupt cache recovery)

### Abort Handling

When `AbortController.abort()` is called (e.g., user starts a new report):
- In-flight requests are cancelled gracefully
- `fetchDetailedReport` returns partial results (empty array if on page 1)
- No error is thrown for user-initiated aborts
- UI returns to ready state without error banner
