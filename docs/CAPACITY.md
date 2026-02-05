# OTPLUS Capacity & Scalability Guide

**Version:** 2.0.0
**Last Updated:** February 2026

---

## Overview

This document describes the scalability limits, performance characteristics, and capacity planning guidelines for the OTPLUS overtime summary addon.

---

## Supported Limits

### Time Entries

| Metric | Recommended Limit | Hard Limit | Notes |
|--------|-------------------|------------|-------|
| Entries per report | 10,000 | 100,000 | Performance degrades beyond 10k |
| Date range | 90 days | 365 days | 1 year maximum per report |
| Pages fetched | 50 | 500 | 200 entries per page |

### Users

| Metric | Recommended Limit | Hard Limit | Notes |
|--------|-------------------|------------|-------|
| Users per workspace | 500 | 1,000 | API calls scale linearly |
| Users with overrides | 100 | Unlimited | localStorage size constraint |
| Concurrent profiles | 500 | 1,000 | Memory constraint |

### Storage

| Resource | Default Size | Maximum | Notes |
|----------|--------------|---------|-------|
| localStorage (config) | ~2 KB | 5 MB | Browser limit |
| localStorage (overrides) | ~1 KB per user | 5 MB total | Per workspace |
| localStorage (cache) | ~50 KB | 5 MB total | Profiles, holidays, time-off |
| sessionStorage (report) | ~500 KB | 5 MB | TTL: 5 minutes |
| Memory (entries) | ~50 MB | ~200 MB | Depends on entry size |

---

## Performance Characteristics

### Calculation Engine

The calculation engine (`calc.ts`) processes entries in O(n) time where n = number of entries.

| Dataset Size | Expected Time | Memory Usage |
|--------------|---------------|--------------|
| 100 entries | < 10ms | ~1 MB |
| 1,000 entries | < 50ms | ~5 MB |
| 5,000 entries | < 200ms | ~25 MB |
| 10,000 entries | < 500ms | ~50 MB |
| 50,000 entries | < 2.5s | ~250 MB |

**Note:** Times measured on modern desktop hardware (M1/Intel i7 equivalent). Datasets with 500+ entries are automatically offloaded to a Web Worker pool to keep the UI responsive during calculation.

### API Performance

API call patterns and their typical response times:

| Operation | API Calls | Expected Time | Notes |
|-----------|-----------|---------------|-------|
| Fetch users (100) | 1 | ~200ms | Single paginated request |
| Fetch entries (1 month) | 1-5 | ~1-2s | Depends on entry count |
| Fetch profiles (100 users) | 20 batches | ~2-3s | 5 users per batch |
| Fetch holidays (100 users) | 20 batches | ~3-5s | Slowest operation |
| Fetch time-off (all users) | 1 | ~500ms | Single bulk request |

**Total Time (100 users, 1 month):** 5-10 seconds typical

### Rate Limiting

The addon implements a token bucket rate limiter:

- **Capacity:** 50 requests
- **Refill Rate:** 50 tokens/second
- **Burst Handling:** Up to 50 concurrent requests

If Clockify returns a 429 (rate limit), the addon:
1. Waits for the `Retry-After` duration
2. Retries up to 2 times
3. Shows a rate limit banner if throttled

---

## Memory Guidelines

### Browser Tab Memory

| Component | Typical Usage | Peak Usage |
|-----------|---------------|------------|
| Base application | 10 MB | 15 MB |
| 1,000 entries | 15 MB | 25 MB |
| 10,000 entries | 60 MB | 100 MB |
| Web Worker | 5 MB | 20 MB |

**Recommended:** Keep browser tab memory under 200 MB total

### Garbage Collection

The addon clears intermediate data structures after calculation:
- Entry groupings cleared after analysis
- Temporary Maps released after merging
- Worker terminates after calculation complete

---

## Scaling Recommendations

### For Small Teams (< 20 users)

- Default configuration works well
- 90-day date ranges are feasible
- All features enabled

### For Medium Teams (20-100 users)

- Consider 30-day date ranges
- Use cached reports when possible
- Monitor rate limit banner

### For Large Teams (100-500 users)

- Limit date ranges to 14-30 days
- Enable pagination truncation warnings
- Consider generating reports by department/team
- Clear cache regularly

### For Enterprise (500+ users)

- Generate reports in chunks (by team)
- Use maximum 7-14 day date ranges
- Disable profile capacity for faster loads
- Consider exporting to external tools

---

## Browser Compatibility

### Minimum Requirements

| Browser | Minimum Version | Notes |
|---------|-----------------|-------|
| Chrome | 90+ | Recommended |
| Firefox | 88+ | Fully supported |
| Safari | 14+ | Fully supported |
| Edge | 90+ | Chromium-based |

### Storage Availability

Storage may be limited in:
- Private/Incognito browsing modes
- Enterprise-managed browsers with restrictions
- Mobile browsers with aggressive memory management

The addon includes an in-memory fallback for these scenarios.

---

## Monitoring & Diagnostics

### Built-in Diagnostics

Access diagnostic information via browser console:

```javascript
// Get current state diagnostics
window.__OTPLUS_DIAGNOSTICS__()

// Returns:
// {
//   version: "2.0.0",
//   cacheStats: { profilesCount, holidaysCount, ... },
//   apiStatus: { profilesFailed, holidaysFailed, ... },
//   throttleStatus: { retryCount, lastRetryTime }
// }
```

### Circuit Breaker Status

The API client includes a circuit breaker that opens after 5 consecutive failures:

```javascript
// Check circuit breaker status (from api.ts export)
// When open, API requests return 503 immediately
// Auto-recovers after 30 seconds
```

### Performance Metrics (Enable Debug Mode)

```javascript
// Enable detailed timing logs
localStorage.setItem('otplus_debug', 'true');

// Disable debug mode
localStorage.removeItem('otplus_debug');
```

---

## Known Limitations

1. **Holiday API Bottleneck:** Per-user sequential calls are slowest
2. **No Streaming:** All entries loaded before calculation
3. **Single-threaded Calculation:** Worker is single-threaded
4. **localStorage Size:** 5 MB browser limit applies
5. **Date Range Maximum:** 365 days enforced for performance

---

## Capacity Planning Checklist

- [ ] Estimate user count in workspace
- [ ] Estimate average entries per user per day
- [ ] Calculate expected entries: `users × days × entries_per_day`
- [ ] Verify entries < 10,000 for optimal performance
- [ ] Plan report frequency (daily, weekly, monthly)
- [ ] Consider team/department segmentation for large workspaces

---

*For questions or to report performance issues, please file an issue at the project repository.*
