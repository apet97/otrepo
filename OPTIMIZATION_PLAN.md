# OTPLUS V2 Optimization Plan: Support 1500-User Workspaces

## Table of Contents

- [Context & Problem Statement](#context--problem-statement)
- [Phase 1: Data Correctness (P0 Showstoppers)](#phase-1-data-correctness-p0-showstoppers)
  - [1.1 Paginate fetchUsers](#11-paginate-fetchusers)
  - [1.2 Raise Entry Pagination Limits](#12-raise-entry-pagination-limits)
  - [1.3 Paginate fetchTimeOffRequests](#13-paginate-fetchtimeoffrequests)
- [Phase 2: API Performance](#phase-2-api-performance)
  - [2.1 Increase BATCH_SIZE from 5 → 20](#21-increase-batch_size-from-5--20)
  - [2.2 Holiday Deduplication](#22-holiday-deduplication-sample-and-propagate)
  - [2.3 Batch the Profile Retry Pass](#23-batch-the-profile-retry-pass)
  - [2.4 Progress Callbacks](#24-progress-callbacks-for-long-running-fetches)
- [Phase 3: UI Performance](#phase-3-ui-performance)
  - [3.1 Cache Flattened Detailed Entries](#31-cache-flattened-detailed-table-entries)
  - [3.2 Pre-compute Filter Subsets](#32-pre-compute-per-filter-subsets)
  - [3.3 Paginate Summary Table](#33-paginate-the-summary-table)
  - [3.4 Paginate + Search Overrides](#34-paginate--search-the-overrides-page)
- [Phase 4: Memory & Compute Optimization](#phase-4-memory--compute-optimization)
  - [4.1 Streaming CSV Export](#41-streaming-csv-export)
  - [4.2 IndexedDB Report Cache](#42-indexeddb-for-report-cache)
  - [4.3 Eliminate Redundant Sorts in Calc](#43-eliminate-redundant-sorts-in-calc-engine)
  - [4.4 Increase Worker Pool + Shard](#44-increase-worker-pool-and-shard-calculations)
  - [4.5 Memoize Hot Pure Functions](#45-memoize-hot-pure-functions)
  - [4.6 Integrate streaming.ts](#46-integrate-streamingts-utilities)
- [Phase 5: Testing & Verification](#phase-5-testing--verification)
- [Critical Files Reference](#critical-files-reference)
- [Implementation Order](#implementation-order)

---

## Context & Problem Statement

OTPLUS is a purely client-side Clockify sidebar addon (TypeScript, hosted on GitHub Pages) that calculates overtime for workspace users. It currently has **three showstopper data-correctness bugs** that prevent it from handling more than ~50 users, plus several performance bottlenecks that would make 1500-user workspaces unusable even after the bugs are fixed.

### Current Scale Limits

| Component | Current Limit | Required for 1500 Users |
|-----------|--------------|------------------------|
| User fetch | ~50 (no pagination) | 1500+ |
| Time entries | 10,000 (50 pages × 200) | ~450,000 (1500 users × 30 days × ~10 entries) |
| Time-off records | 200 (no pagination) | Potentially thousands |
| API batch size | 5 concurrent | 20 concurrent |
| Summary DOM nodes | ~27,000 (all rows) | ~1,800 (paginated 100 rows) |
| Overrides DOM nodes | ~22,500 (all cards) | ~750 (paginated 50 cards) |
| CSV export memory | ~180 MB (4 copies) | ~50 MB (streaming) |
| Report cache | 5 MB (sessionStorage) | Unlimited (IndexedDB) |

### Existing Infrastructure (Currently Unused)

The addon has pre-built utilities that can be leveraged:

- **`js/streaming.ts`** — `processInChunks`, `splitIntoBatches`, `calculateOptimalChunkSize`, `ChunkedProcessor` (fully implemented, zero production callers)
- **`WorkerPool`** — Multi-worker pool exists but `poolSize` is hardcoded to `1`
- **`memory-profiler.ts`** — Memory tracking utilities (not integrated)

---

## Phase 1: Data Correctness (P0 Showstoppers)

Without these fixes, the addon silently returns wrong/incomplete data at 1500 users. **These must be fixed first.**

---

### 1.1 Paginate `fetchUsers`

**Severity:** P0 — Silently drops 1450 out of 1500 users
**File:** `js/api.ts`, lines 1467–1472
**Call site:** `js/main.ts`, line 913

#### Current Code (Broken)

```typescript
// js/api.ts:1467-1472
async fetchUsers(workspaceId: string): Promise<User[]> {
    const { data } = await fetchWithAuth<User[]>(
        `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/users`
    );
    return data || [];
},
```

**Problem:** Single non-paginated GET. The Clockify API returns at most ~50 users per page by default. A workspace with 1500 users will silently get only ~50 users — the remaining 1450 are dropped without any error or warning.

#### Required Fix

Add a pagination loop using the existing `PAGE_SIZE = 500` constant (defined at `js/api.ts:371`). The Clockify `/users` endpoint supports `?page=N&page-size=N` query parameters.

```typescript
// js/api.ts — Replace fetchUsers
async fetchUsers(workspaceId: string, options: FetchOptions = {}): Promise<User[]> {
    const allUsers: User[] = [];
    let page = 1;
    const maxPages = 20; // Safety limit: 20 × 500 = 10,000 users max

    while (true) {
        if (options.signal?.aborted) {
            apiLogger.info('User fetch aborted', { page, usersFetched: allUsers.length });
            return allUsers;
        }

        const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/users?page=${page}&page-size=${PAGE_SIZE}`;
        const { data, failed } = await fetchWithAuth<User[]>(url, {
            signal: options.signal,
        });

        if (failed || !data) {
            if (page === 1) {
                throw new Error('Failed to fetch workspace users');
            }
            break; // Return partial results for subsequent page failures
        }

        allUsers.push(...data);

        // If we got fewer than PAGE_SIZE, there are no more pages
        if (data.length < PAGE_SIZE) {
            break;
        }

        page++;
        if (page > maxPages) {
            apiLogger.warn('User pagination hit safety limit', {
                maxPages,
                totalFetched: allUsers.length,
            });
            break;
        }
    }

    return allUsers;
},
```

#### Cascade Changes

**`js/main.ts:913`** — Pass abort signal to the new `fetchUsers`:

```typescript
// Before:
store.users = await Api.fetchUsers(store.claims.workspaceId);

// After:
store.users = await Api.fetchUsers(store.claims.workspaceId, { signal });
```

(The `signal` variable is the `AbortSignal` from the current `AbortController` used throughout the report generation flow.)

#### Tests to Write

- Mock response with 3 pages (500 + 500 + 200 users) → verify all 1200 returned
- Mock first page failure → verify error thrown
- Mock second page failure → verify partial results returned (500 users)
- Mock abort signal mid-pagination → verify partial results
- Verify `page` and `page-size` query parameters in request URLs

---

### 1.2 Raise Entry Pagination Limits

**Severity:** P0 — 78% of time entries silently truncated
**File:** `js/constants.ts`, lines 182 and 188
**Used by:** `js/api.ts`, lines 1766–1778 (inside `fetchDetailedReport` pagination loop)

#### Current Code (Broken)

```typescript
// js/constants.ts:182
export const DEFAULT_MAX_PAGES = 50;

// js/constants.ts:188
export const HARD_MAX_PAGES_LIMIT = 500;
```

**Problem:** With `DEFAULT_MAX_PAGES = 50` and `pageSize = 200` (the max allowed by the Reports API), the maximum fetchable entries is `50 × 200 = 10,000`. For 1500 users × 30 days × ~10 entries/day = **450,000 entries**, this truncates 78% of data.

#### Current Pagination Logic

```typescript
// js/api.ts:1766-1778 (inside fetchDetailedReport while loop)
const configuredMaxPages = store.config.maxPages ?? DEFAULT_MAX_PAGES;
const effectiveMaxPages = configuredMaxPages === 0
    ? HARD_MAX_PAGES_LIMIT
    : Math.min(configuredMaxPages, HARD_MAX_PAGES_LIMIT);

if (page > effectiveMaxPages) {
    console.warn(`Reached page limit (${effectiveMaxPages}), stopping pagination.`);
    store.ui.paginationTruncated = true;
    hasMore = false;
}
```

#### Required Fix

```typescript
// js/constants.ts — Update values
export const DEFAULT_MAX_PAGES = 2500;    // Was 50. Now: 2500 × 200 = 500K entries
export const HARD_MAX_PAGES_LIMIT = 5000; // Was 500. Now: 5000 × 200 = 1M entries (absolute safety)
```

Additionally, add a count-based safety valve in `fetchDetailedReport` (entry count, not page count) as a secondary safeguard:

```typescript
// js/constants.ts — Add new constant
export const MAX_ENTRIES_LIMIT = 1_000_000; // Absolute max entries regardless of pages
```

```typescript
// js/api.ts — Inside fetchDetailedReport, after allEntries.push(...transformed) (line ~1750):
if (allEntries.length >= MAX_ENTRIES_LIMIT) {
    apiLogger.warn('Entry count safety limit reached', {
        limit: MAX_ENTRIES_LIMIT,
        entriesFetched: allEntries.length,
    });
    store.ui.paginationTruncated = true;
    hasMore = false;
}
```

#### Impact

- Before: Max 10,000 entries (fails at ~50 users)
- After: Max 500,000 entries default (supports 1500+ users for 30-day reports)
- Hard cap: 1,000,000 entries (absolute safety)

#### Tests to Write

- Verify `DEFAULT_MAX_PAGES` value is 2500
- Verify `HARD_MAX_PAGES_LIMIT` value is 5000
- Verify `MAX_ENTRIES_LIMIT` value is 1,000,000
- Mock pagination that exceeds `MAX_ENTRIES_LIMIT` → verify truncation and `paginationTruncated` flag

---

### 1.3 Paginate `fetchTimeOffRequests`

**Severity:** P0 — Only first 200 time-off records returned
**File:** `js/api.ts`, lines 1874–1907
**Called by:** `js/api.ts`, `fetchAllTimeOff` at line 2065

#### Current Code (Broken)

```typescript
// js/api.ts:1874-1907
async fetchTimeOffRequests(
    workspaceId: string,
    userIds: string[],
    startDate: string,
    endDate: string,
    options: FetchOptions = {}
): Promise<ApiResponse<RawTimeOffResponse | TimeOffRequest[]>> {
    const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/time-off/requests`;
    const body = {
        page: 1,
        pageSize: 200,
        users: userIds,
        statuses: ['APPROVED'],
        start: startDate,
        end: endDate,
    };

    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    const { data, failed, status } = await fetchWithAuth<
        RawTimeOffResponse | TimeOffRequest[]
    >(
        url,
        {
            method: 'POST',
            body: JSON.stringify(body),
            ...options,
        },
        maxRetries
    );

    return { data, failed, status };
},
```

**Problem:** Single request with `pageSize: 200`, no pagination loop. For 1500 users across 30 days, there could be thousands of time-off records. Only the first 200 are returned.

#### Required Fix

```typescript
// js/api.ts — Replace fetchTimeOffRequests
async fetchTimeOffRequests(
    workspaceId: string,
    userIds: string[],
    startDate: string,
    endDate: string,
    options: FetchOptions = {}
): Promise<ApiResponse<RawTimeOffResponse | TimeOffRequest[]>> {
    const url = `${store.claims?.backendUrl}${BASE_API}/${workspaceId}/time-off/requests`;
    const pageSize = 200;
    const maxPages = 50; // Safety limit: 50 × 200 = 10,000 time-off records
    const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
    let allRequests: TimeOffRequest[] = [];
    let page = 1;

    while (true) {
        if (options.signal?.aborted) {
            return { data: allRequests as unknown as RawTimeOffResponse | TimeOffRequest[], failed: false, status: 200 };
        }

        const body = {
            page,
            pageSize,
            users: userIds,
            statuses: ['APPROVED'],
            start: startDate,
            end: endDate,
        };

        const { data, failed, status } = await fetchWithAuth<
            RawTimeOffResponse | TimeOffRequest[]
        >(
            url,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                signal: options.signal,
            },
            maxRetries
        );

        if (failed || !data) {
            if (page === 1) {
                return { data: null as unknown as RawTimeOffResponse | TimeOffRequest[], failed: true, status };
            }
            break; // Return partial results
        }

        // Extract requests from response (handle multiple response formats)
        let pageRequests: TimeOffRequest[] = [];
        if (Array.isArray(data)) {
            pageRequests = data;
        } else if (data && typeof data === 'object') {
            if ('requests' in data && Array.isArray(data.requests)) {
                pageRequests = data.requests;
            } else if ('timeOffRequests' in data && Array.isArray(data.timeOffRequests)) {
                pageRequests = data.timeOffRequests;
            }
        }

        allRequests.push(...pageRequests);

        // If fewer results than page size, no more pages
        if (pageRequests.length < pageSize) {
            break;
        }

        page++;
        if (page > maxPages) {
            apiLogger.warn('Time-off pagination hit safety limit', {
                maxPages,
                totalFetched: allRequests.length,
            });
            break;
        }
    }

    return { data: allRequests as unknown as RawTimeOffResponse | TimeOffRequest[], failed: false, status: 200 };
},
```

#### Cascade Changes

**`js/api.ts:2065` (`fetchAllTimeOff`)** — The response normalization logic (lines 2082–2092) already handles both array and object-wrapped formats, so it should work with the paginated version that now always returns an array. However, verify that the type union `RawTimeOffResponse | TimeOffRequest[]` still type-checks.

#### Tests to Write

- Mock 3 pages of time-off requests (200 + 200 + 50) → verify all 450 returned
- Mock first page failure → verify `failed: true`
- Mock second page failure → verify partial results
- Mock abort signal → verify partial results
- Verify response format normalization works with paginated array response

---

## Phase 2: API Performance

### 2.1 Increase `BATCH_SIZE` from 5 → 20

**File:** `js/api.ts`, line 362; `js/constants.ts`

#### Current Code

```typescript
// js/api.ts:362
const BATCH_SIZE = 5;
```

**Problem:** At `BATCH_SIZE = 5`, fetching profiles + holidays for 1500 users requires:
- Profiles: 1500 / 5 = 300 sequential batches
- Holidays: 1500 / 5 = 300 sequential batches
- Total: ~600 sequential batches ≈ ~120 seconds

#### Required Fix

Move to `constants.ts` for configurability, increase to 20:

```typescript
// js/constants.ts — Add
export const API_BATCH_SIZE = 20;
```

```typescript
// js/api.ts — Replace line 362
import { API_BATCH_SIZE, ... } from './constants.js';
// Remove: const BATCH_SIZE = 5;
const BATCH_SIZE = API_BATCH_SIZE;
```

Or simply update the value inline:

```typescript
// js/api.ts:362
const BATCH_SIZE = 20;
```

#### Impact

- Profiles: 1500 / 20 = 75 sequential batches
- Holidays: 1500 / 20 = 75 sequential batches
- Total: ~150 sequential batches ≈ ~30 seconds (~75% reduction)

#### Risk

The token bucket rate limiter (50 req/sec, capacity 50) will still throttle if needed. At 20 concurrent requests per batch, we're within the burst capacity. The rate limiter at `js/api.ts` will naturally pace requests if we hit the limit.

#### Tests to Write

- Verify batch size is 20 in constant
- Verify rate limiter still functions correctly with larger batches (mock rate limiter interaction)

---

### 2.2 Holiday Deduplication (Sample-and-Propagate)

**File:** `js/api.ts`, `fetchAllHolidays` (line 1986)

#### Current Code

```typescript
// js/api.ts:1986-2035
async fetchAllHolidays(
    workspaceId: string,
    users: User[],
    startDate: string,
    endDate: string,
    options: FetchOptions = {}
): Promise<Map<string, Holiday[]>> {
    const results = new Map<string, Holiday[]>();
    let failedCount = 0;
    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    for (let i = 0; i < users.length; i += BATCH_SIZE) {
        const batch = users.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (user) => {
            const { data, failed } = await this.fetchHolidays(
                workspaceId, user.id, startIso, endIso, options
            );
            return { userId: user.id, data, failed };
        });
        // ... processes all users individually
    }
}
```

**Problem:** Fetches holidays individually for every single user. In the common case (workspace-wide holidays), all 1500 users return identical data → 1500 redundant API calls.

#### Strategy: Sample 5 Users, Then Propagate

```typescript
async fetchAllHolidays(
    workspaceId: string,
    users: User[],
    startDate: string,
    endDate: string,
    options: FetchOptions = {}
): Promise<Map<string, Holiday[]>> {
    const results = new Map<string, Holiday[]>();
    let failedCount = 0;
    const startIso = `${startDate}T00:00:00.000Z`;
    const endIso = `${endDate}T23:59:59.999Z`;

    if (users.length === 0) return results;

    // === OPTIMIZATION: Sample-and-propagate for workspace-wide holidays ===
    // Fetch holidays for a small sample of users first.
    // If all sample results are identical, assume workspace-wide holidays and clone.
    const SAMPLE_SIZE = Math.min(5, users.length);
    const sampleUsers = users.slice(0, SAMPLE_SIZE);
    const sampleResults: Array<{ userId: string; data: Holiday[] | null; failed: boolean }> = [];

    // Fetch sample
    const samplePromises = sampleUsers.map(async (user) => {
        const { data, failed } = await this.fetchHolidays(
            workspaceId, user.id, startIso, endIso, options
        );
        return { userId: user.id, data, failed };
    });
    const sampleBatchResults = await Promise.all(samplePromises);

    let allSampleIdentical = true;
    let referenceHolidays: Holiday[] | null = null;

    for (const result of sampleBatchResults) {
        const normalizedData = result.data
            ? result.data.map(h => ({
                  name: h.name || '',
                  datePeriod: {
                      startDate: h.datePeriod?.startDate || '',
                      endDate: h.datePeriod?.endDate || h.datePeriod?.startDate || '',
                  },
                  projectId: h.projectId,
              }))
            : [];

        if (result.failed) {
            failedCount++;
            allSampleIdentical = false;
        } else {
            results.set(result.userId, normalizedData);

            if (referenceHolidays === null) {
                referenceHolidays = normalizedData;
            } else {
                // Compare by serialized value
                if (JSON.stringify(normalizedData) !== JSON.stringify(referenceHolidays)) {
                    allSampleIdentical = false;
                }
            }
        }
    }

    // If all samples are identical, propagate to remaining users
    if (allSampleIdentical && referenceHolidays !== null && users.length > SAMPLE_SIZE) {
        apiLogger.info('Holiday deduplication: propagating identical holidays', {
            sampleSize: SAMPLE_SIZE,
            propagatedTo: users.length - SAMPLE_SIZE,
        });

        for (let i = SAMPLE_SIZE; i < users.length; i++) {
            // Clone the reference holidays (shallow copy of array, objects are immutable here)
            results.set(users[i].id, [...referenceHolidays]);
        }
    } else {
        // Fall back to full per-user fetch for remaining users
        const remainingUsers = users.slice(SAMPLE_SIZE);
        for (let i = 0; i < remainingUsers.length; i += BATCH_SIZE) {
            const batch = remainingUsers.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (user) => {
                const { data, failed } = await this.fetchHolidays(
                    workspaceId, user.id, startIso, endIso, options
                );
                return { userId: user.id, data, failed };
            });
            const batchResults = await Promise.all(batchPromises);
            batchResults.forEach(({ userId, data, failed }) => {
                if (failed) failedCount++;
                if (data) {
                    results.set(userId, data.map(h => ({
                        name: h.name || '',
                        datePeriod: {
                            startDate: h.datePeriod?.startDate || '',
                            endDate: h.datePeriod?.endDate || h.datePeriod?.startDate || '',
                        },
                        projectId: h.projectId,
                    })));
                }
            });
        }
    }

    store.apiStatus.holidaysFailed = failedCount;
    return results;
},
```

#### Impact

- **Common case** (workspace-wide holidays): 1500 calls → 5 calls (99.7% reduction)
- **Mixed case** (per-user holidays): Falls back to full fetch, 5 extra calls overhead

#### Tests to Write

- 5 identical sample results → verify propagation to all users (no extra API calls)
- 5 different sample results → verify fallback to full per-user fetch
- Sample with 1 failure → verify fallback
- Verify propagated holidays are correct copies (not references)

---

### 2.3 Batch the Profile Retry Pass

**File:** `js/api.ts`, lines 1949–1959

#### Current Code (Problem)

```typescript
// js/api.ts:1949-1959
if (failedUserIds.length > 0 && failedCount > 0) {
    apiLogger.info('Retrying failed profile fetches', { count: failedUserIds.length });
    const retryPromises = failedUserIds.map(async (userId) => {
        const { data, failed } = await this.fetchUserProfile(
            workspaceId, userId, options
        );
        return { userId, data, failed };
    });
    const retryResults = await Promise.all(retryPromises);
    // ...
}
```

**Problem:** All failed profiles are retried via unbatched `Promise.all` — if 100+ profiles failed, this fires 100+ concurrent requests simultaneously, overwhelming the rate limiter and potentially triggering 429 responses from the API.

#### Required Fix

```typescript
// Replace the retry block (lines 1949-1959) with batched retries:
if (failedUserIds.length > 0 && failedCount > 0) {
    apiLogger.info('Retrying failed profile fetches', { count: failedUserIds.length });
    let retrySuccessCount = 0;

    // Batch retries using the same BATCH_SIZE as initial fetches
    for (let i = 0; i < failedUserIds.length; i += BATCH_SIZE) {
        const retryBatch = failedUserIds.slice(i, i + BATCH_SIZE);
        const retryPromises = retryBatch.map(async (userId) => {
            const { data, failed } = await this.fetchUserProfile(
                workspaceId, userId, options
            );
            return { userId, data, failed };
        });
        const retryResults = await Promise.all(retryPromises);
        retryResults.forEach(({ userId, data, failed }) => {
            if (!failed && data) {
                results.set(userId, data);
                retrySuccessCount++;
            }
        });
    }

    failedCount = failedCount - retrySuccessCount;
}
```

#### Tests to Write

- Mock 25 failed profiles → verify retries happen in batches of BATCH_SIZE
- Verify rate limiter is not overwhelmed (no 429s in retry path)

---

### 2.4 Progress Callbacks for Long-Running Fetches

**Files:** `js/api.ts` (`fetchAllProfiles`, `fetchAllHolidays`), `js/main.ts`

#### Problem

When fetching 1500 profiles or holidays, the user sees a frozen spinner for 30+ seconds with no indication of progress.

#### Required Changes

**Add `onProgress` to `FetchOptions` type (if not already present):**

```typescript
// js/api.ts or js/types.ts — extend FetchOptions
interface FetchOptions {
    signal?: AbortSignal;
    maxRetries?: number;
    onProgress?: (fetched: number, total: number, label: string) => void;
}
```

**Add progress callbacks to `fetchAllProfiles` batch loop:**

```typescript
// js/api.ts:1927 — Inside the for loop, after processing each batch:
if (options.onProgress) {
    options.onProgress(results.size, users.length, 'profiles');
}
```

**Add progress callbacks to `fetchAllHolidays` batch loop:**

```typescript
// js/api.ts — Inside the holiday for loop, after processing each batch:
if (options.onProgress) {
    options.onProgress(results.size, users.length, 'holidays');
}
```

**Update call sites in `js/main.ts` (lines ~2076, ~2116) to pass progress handler:**

```typescript
// Example — in the profiles fetch call:
Api.fetchAllProfiles(store.claims.workspaceId, missingUsers, {
    signal,
    onProgress: (fetched, total, label) => {
        UI.updateProgressText(`Loading ${label}... ${fetched}/${total}`);
    },
})
```

This requires a small `UI.updateProgressText` helper or reuse of the existing loading indicator.

#### Tests to Write

- Verify `onProgress` is called after each batch
- Verify progress numbers are correct (monotonically increasing)

---

## Phase 3: UI Performance

### 3.1 Cache Flattened Detailed Table Entries

**File:** `js/ui/detailed.ts`, lines 142–157

#### Current Code (Problem)

```typescript
// js/ui/detailed.ts:142-157
// Flatten entries, attach day-level metadata, and sort by start time
let allEntries: DetailedEntry[] = users.flatMap((u) =>
    Array.from(u.days.values()).flatMap((d) =>
        d.entries.map((e) => ({
            ...e,
            userName: u.userName,
            dayMeta: {
                isHoliday: d.meta?.isHoliday || false,
                holidayName: d.meta?.holidayName || '',
                isNonWorking: d.meta?.isNonWorking || false,
                isTimeOff: d.meta?.isTimeOff || false,
            },
        }))
    )
).sort((a, b) =>
    (b.timeInterval.start || '').localeCompare(a.timeInterval.start || '')
);
```

**Problem:** Full 225K-entry `flatMap` + spread-copy + sort runs on **every page click**, every filter change, every tab switch. At 225K entries this takes ~500ms per render.

#### Required Fix

Add a module-level cache that invalidates only when the underlying data changes:

```typescript
// js/ui/detailed.ts — Add at module level (before renderDetailedTable)

// Cache for flattened + sorted detailed entries
let _cachedDetailedEntries: DetailedEntry[] | null = null;
let _cachedDetailedUsersRef: UserAnalysis[] | null = null;

function getCachedDetailedEntries(users: UserAnalysis[]): DetailedEntry[] {
    // Invalidate if the users array reference changed (new analysis results)
    if (_cachedDetailedUsersRef !== users || _cachedDetailedEntries === null) {
        _cachedDetailedEntries = users.flatMap((u) =>
            Array.from(u.days.values()).flatMap((d) =>
                d.entries.map((e) => ({
                    ...e,
                    userName: u.userName,
                    dayMeta: {
                        isHoliday: d.meta?.isHoliday || false,
                        holidayName: d.meta?.holidayName || '',
                        isNonWorking: d.meta?.isNonWorking || false,
                        isTimeOff: d.meta?.isTimeOff || false,
                    },
                }))
            )
        ).sort((a, b) =>
            (b.timeInterval.start || '').localeCompare(a.timeInterval.start || '')
        );
        _cachedDetailedUsersRef = users;
    }
    return _cachedDetailedEntries;
}

/** Clear the detailed entries cache (call when analysis results change). */
export function invalidateDetailedCache(): void {
    _cachedDetailedEntries = null;
    _cachedDetailedUsersRef = null;
}
```

Then in `renderDetailedTable`, replace lines 142–157 with:

```typescript
let allEntries = getCachedDetailedEntries(users);
```

#### Impact

- First render: Same as before (~500ms for 225K entries)
- Subsequent page clicks: **O(1) cache hit** (~0ms for flatten+sort), then O(pageSize) for slice
- Filter changes: Cache hit + O(n) filter pass

---

### 3.2 Pre-compute Per-Filter Subsets

**File:** `js/ui/detailed.ts`

#### Current Code

```typescript
// js/ui/detailed.ts:160-166
if (currentFilter === 'holiday') {
    allEntries = allEntries.filter((e) => e.dayMeta.isHoliday);
} else if (currentFilter === 'offday') {
    allEntries = allEntries.filter((e) => e.dayMeta.isNonWorking);
} else if (currentFilter === 'billable') {
    allEntries = allEntries.filter((e) => e.analysis?.isBillable);
}
```

**Problem:** Filters re-scan the full 225K entry array on every render.

#### Required Fix

Build a `Map<filterName, DetailedEntry[]>` when the cache is built:

```typescript
// js/ui/detailed.ts — Extend the cache system

let _cachedFilterSubsets: Map<string, DetailedEntry[]> | null = null;

function getCachedFilterSubset(users: UserAnalysis[], filter: string): DetailedEntry[] {
    const allEntries = getCachedDetailedEntries(users);

    if (_cachedFilterSubsets === null) {
        _cachedFilterSubsets = new Map();
        _cachedFilterSubsets.set('all', allEntries);
        _cachedFilterSubsets.set('holiday', allEntries.filter(e => e.dayMeta.isHoliday));
        _cachedFilterSubsets.set('offday', allEntries.filter(e => e.dayMeta.isNonWorking));
        _cachedFilterSubsets.set('billable', allEntries.filter(e => e.analysis?.isBillable));
    }

    return _cachedFilterSubsets.get(filter) || allEntries;
}
```

Update `invalidateDetailedCache`:

```typescript
export function invalidateDetailedCache(): void {
    _cachedDetailedEntries = null;
    _cachedDetailedUsersRef = null;
    _cachedFilterSubsets = null;
}
```

Replace the filter block in `renderDetailedTable` with:

```typescript
const filteredEntries = getCachedFilterSubset(users, currentFilter);
```

#### Impact

- Filter switch: Map lookup (O(1)) + slice (O(pageSize)) instead of O(225K) scan

---

### 3.3 Paginate the Summary Table

**File:** `js/ui/summary.ts`, lines 620–657; `js/state.ts`

#### Current Code (Problem)

```typescript
// js/ui/summary.ts:638-651
const fragment = document.createDocumentFragment();
for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = renderSummaryRow(row, groupBy, expanded, showBillable, showBoth, showAmounts);
    fragment.appendChild(tr);
}

if (Elements.summaryTableBody) {
    Elements.summaryTableBody.innerHTML = '';
    Elements.summaryTableBody.appendChild(fragment);
}
```

**Problem:** All 1500 user rows rendered at once = ~27K DOM nodes. Browser becomes sluggish.

#### Required Fix

**Step 1: Add UIState fields in `js/state.ts`:**

```typescript
// js/state.ts — Add to the UIState initialization (line ~385)
ui: UIState = {
    // ... existing fields ...
    summaryPage: 1,
    summaryPageSize: 100,
};
```

Also update the `UIState` type definition to include:

```typescript
summaryPage: number;
summaryPageSize: number;
```

**Step 2: Paginate in `renderSummaryTable`:**

```typescript
// js/ui/summary.ts — Replace the rendering block
export function renderSummaryTable(users: UserAnalysis[]): void {
    const Elements = getElements();
    const groupBy = store.ui.summaryGroupBy || 'user';
    const expanded = store.ui.summaryExpanded || false;
    const showBillable =
        store.config.showBillableBreakdown && store.ui.hasAmountRates !== false;
    const showBoth = store.config.overtimeBasis === 'both';
    const showAmounts = store.ui.hasAmountRates !== false;

    const rows = computeSummaryRows(users, groupBy);

    // Update header
    const thead = document.getElementById('summaryHeaderRow');
    if (thead) {
        thead.innerHTML = renderSummaryHeaders(groupBy, expanded, showBillable, showBoth, showAmounts);
    }

    // === PAGINATION ===
    const page = store.ui.summaryPage || 1;
    const pageSize = store.ui.summaryPageSize || 100;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    const startIdx = (page - 1) * pageSize;
    const pageRows = rows.slice(startIdx, startIdx + pageSize);

    const fragment = document.createDocumentFragment();
    for (const row of pageRows) {
        const tr = document.createElement('tr');
        tr.innerHTML = renderSummaryRow(row, groupBy, expanded, showBillable, showBoth, showAmounts);
        fragment.appendChild(tr);
    }

    if (Elements.summaryTableBody) {
        Elements.summaryTableBody.innerHTML = '';
        Elements.summaryTableBody.appendChild(fragment);
    }

    // Render pagination controls (reuse detailed.ts pattern)
    renderSummaryPagination(rows.length, page, totalPages, pageSize, users);

    if (Elements.resultsContainer) {
        Elements.resultsContainer.classList.remove('hidden');
    }
}
```

**Step 3: Add pagination controls function:**

```typescript
function renderSummaryPagination(
    totalRows: number,
    currentPage: number,
    totalPages: number,
    pageSize: number,
    users: UserAnalysis[]
): void {
    let paginationContainer = document.getElementById('summaryPagination');
    if (!paginationContainer) {
        // Create pagination container after the table
        const summaryTableBody = document.getElementById('summaryTableBody');
        const table = summaryTableBody?.closest('table');
        if (table) {
            paginationContainer = document.createElement('div');
            paginationContainer.id = 'summaryPagination';
            paginationContainer.className = 'pagination-controls';
            table.after(paginationContainer);
        }
    }
    if (!paginationContainer) return;

    if (totalPages <= 1) {
        paginationContainer.innerHTML = '';
        return;
    }

    paginationContainer.innerHTML = `
        <div class="pagination-info">
            Showing ${((currentPage - 1) * pageSize) + 1}–${Math.min(currentPage * pageSize, totalRows)} of ${totalRows}
        </div>
        <div class="pagination-buttons">
            <button class="btn btn-sm" data-page="1" ${currentPage === 1 ? 'disabled' : ''}>First</button>
            <button class="btn btn-sm" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>
            <span class="pagination-current">Page ${currentPage} of ${totalPages}</span>
            <button class="btn btn-sm" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
            <button class="btn btn-sm" data-page="${totalPages}" ${currentPage === totalPages ? 'disabled' : ''}>Last</button>
        </div>
    `;

    // Event delegation for pagination clicks
    paginationContainer.onclick = (e) => {
        const btn = (e.target as HTMLElement).closest('[data-page]') as HTMLElement;
        if (!btn || btn.hasAttribute('disabled')) return;
        const newPage = parseInt(btn.dataset.page || '1', 10);
        store.ui.summaryPage = Math.max(1, Math.min(newPage, totalPages));
        renderSummaryTable(users);
    };
}
```

**Step 4: Add CSS for pagination controls:**

Add styles matching the existing detailed table pagination pattern.

#### Impact

- DOM nodes: 27,000 → 1,800 (93% reduction)
- Render time: ~400ms → ~25ms
- Scrolling: Smooth instead of janky

#### Tests to Write

- Verify only 100 rows rendered when 1500 users provided
- Verify pagination controls appear when > 100 rows
- Verify page navigation updates rendered rows
- Verify `summaryPage` resets to 1 when new analysis is computed

---

### 3.4 Paginate + Search the Overrides Page

**File:** `js/ui/overrides.ts`, lines 50–157; `js/state.ts`

#### Current Code (Problem)

```typescript
// js/ui/overrides.ts:50-161
export function renderOverridesPage(): void {
    // ...
    store.users.forEach((user) => {
        // Creates a full card with many form elements per user
        const card = document.createElement('div');
        card.className = `card override-user-card collapsed${hasCustom ? ' has-custom' : ''}`;
        // ... ~70 lines of HTML per card ...
        fragment.appendChild(card);
    });
    container.innerHTML = '';
    container.appendChild(fragment);
}
```

**Problem:** 1500 user cards = ~22,500 DOM nodes (each card has ~15 elements: selects, inputs, labels, divs). The page is unresponsive and slow to scroll.

#### Required Fix

**Step 1: Add UIState fields in `js/state.ts`:**

```typescript
// Add to UIState
overridesPage: number;          // Default: 1
overridesPageSize: number;      // Default: 50
overridesSearch: string;        // Default: ''
```

**Step 2: Add search bar and paginate in `renderOverridesPage`:**

```typescript
export function renderOverridesPage(): void {
    const Elements = getElements();
    const container = Elements.overridesUserList;
    if (!container) return;

    if (!store.users.length) {
        container.innerHTML = '<div class="card"><p class="muted">No users loaded. Generate a report first to see users.</p></div>';
        return;
    }

    // === SEARCH FILTER ===
    const searchTerm = (store.ui.overridesSearch || '').toLowerCase().trim();
    const filteredUsers = searchTerm
        ? store.users.filter(u => u.name.toLowerCase().includes(searchTerm))
        : store.users;

    // === PAGINATION ===
    const page = store.ui.overridesPage || 1;
    const pageSize = store.ui.overridesPageSize || 50;
    const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const startIdx = (safePage - 1) * pageSize;
    const pageUsers = filteredUsers.slice(startIdx, startIdx + pageSize);

    // === RENDER SEARCH BAR ===
    let searchBar = document.getElementById('overridesSearchBar');
    if (!searchBar) {
        searchBar = document.createElement('div');
        searchBar.id = 'overridesSearchBar';
        searchBar.className = 'overrides-search-bar';
        searchBar.innerHTML = `
            <input type="text"
                   id="overridesSearchInput"
                   class="override-input"
                   placeholder="Search users..."
                   value="${escapeHtml(store.ui.overridesSearch || '')}"
                   aria-label="Search override users">
            <span class="overrides-search-count">${filteredUsers.length} of ${store.users.length} users</span>
        `;
        container.parentElement?.insertBefore(searchBar, container);

        // Debounced search handler
        const input = document.getElementById('overridesSearchInput') as HTMLInputElement;
        if (input) {
            input.addEventListener('input', debounce(() => {
                store.ui.overridesSearch = input.value;
                store.ui.overridesPage = 1; // Reset to page 1 on search
                renderOverridesPage();
            }, 250));
        }
    } else {
        // Update count
        const countEl = searchBar.querySelector('.overrides-search-count');
        if (countEl) countEl.textContent = `${filteredUsers.length} of ${store.users.length} users`;
    }

    // === RENDER CARDS (paginated subset only) ===
    const fragment = document.createDocumentFragment();
    pageUsers.forEach((user) => {
        // ... existing card generation code (unchanged) ...
    });

    container.innerHTML = '';
    container.appendChild(fragment);

    // === RENDER PAGINATION ===
    renderOverridesPagination(container, filteredUsers.length, safePage, totalPages, pageSize);
}
```

**Step 3: Add pagination controls function (similar pattern to summary).**

#### Impact

- DOM nodes: 22,500 → 750 (97% reduction)
- Search enables finding specific users instantly
- Page navigation is responsive

#### Tests to Write

- Verify only 50 cards rendered when 1500 users exist
- Verify search filters users correctly
- Verify pagination resets to page 1 on search
- Verify pagination controls navigate correctly

---

## Phase 4: Memory & Compute Optimization

### 4.1 Streaming CSV Export

**File:** `js/export.ts`, lines 82–197

#### Current Code (Problem)

```typescript
// js/export.ts:82-197
export function downloadCsv(analysis: UserAnalysis[], fileName: string = 'otplus-report.csv'): void {
    const headers = [...]; // 19 columns
    const rows: string[] = [];

    analysis.forEach((user) => {
        Array.from(user.days.entries()).forEach(([dateKey, day]) => {
            // ... builds rows array with ALL entries
            rows.push(row.join(','));
        });
    });

    const csvContent = headers.join(',') + '\n' + rows.join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    // ...
}
```

**Problem — 4 copies of ~45 MB data = ~180 MB peak:**

1. `rows[]` array — all CSV row strings (~45 MB)
2. `rows.join('\n')` — single concatenated string (~45 MB)
3. `'\uFEFF' + csvContent` — BOM prepended copy (~45 MB)
4. `Blob` internalization — final copy (~45 MB)

At 1500 users × 30 days × ~10 entries × ~200 bytes/row = ~45 MB raw CSV data.

#### Required Fix — Chunked Blob Building

```typescript
// js/export.ts — Replace downloadCsv
import { processInChunks } from './streaming.js';

export async function downloadCsv(
    analysis: UserAnalysis[],
    fileName: string = 'otplus-report.csv'
): Promise<void> {
    const headers = [
        'Date', 'User', 'Description', 'EffectiveCapacityHours',
        'RegularHours', 'OvertimeHours', 'DailyOvertimeHours',
        'WeeklyOvertimeHours', 'OverlapOvertimeHours', 'CombinedOvertimeHours',
        'BillableWorkedHours', 'BillableOTHours', 'NonBillableWorkedHours',
        'NonBillableOTHours', 'TotalHours', 'TotalHoursDecimal',
        'isHoliday', 'holidayName', 'isNonWorkingDay', 'isTimeOff',
    ];

    // Build CSV in chunks — each chunk is a string that Blob will concatenate internally
    const chunks: string[] = ['\uFEFF' + headers.join(',') + '\n'];

    // Process users in chunks of 50 to yield to event loop
    const CHUNK_SIZE = 50;
    for (let i = 0; i < analysis.length; i += CHUNK_SIZE) {
        const userChunk = analysis.slice(i, i + CHUNK_SIZE);
        let chunkCsv = '';

        for (const user of userChunk) {
            for (const [dateKey, day] of user.days.entries()) {
                const entriesToLoop = day.entries.length > 0
                    ? day.entries
                    : [{
                          description: '(no entries)',
                          timeInterval: { start: dateKey + 'T00:00:00Z', duration: 'PT0H' },
                          analysis: { regular: 0, overtime: 0, isBillable: false },
                      }];

                for (const e of entriesToLoop) {
                    const userName = sanitizeFormulaInjection(user.userName);
                    const description = sanitizeFormulaInjection(e.description);
                    const holidayName = sanitizeFormulaInjection(day.meta?.holidayName);

                    const billableWorked = e.analysis?.isBillable ? e.analysis?.regular || 0 : 0;
                    const billableOT = e.analysis?.isBillable ? e.analysis?.overtime || 0 : 0;
                    const nonBillableWorked = !e.analysis?.isBillable ? e.analysis?.regular || 0 : 0;
                    const nonBillableOT = !e.analysis?.isBillable ? e.analysis?.overtime || 0 : 0;
                    const dailyOT = e.analysis?.dailyOvertime || 0;
                    const weeklyOT = e.analysis?.weeklyOvertime || 0;
                    const overlapOT = e.analysis?.overlapOvertime || 0;
                    const combinedOT = e.analysis?.combinedOvertime ?? e.analysis?.overtime ?? 0;
                    const totalHours = e.timeInterval.duration
                        ? parseIsoDuration(e.timeInterval.duration)
                        : 0;

                    const row = [
                        dateKey, userName, description,
                        formatHours(day.meta?.capacity ?? 0),
                        formatHours(e.analysis?.regular || 0),
                        formatHours(e.analysis?.overtime || 0),
                        formatHours(dailyOT), formatHours(weeklyOT),
                        formatHours(overlapOT), formatHours(combinedOT),
                        formatHours(billableWorked), formatHours(billableOT),
                        formatHours(nonBillableWorked), formatHours(nonBillableOT),
                        formatHours(totalHours), formatHoursDecimal(totalHours),
                        day.meta?.isHoliday ? 'Yes' : 'No',
                        holidayName,
                        day.meta?.isNonWorking ? 'Yes' : 'No',
                        day.meta?.isTimeOff ? 'Yes' : 'No',
                    ].map(escapeCsv);

                    chunkCsv += row.join(',') + '\n';
                }
            }
        }

        chunks.push(chunkCsv);

        // Yield to event loop every chunk to prevent UI freezing
        if (i + CHUNK_SIZE < analysis.length) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // Blob concatenates chunks internally without creating intermediate copies
    const blob = new Blob(chunks, { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // ... existing audit logging ...
}
```

#### Cascade Changes

**`js/main.ts:1601-1604`** — Export button handler must become async:

```typescript
// Before:
exportBtn.addEventListener('click', () => {
    if (store.analysisResults) {
        downloadCsv(store.analysisResults);
    }
});

// After:
exportBtn.addEventListener('click', async () => {
    if (store.analysisResults) {
        await downloadCsv(store.analysisResults);
    }
});
```

#### Impact

- Peak memory: ~180 MB → ~50 MB (72% reduction)
- UI stays responsive during export (yields to event loop)

#### Tests to Write

- Verify CSV output matches original for small datasets (byte-for-byte except chunking)
- Verify async function signature works correctly
- Verify `streaming.ts` integration (if `processInChunks` is used)

---

### 4.2 IndexedDB for Report Cache (Replace sessionStorage)

**File:** `js/state.ts`, lines 1612–1679

#### Current Code (Problem)

```typescript
// js/state.ts:1612-1633 — getCachedReport
getCachedReport(key: string): TimeEntry[] | null {
    const cached = safeSessionGetItem(STORAGE_KEYS.REPORT_CACHE);
    // ...
}

// js/state.ts:1660-1679 — setCachedReport
setCachedReport(key: string, entries: TimeEntry[]): void {
    const cache = { key, timestamp: Date.now(), entries };
    safeSessionSetItem(STORAGE_KEYS.REPORT_CACHE, JSON.stringify(cache));
    // ...
}
```

**Problem:** `sessionStorage` has a 5 MB limit (most browsers). For 100K+ time entries serialized as JSON, the data easily exceeds 5 MB. The cache silently fails with no error visible to the user, and every subsequent report generation re-fetches everything.

#### Required Fix — IndexedDB with Graceful Fallback

```typescript
// js/state.ts — Add IndexedDB helper (private module-level or in a new idb-cache.ts)

const IDB_DB_NAME = 'otplus_cache';
const IDB_STORE_NAME = 'reports';
const IDB_VERSION = 1;

function openCacheDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
                db.createObjectStore(IDB_STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Replace getCachedReport with async version
async getCachedReport(key: string): Promise<TimeEntry[] | null> {
    try {
        const db = await openCacheDb();
        return new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE_NAME, 'readonly');
            const store = tx.objectStore(IDB_STORE_NAME);
            const request = store.get('report');
            request.onsuccess = () => {
                const cache = request.result as ReportCache | undefined;
                if (!cache || cache.key !== key) { resolve(null); return; }
                if (Date.now() - cache.timestamp > REPORT_CACHE_TTL) { resolve(null); return; }
                resolve(cache.entries);
            };
            request.onerror = () => resolve(null);
        });
    } catch {
        // Fallback: IndexedDB unavailable, treat as cache miss
        return null;
    }
}

// Replace setCachedReport with async version
async setCachedReport(key: string, entries: TimeEntry[]): Promise<void> {
    try {
        const db = await openCacheDb();
        const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
        const store = tx.objectStore(IDB_STORE_NAME);
        store.put({ key, timestamp: Date.now(), entries }, 'report');
        // Fire-and-forget — don't await transaction completion
    } catch (e) {
        stateLogger.warn('Failed to cache report data in IndexedDB:', e);
    }
}
```

#### Cascade Changes

All callers of `getCachedReport` and `setCachedReport` in `js/main.ts` must be updated to use `await`:

```typescript
// Before:
const cached = store.getCachedReport(cacheKey);
// After:
const cached = await store.getCachedReport(cacheKey);

// Before:
store.setCachedReport(cacheKey, entries);
// After:
await store.setCachedReport(cacheKey, entries);
```

(The `setCachedReport` can be fire-and-forget if performance is preferred over confirmation.)

#### Impact

- sessionStorage: 5 MB limit → IndexedDB: No practical limit (hundreds of MB)
- Cache works reliably for 450K+ entries
- Graceful fallback if IndexedDB is unavailable (e.g., private browsing in some browsers)

#### Tests to Write

- Mock IndexedDB → verify write and read roundtrip
- Verify cache key mismatch returns null
- Verify expired cache returns null
- Verify IndexedDB unavailable → graceful fallback (null returned, no crash)

---

### 4.3 Eliminate Redundant Sorts in Calc Engine

**File:** `js/calc.ts`, lines 1759, 1824, 1891

#### Current Code (Problem)

The calc engine sorts entries **3 times per user-day** in 'both' mode:

```typescript
// Line 1759 — Daily overtime pass:
const sortedEntries = [...dayEntries].sort((a, b) => {
    const aStart = a.timeInterval?.start;
    const bStart = b.timeInterval?.start;
    if (!aStart || !bStart) return 0;
    return aStart.localeCompare(bStart);
});

// Line 1824 — Weekly overtime pass (per-week entries):
const sortedEntries = [...weekEntries].sort((a, b) => {
    const aStart = a.timeInterval?.start;
    const bStart = b.timeInterval?.start;
    if (!aStart || !bStart) return 0;
    return aStart.localeCompare(bStart);
});

// Line 1891 — Combined/both pass:
const sortedEntries = [...dayEntries].sort(
    (a, b) => (a.timeInterval?.start || '').localeCompare(b.timeInterval?.start || '')
);
```

For 1500 users × 30 days × ~10 entries/day = **45,000 sort operations** (3 sorts × 15,000 user-days), each creating a copy of the entries array.

#### Required Fix — Pre-sort Once in Context Initialization

At the point where `dayContextByDate` is populated (line ~1725), pre-sort the entries and store them:

```typescript
// js/calc.ts — In the dayContextByDate.set() call (~line 1725), add sortedEntries:
dayContextByDate.set(dateKey, {
    entries: dayEntries,
    sortedEntries: [...dayEntries].sort((a, b) => {
        const aStart = a.timeInterval?.start;
        const bStart = b.timeInterval?.start;
        if (!aStart || !bStart) return 0;
        return aStart.localeCompare(bStart);
    }),
    meta: dayMeta,
    baseCapacity,
    effectiveCapacity,
    isHolidayDay,
    isNonWorking,
    isTimeOffDay,
    timeOffHours: timeOff?.hours || 0,
    forceOvertime,
});
```

Then replace all 3 sort sites:

```typescript
// Line 1759 — Daily pass:
const sortedEntries = context.sortedEntries;

// Line 1891 — Both pass:
const sortedEntries = context.sortedEntries;
```

For the weekly pass (line 1824), entries are bucketed by week, so they need a different sort. However, since weekly entries are already a subset of the day entries (which are sorted), you can either:
- Keep the weekly sort as-is (it operates on smaller arrays)
- Or collect pre-sorted entries into week buckets maintaining order

The daily and combined passes give the biggest savings.

#### Impact

- ~30-40% calc time reduction in 'both' mode
- Fewer array copies (15,000 fewer `[...dayEntries]` spreads)

#### Type Change Required

Update the day context type to include `sortedEntries: TimeEntry[]`.

#### Tests to Write

- Verify calculation results are identical before and after optimization
- Verify `sortedEntries` is correctly sorted chronologically
- Benchmark: calc time for 1500 users should be measurably faster

---

### 4.4 Increase Worker Pool and Shard Calculations

**File:** `js/main.ts`, line 2383; `js/calc.worker.ts`

#### Current Code

```typescript
// js/main.ts:2381-2383
calculationWorkerPool = await createWorkerPool<WorkerPayload, WorkerResult>(
    'js/calc.worker.js',
    { poolSize: 1, maxQueueSize: 10, taskTimeout: 60000, autoRestart: true }
);
```

**Problem:** `poolSize: 1` means all calculations run in a single worker thread — no parallelism.

#### Required Fix

```typescript
// js/main.ts:2381-2383 — Increase pool size and timeout
const poolSize = Math.min(navigator.hardwareConcurrency || 4, 4);
calculationWorkerPool = await createWorkerPool<WorkerPayload, WorkerResult>(
    'js/calc.worker.js',
    { poolSize, maxQueueSize: 10, taskTimeout: 120000, autoRestart: true }
);
```

#### Sharding Strategy

Partition users across workers by userId:

```typescript
// In the calculation dispatch logic:
const workerCount = calculationWorkerPool.getPoolSize();
const userShards: Map<string, TimeEntry[]>[] = Array.from(
    { length: workerCount },
    () => new Map()
);

// Distribute entries by userId hash
for (const entry of entries) {
    const shardIndex = simpleHash(entry.userId) % workerCount;
    const shard = userShards[shardIndex];
    if (!shard.has(entry.userId)) shard.set(entry.userId, []);
    shard.get(entry.userId)!.push(entry);
}

// Dispatch shards to workers
const shardResults = await Promise.all(
    userShards.map((shard, idx) =>
        calculationWorkerPool.execute({
            entries: Array.from(shard.values()).flat(),
            // ... other calc params
        })
    )
);

// Merge results
const mergedResults = mergeWorkerResults(shardResults);
```

#### Risk Assessment

**HIGH RISK** — This changes the calculation dispatch fundamentally. Must:
- Preserve main-thread fallback (if worker pool init fails)
- Verify merged results match single-worker results exactly
- Test with varying worker counts (1, 2, 4)

#### Tests to Write

- Verify sharding produces correct results (compare with single-worker)
- Verify main-thread fallback still works
- Verify `taskTimeout: 120000` doesn't cause premature kills

---

### 4.5 Memoize Hot Pure Functions

**File:** `js/utils.ts`

#### Targets

**`parseIsoDuration`** (line 621) — Called ~450K times (once per entry), but only a few dozen unique duration strings exist (e.g., "PT8H", "PT30M", "PT1H30M").

```typescript
// js/utils.ts:621-632
export function parseIsoDuration(durationStr: string | null | undefined): number {
    if (!durationStr) return 0;
    const match = durationStr.match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!match) return 0;
    const hours = parseFloat(match[1] || '0');
    const minutes = parseFloat(match[2] || '0');
    const seconds = parseFloat(match[3] || '0');
    return hours + minutes / 60 + seconds / 3600;
}
```

**`classifyEntryForOvertime`** (line 914) — Called ~225K times, only ~3 unique type values ("REGULAR", "BREAK", "TIME_OFF").

```typescript
// js/utils.ts:914-935
export function classifyEntryForOvertime(entry: EntryLike | null | undefined): EntryClassification {
    if (!entry || !entry.type) return 'work';
    const type = String(entry.type).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (type === 'BREAK') return 'break';
    if (type === 'HOLIDAY' || type === 'TIME_OFF' || type === 'TIMEOFF' ||
        type === 'HOLIDAY_TIME_ENTRY' || type === 'TIME_OFF_TIME_ENTRY') return 'pto';
    return 'work';
}
```

#### Required Fix

```typescript
// js/utils.ts — Add memoization caches

const _parseIsoDurationCache = new Map<string, number>();
const _classifyEntryCache = new Map<string, EntryClassification>();

/**
 * Clears all memoization caches.
 * Call at the start of each calculation to prevent stale data.
 */
export function clearMemoizationCaches(): void {
    _parseIsoDurationCache.clear();
    _classifyEntryCache.clear();
}

// Update parseIsoDuration:
export function parseIsoDuration(durationStr: string | null | undefined): number {
    if (!durationStr) return 0;

    const cached = _parseIsoDurationCache.get(durationStr);
    if (cached !== undefined) return cached;

    const match = durationStr.match(/PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
    if (!match) {
        _parseIsoDurationCache.set(durationStr, 0);
        return 0;
    }
    const hours = parseFloat(match[1] || '0');
    const minutes = parseFloat(match[2] || '0');
    const seconds = parseFloat(match[3] || '0');
    const result = hours + minutes / 60 + seconds / 3600;

    _parseIsoDurationCache.set(durationStr, result);
    return result;
}

// Update classifyEntryForOvertime:
export function classifyEntryForOvertime(entry: EntryLike | null | undefined): EntryClassification {
    if (!entry || !entry.type) return 'work';

    const typeKey = String(entry.type);
    const cached = _classifyEntryCache.get(typeKey);
    if (cached !== undefined) return cached;

    const type = typeKey.trim().toUpperCase().replace(/[\s-]+/g, '_');

    let result: EntryClassification = 'work';
    if (type === 'BREAK') result = 'break';
    else if (type === 'HOLIDAY' || type === 'TIME_OFF' || type === 'TIMEOFF' ||
             type === 'HOLIDAY_TIME_ENTRY' || type === 'TIME_OFF_TIME_ENTRY') result = 'pto';

    _classifyEntryCache.set(typeKey, result);
    return result;
}
```

**Call `clearMemoizationCaches()` at the start of `calculateAnalysis`:**

```typescript
// js/calc.ts — At the top of calculateAnalysis function:
import { clearMemoizationCaches } from './utils.js';

export function calculateAnalysis(...): UserAnalysis[] {
    clearMemoizationCaches();
    // ... existing code ...
}
```

#### Impact

- `parseIsoDuration`: 450K regex matches → ~50 regex matches + 449,950 Map lookups
- `classifyEntryForOvertime`: 225K string operations → ~3 string ops + 224,997 Map lookups
- Estimated: 5-10% overall calc time reduction

#### Tests to Write

- Verify `parseIsoDuration` returns same values after memoization
- Verify `classifyEntryForOvertime` returns same values after memoization
- Verify `clearMemoizationCaches` resets state
- Verify cache correctness with multiple unique inputs

---

### 4.6 Integrate `streaming.ts` Utilities

**File:** `js/streaming.ts` (currently unused in production)

#### Current Status

The file is fully implemented with:
- `processInChunks` — Generic chunked array processing with progress/abort
- `splitIntoBatches` — Array → batch array splitter
- `calculateOptimalChunkSize` — Adaptive chunk sizing
- `ChunkedProcessor` — Reusable processor class
- `mapInChunks`, `filterInChunks`, `reduceInChunks` — Convenience wrappers

**`splitIntoBatches` is now used** in `js/api.ts` for all batch processing loops. Other utilities remain available for future use.

#### Integration Points

1. **`js/api.ts` batch loops** — Replace manual `for (let i = 0; i < users.length; i += BATCH_SIZE)` with `splitIntoBatches(users, BATCH_SIZE)`:

```typescript
// Before:
for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    // ...
}

// After:
import { splitIntoBatches } from './streaming.js';
for (const batch of splitIntoBatches(users, BATCH_SIZE)) {
    // ...
}
```

2. **`js/export.ts` CSV chunking** — Use `processInChunks` for the user-chunk processing loop (as shown in 4.1).

3. **Progressive rendering** — If needed, use `calculateOptimalChunkSize` to determine how many DOM elements to create per frame.

#### Impact

- Cleaner code (no manual index arithmetic)
- Built-in progress callbacks and abort support
- No functional change — purely structural improvement

---

## Phase 5: Testing & Verification

### Unit Tests (Per Phase)

| Phase | Test File | Coverage |
|-------|-----------|----------|
| 1.1 | `__tests__/api.fetchUsers.test.ts` | Pagination, abort, partial results |
| 1.2 | `__tests__/constants.test.ts` | New limit values |
| 1.3 | `__tests__/api.fetchTimeOff.test.ts` | Pagination, abort, response formats |
| 2.1 | `__tests__/api.batchSize.test.ts` | Rate limiter interaction |
| 2.2 | `__tests__/api.holidayDedup.test.ts` | Sample-and-propagate, fallback |
| 2.3 | `__tests__/api.profileRetry.test.ts` | Batched retries |
| 3.1-3.2 | `__tests__/ui/detailed.cache.test.ts` | Cache invalidation, filter subsets |
| 3.3 | `__tests__/ui/summary.pagination.test.ts` | Paginated rendering |
| 3.4 | `__tests__/ui/overrides.pagination.test.ts` | Search + pagination |
| 4.1 | `__tests__/export.streaming.test.ts` | Output correctness, async |
| 4.2 | `__tests__/state.indexeddb.test.ts` | IDB roundtrip, fallback |
| 4.3 | `__tests__/calc.presort.test.ts` | Sorted entry reuse, correctness |
| 4.5 | `__tests__/utils.memoization.test.ts` | Cache hits, clearing |

### Performance Benchmarks

Create `__tests__/performance/large-workspace.test.js`:

```javascript
describe('Large Workspace Performance (1500 users)', () => {
    // Generate synthetic data: 1500 users, 30 days, ~10 entries/day
    const syntheticUsers = generateSyntheticUsers(1500);
    const syntheticEntries = generateSyntheticEntries(1500, 30, 10);

    test('Calculation completes under 5s', () => {
        const start = performance.now();
        const results = calculateAnalysis(syntheticEntries, syntheticUsers, ...);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(5000);
    });

    test('Summary render (paginated) completes under 100ms', () => {
        // Mock DOM
        const start = performance.now();
        renderSummaryTable(syntheticAnalysis);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(100);
    });

    test('Detailed page change completes under 50ms', () => {
        // Pre-populate cache
        renderDetailedTable(syntheticAnalysis);
        store.ui.detailedPage = 2;
        const start = performance.now();
        renderDetailedTable(syntheticAnalysis);
        const elapsed = performance.now() - start;
        expect(elapsed).toBeLessThan(50);
    });

    test('CSV export peak memory under 100MB', () => {
        // Use performance.measureUserAgentSpecificMemory() if available
        // or estimate from chunk count × chunk size
    });
});
```

### Regression Commands

Run after each phase:

```bash
npm test                # 84 suites / 2979 tests — must all pass
npm run typecheck       # After every file change
npm run test:e2e        # After Phases 3-4 (UI changes)
npm run test:coverage   # Maintain 80% threshold
```

### E2E Testing

- Existing 237 E2E tests must pass unchanged
- New spec: Large workspace with 100+ mocked users validates pagination controls appear and function

---

## Critical Files Reference

| File | Lines of Interest | Phases | Summary of Changes |
|------|-------------------|--------|-------------------|
| `js/api.ts` | 362, 1467-1472, 1766-1778, 1874-1907, 1918-1942, 1949-1959, 1986-2035 | 1, 2 | Pagination fixes, batch size, holiday dedup, retry batching, progress |
| `js/constants.ts` | 182, 188, new lines | 1, 2 | Page limits raised, batch size constant, entry limit |
| `js/main.ts` | 913, 1601-1604, 2076, 2116, 2381-2383 | 1, 2, 4 | Abort signal pass-through, async export, progress UI, worker pool config |
| `js/ui/detailed.ts` | 142-157, 160-166 | 3 | Entry cache, filter caches |
| `js/ui/summary.ts` | 620-657 | 3 | Pagination (100 rows/page) |
| `js/ui/overrides.ts` | 50-161 | 3 | Search + pagination (50 cards/page) |
| `js/export.ts` | 82-197 | 4 | Streaming Blob-based export (async) |
| `js/state.ts` | 385-398, 1612-1679 | 3, 4 | UIState additions, IndexedDB cache |
| `js/calc.ts` | 1725, 1759, 1824, 1891 | 4 | Pre-sort optimization |
| `js/calc.worker.ts` | sharding dispatch | 4 | User-filter sharding support |
| `js/utils.ts` | 621-632, 914-935 | 4 | Memoization caches |
| `js/streaming.ts` | entire file | 4 | Finally integrated into production code |

---

## Implementation Order

All phases completed 2026-03-07.

```
Phase 1 (P0 correctness) ✅
  1.1 Paginate fetchUsers ✅ (T62 audit)
  1.2 Raise entry pagination limits ✅
  1.3 Paginate fetchTimeOffRequests ✅ (T63 audit)

Phase 2 (API performance) ✅
  2.1 Increase BATCH_SIZE to 20 ✅
  2.2 Holiday deduplication ✅
  2.3 Batch profile retries ✅
  2.4 Progress callbacks ✅

Phase 3 (UI) ✅
  3.1 Cache detailed entries ✅
  3.2 Pre-compute filter subsets ✅
  3.3 Paginate summary table ✅
  3.4 Paginate + search overrides ✅

Phase 4 (Memory/Compute) ✅
  4.1 Streaming CSV export ✅
  4.2 IndexedDB report cache ✅
  4.3 Eliminate redundant sorts ✅
  4.4 Increase worker pool (no sharding) ✅
  4.5 Memoize hot functions ✅
  4.6 Integrate streaming.ts ✅

Phase 5 (Verification) ✅
  - Full regression suite ✅ (93 suites / 3287 tests)
  - Coverage check ✅ (all >80%)
  - E2E ✅ (236/237, transient flakes pass on repro)
```

### Risk Matrix

| Item | Risk | Impact | Mitigation |
|------|------|--------|-----------|
| 1.1 fetchUsers pagination | Low | Critical | Standard pagination pattern, easy to test |
| 1.2 Raise limits | Low | Critical | Config change only, no logic change |
| 1.3 fetchTimeOff pagination | Low | Critical | Similar pattern to 1.1 |
| 2.1 BATCH_SIZE increase | Low | High | Rate limiter handles overflow |
| 2.2 Holiday dedup | Medium | High | JSON comparison can have edge cases; fallback exists |
| 2.3 Batched retry | Low | Medium | Same pattern as initial fetch |
| 2.4 Progress callbacks | Low | Medium | Pure additive, no existing behavior changed |
| 3.1-3.2 Detailed cache | Low | High | Reference identity check, explicit invalidation |
| 3.3 Summary pagination | Medium | High | New UI element, needs E2E coverage |
| 3.4 Overrides search+page | Medium | High | New UI elements, debounced search |
| 4.1 Streaming CSV | Medium | High | Async signature change cascades |
| 4.2 IndexedDB cache | Medium | Medium | Async change cascades; graceful fallback |
| 4.3 Calc pre-sort | Low | Medium | Pure optimization, same output |
| 4.4 Worker sharding | **HIGH** | High | Fundamental calc dispatch change; preserve fallback |
| 4.5 Memoization | Low | Medium | Cache clear at calc start prevents staleness |
| 4.6 streaming.ts integration | Low | Low | Structural improvement only |
