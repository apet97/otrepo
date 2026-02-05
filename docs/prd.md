# OTPLUS v2.0.0 — Product Requirements Document

**Project:** Overtime Summary Addon (OTPLUS)
**Version:** 2.0.0
**Date:** January 2026
**Status:** Implementation Complete / Optimized

---

## 1. Background
OTPLUS is a high-performance Clockify addon that provides advanced overtime analysis. It allows managers and payroll admins to accurately track working hours, capacity utilization, and billable hour breakdowns while respecting individual employee schedules and regional holidays.

---

## 2. Problem Statement
The v2.0 baseline suffered from performance bottlenecks when handling large teams, lacked persistence for user settings, and had minor accuracy issues due to timezone shifts. Users also lacked safe restart/abort handling for long-running reports and struggled to navigate massive detailed logs efficiently.

---

## 3. Goals & Improvements

### 3.1 Performance & Reliability
- **Parallel Data Orchestration:** OTPLUS fetches Time Entries, Member Profiles, Holidays, and Time Off requests concurrently using `Promise.all`.
- **Iterative Rate Limiting:** Implements a global client-side token bucket (50 req/s) with an iterative wait loop to ensure stack safety and strict API compliance.
- **Request Cancellation:** Aborts pending network activity via `AbortController` when a new report starts (no manual cancel button).
- **Persistent Data Caching:** Profiles, holidays, and time-off maps are cached in localStorage (6-hour TTL) to reduce repeat fetches for large teams.
- **Report Cache Prompt:** Session-scoped report data is cached with a user prompt to reuse or refresh for the latest data.
- **Large Range Confirmation:** Date ranges over 365 days require explicit confirmation to avoid accidental long-running reports.

### 3.2 Accuracy & Compliance
- **Timezone Awareness:** Uses a canonical timezone (viewer profile timezone → workspace claim → browser default) for date grouping, ensuring evening work is attributed to the correct calendar day rather than shifting to the next day in UTC.
- **Holiday Compliance:** Strictly adheres to the API requirement for full ISO 8601 datetime formatting.
- **Precision Math:** All duration and cost calculations use `utils.round()` to eliminate floating-point drift.
- **Overtime Basis Options:** Supports daily, weekly, and combined overtime bases for flexible payroll policies.
- **Partial Time-Off Hours:** Half-day requests use provided hours (or period duration) instead of assuming full-day absence.

### 3.3 Enhanced UX/UI
- **Persisted Configuration:** User preferences (toggles, thresholds) are automatically saved to `localStorage`, eliminating repetitive configuration.
- **Decimal Time Toggle:** UI can render time values in decimal hours (e.g., `8.50`) or `xh ym` without changing calculations.
- **Detailed Log Pagination:** High-performance rendering of granular entry logs using client-side pagination (50 entries per page).
- **Detailed Columns Fit:** Detailed view prioritizes time, rate, and money columns; status badges replace the Description column to prevent clipping.
- **Quick Selectors:** One-click presets for "Last Month" and "This Month" date ranges.
- **Accessibility:** Full ARIA support (`aria-live`, `aria-busy`) for dynamic updates and screen reader compatibility.
- **Theme Support:** Automatic application of Dark Mode if the user's Clockify profile preference is set to DARK.
- **Billability Suppression:** When billability is disabled and no rates/amounts exist, OTPLUS hides money columns and the billable breakdown.

---

## 4. Functional Requirements

### 4.1 Advanced Capacity Engine
- **Source Precedence:** 
  1. Manual UI Override
  2. Member Profile `workCapacity` (API)
  3. Global Default (Configurable)
- **Anomaly Detection:** Automatically sets `capacity = 0` for holidays, off-days (per profile `workingDays`), and full-day time-off requests.
- **PTO Entries:** HOLIDAY/TIME_OFF entry types are informational only and do not adjust capacity; capacity changes come from API holiday/time-off maps when enabled.

### 4.2 Calculation Specification (Tail Attribution)
- Entries are sorted chronologically. 
- Regular hours are allocated first until daily capacity is reached.
- All remaining time in subsequent entries is categorized as Overtime.
- Billable and Non-Billable metrics are tracked independently for both Regular and OT buckets.
- Weekly basis mode uses `weeklyThreshold` and Monday-based weeks; combined mode reports the max of daily/weekly OT plus overlap tracking.

### 4.3 Secure Data Export
- **CSV Sanitization:** Implements "Smart Escaping" to double-quote fields only when necessary.
- **Formula Injection Protection:** Prevents CSV injection attacks by prepending a single quote (`'`) to any field starting with `=`, `+`, `-`, or `@`.
- **Decimal Hours Column:** Adds `TotalHoursDecimal` to CSV output while preserving existing columns.
- **Overtime Breakdown Columns:** Adds daily/weekly/overlap/combined OT columns for audit-friendly exports.

---

## 5. UI/UX Requirements
- **Density Settings:** Supports `compact` and `spacious` layout modes via body classes.
- **Feedback Loops:** Real-time API status banner alerts users to partial failures (e.g., specific profiles failing to load) while allowing the report to finish using fallback values.
- **Interactive Reports:** Tabbed navigation between Summary (aggregated) and Detailed (granular) views with active filter chips.
- **Detailed Headers:** Columns include Rate (`Rate $/h`) and money breakdown (`Regular $`, `OT $`, `T2 $`, `Total $`) plus Status tags.

---

## 6. Success Metrics
- **Load Time:** < 3 seconds for workspaces with 50+ users.
- **Zero Freeze:** UI remains responsive during massive data fetches due to pagination and parallelization.
- **Persistence:** 100% of configuration choices survive a browser reload.

### Code Quality Metrics
- **Unit Tests**: 2908 passing across 68 test files
- **Unit Test Coverage**: 95.77% lines, 94.71% branches
- **Mutation Score**: 100% for all core modules (calc.ts, utils.ts, api.ts)

## 7. Operational Guide & APIs
- **Guide:** `docs/guide.md` documents what OTPLUS consumes (modules, storage, UI toggles) and enumerates every Clockify API request it issues.
- **Runbook:** When diagnosing failures, consult the guide’s API list to confirm rate limits/history and fallbacks for holidays/profiles/time-off before touching the UI or storage layers.
