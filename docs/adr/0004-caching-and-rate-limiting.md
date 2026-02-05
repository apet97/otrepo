# 0004. Caching and rate limiting strategy

Date: 2026-01-18

## Status
Accepted

## Context
Large workspaces (100+ members) need fast report generation. Clockify API calls have rate limits.
We also need graceful behavior on partial failures and a way to retry failed fetches.

## Decision
Rate limiting:
- Implement a request scheduler enforcing addon limits when using X-Addon-Token.
- On HTTP 429: exponential backoff + jitter and retry up to a capped maximum.

Caching:
- Cache profiles, holidays (and time off, when enabled) in localStorage, workspace-scoped.
- Use TTL (time-based) and versioned cache keys.
- Cache only what’s required for computation; avoid storing large raw payloads when possible.

Fetching strategy:
- Batch fetches per dataset (users/profiles/holidays/time entries).
- Support cancellation via AbortController.
- Track per-dataset errors and enable “Retry failed fetches” without rerunning all steps.

## Consequences
- Significant speedup for repeated reporting.
- Lower risk of 429s and better recovery when they occur.
- Requires careful cache invalidation/versioning discipline.

## Implementation Notes (Added 2026-01-29)

### Rate Limiting Implementation
- **Token bucket**: Client-side rate limiter in `js/api.ts` with configurable refill rate.
- **Retry-After header**: Respected when present; fallback to exponential backoff (1s, 2s, 4s...).
- **Maximum total retry time**: 2-minute cap prevents infinite retry loops under sustained load.
- **Per-request tracking**: `store.incrementThrottleRetry()` updates UI with retry status.

### Caching Implementation
- **localStorage keys**: `otplus_config`, `otplus_overrides_<workspaceId>`, `otplus_ui_state`.
- **sessionStorage keys**: Report results cached per session for quick date range changes.
- **TTL**: Profile/holiday caches use 6-hour TTL (DATA_CACHE_TTL in constants.ts).
- **Private browsing**: Graceful degradation with console warnings when localStorage unavailable.

### Fetching Implementation
- **AbortController**: Passed to all `fetchWithAuth` calls for cancellation support.
- **Batch fetching**: Users, profiles, holidays, time-off fetched in sequence with progress updates.
- **Partial failure handling**: Non-critical fetches (profiles, holidays) fail gracefully; core data (users, entries) show error state.
