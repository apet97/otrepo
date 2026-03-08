/**
 * @fileoverview Report Generation & Calculation Orchestration
 *
 * Main orchestrator for report generation: validates dates, fetches data,
 * handles caching, triggers calculation, updates UI.
 * Extracted from main.ts to reduce module size (CQ-1).
 */

import { store } from './state.js';
import { Api } from './api.js';
import * as UI from './ui/index.js';
import { IsoUtils, parseIsoDuration, getDateRangeDays } from './utils.js';
import { reportError } from './error-reporting.js';
import { REPORT_GENERATION_TIMEOUT_MS } from './constants.js';
import { runCalculation } from './worker-manager.js';
import { syncAmountDisplayAvailability } from './config-manager.js';
import type { DateRange, TimeEntry } from './types.js';

// ============================================================================
// REPORT GENERATION & CALCULATION
// ============================================================================
// Main orchestration logic: validate dates, fetch data, calculate analysis, render UI.
// Includes concurrency control (AbortController) and caching (sessionStorage).
// ============================================================================

/**
 * Reference to the AbortController for the active report generation request.
 * Used to cancel in-flight API calls if a new report generation starts.
 * @see handleGenerateReport() for usage pattern
 */
let abortController: AbortController | null = null;

/**
 * Request ID counter to detect stale responses from concurrent requests.
 * Incremented on each new report generation request.
 * Used to ensure only the most recent request updates the UI.
 * @see handleGenerateReport() for usage pattern
 */
let currentRequestId = 0;

/** Calls timer.unref() when available (Node.js timers), no-op in browsers. */
function unrefTimerIfSupported(timerId: ReturnType<typeof setTimeout> | null): void {
    if (!timerId || typeof timerId !== 'object') return;
    const maybeTimer = timerId as { unref?: () => void };
    if (typeof maybeTimer.unref === 'function') {
        maybeTimer.unref();
    }
}

/**
 * Orchestrates the complete report generation workflow.
 *
 * This is the main orchestrator function that coordinates:
 * 1. Date validation and range safeguards
 * 2. Cache checks (reuse recent results if unchanged)
 * 3. Data fetching (entries, profiles, holidays, time-off)
 * 4. Graceful error handling (optional fetches can fail without blocking)
 * 5. Calculation delegation
 * 6. UI rendering
 *
 * @param forceRefresh - If true, bypasses cache and fetches fresh data from Clockify API
 */
/* eslint-disable complexity, max-lines-per-function -- Report generation orchestrates many API calls, UI updates, and error handling */
export async function handleGenerateReport(forceRefresh = false): Promise<void> {
    // ===== Concurrency Control =====
    if (abortController) {
        abortController.abort();
    }

    abortController = new AbortController();
    const { signal } = abortController;

    // Total report generation timeout (M1) — auto-abort after 5 minutes
    const reportTimeoutId = setTimeout(() => {
        abortController?.abort();
    }, REPORT_GENERATION_TIMEOUT_MS);
    const clearReportTimeout = () => clearTimeout(reportTimeoutId);

    // Increment request ID to detect stale responses
    currentRequestId++;
    const thisRequestId = currentRequestId;

    // Reset pagination flags for new report generation
    store.ui.paginationTruncated = false;
    store.ui.paginationAbortedDueToTokenExpiration = false;

    // Null-out old data early to allow GC during fetch (L3)
    store.rawEntries = null;
    store.analysisResults = null;

    // ===== Extract and Validate Dates =====
    const startDateEl = document.getElementById('startDate') as HTMLInputElement | null;
    const endDateEl = document.getElementById('endDate') as HTMLInputElement | null;
    const startDate = startDateEl?.value || '';
    const endDate = endDateEl?.value || '';

    if (!startDate || !endDate) {
        UI.renderLoading(false);
        const emptyState = document.getElementById('emptyState');
        if (emptyState) {
            emptyState.textContent = 'Please select start and end dates to generate the report.';
            emptyState.classList.remove('hidden');
        }
        const hideEmptyStateTimer = setTimeout(() => {
            if (emptyState) emptyState.classList.add('hidden');
        }, 3000);
        unrefTimerIfSupported(hideEmptyStateTimer);
        clearReportTimeout();
        return;
    }

    if (startDate > endDate) {
        UI.renderLoading(false);
        UI.showError({
            title: 'Invalid Date Range',
            message: 'Start date must be before or equal to end date.',
            action: 'none',
            type: 'VALIDATION_ERROR',
            timestamp: new Date().toISOString(),
        });
        clearReportTimeout();
        return;
    }

    // ===== Large Date Range Safeguard (M6: considers user count) =====
    const rangeDays = getDateRangeDays(startDate, endDate);
    const userDays = rangeDays * store.users.length;
    if (rangeDays > 365 || userDays > 50_000) {
        const confirmed = await UI.showLargeDateRangeWarning(rangeDays, store.users.length);
        if (!confirmed) {
            clearReportTimeout();
            return;
        }
    }

    // ===== Create Request-Scoped Date Range =====
    const requestDateRange: DateRange = { start: startDate, end: endDate };

    // ===== Cache Checking =====
    const cacheKey = store.getReportCacheKey(startDate, endDate);
    let useCachedData = false;
    let cachedEntries: TimeEntry[] | null = null;

    if (cacheKey && !forceRefresh) {
        cachedEntries = await store.getCachedReport(cacheKey);
        if (cachedEntries) {
            const cacheData = sessionStorage.getItem('otplus_report_cache');
            if (cacheData) {
                try {
                    const parsed = JSON.parse(cacheData) as { timestamp: number };
                    const cacheAgeSeconds = Math.round((Date.now() - parsed.timestamp) / 1000);
                    const action = await UI.showCachePrompt(cacheAgeSeconds);
                    useCachedData = action === 'use';
                } catch {
                    useCachedData = false;
                }
            }
        }
    }

    // A newer request may have started while waiting on user prompts
    if (thisRequestId !== currentRequestId) {
        clearReportTimeout();
        return;
    }

    // ===== Prepare for Data Fetch =====
    UI.renderLoading(true);
    store.resetApiStatus();
    store.resetThrottleStatus();
    store.clearFetchCache();

    try {
        if (!store.claims?.workspaceId) {
            throw new Error('No workspace ID');
        }

        const bypassPersistentCache = forceRefresh;

        // ===== Optional Data Fetches (kick off in parallel) =====
        const optionalPromises: { name: string; promise: Promise<void> }[] = [];

        // ===== 2. Fetch User Profiles (Capacity & Working Days) - OPTIONAL =====
        if (store.config.useProfileCapacity || store.config.useProfileWorkingDays) {
            const missingUsers = bypassPersistentCache
                ? store.users
                : store.users.filter((u) => !store.profiles.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'profiles',
                    promise: Api.fetchAllProfiles(store.claims.workspaceId, missingUsers, {
                        signal,
                        onProgress: (fetched, phase) => UI.updateLoadingProgress(fetched, phase, missingUsers.length),
                    }).then(async (profiles) => {
                        if (thisRequestId !== currentRequestId) {
                            return;
                        }
                        profiles.forEach((profile, userId) => {
                            store.profiles.set(userId, {
                                workCapacityHours: parseIsoDuration(profile.workCapacity || ''),
                                workingDays: profile.workingDays,
                            });
                        });
                        await store.saveProfilesCache();
                    }),
                });
            }
        }

        // ===== 3. Fetch Holidays - OPTIONAL =====
        if (store.config.applyHolidays) {
            if (!bypassPersistentCache) {
                await store.loadHolidayCache(startDate, endDate);
            } else {
                store.holidays.clear();
            }
            const missingUsers = bypassPersistentCache
                ? store.users
                : store.users.filter((u) => !store.holidays.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'holidays',
                    promise: Api.fetchAllHolidays(
                        store.claims.workspaceId,
                        missingUsers,
                        startDate,
                        endDate,
                        { signal, onProgress: (fetched, phase) => UI.updateLoadingProgress(fetched, phase, missingUsers.length) }
                    ).then(async (holidays) => {
                        if (thisRequestId !== currentRequestId) {
                            return;
                        }
                        holidays.forEach((hList, userId) => {
                            const hMap = new Map();
                            (hList || []).forEach((h) => {
                                const startKey = IsoUtils.extractDateKey(h.datePeriod?.startDate);
                                const endKey = IsoUtils.extractDateKey(h.datePeriod?.endDate);

                                if (startKey) {
                                    if (!endKey || endKey === startKey) {
                                        hMap.set(startKey, h);
                                    } else {
                                        const range = IsoUtils.generateDateRange(startKey, endKey);
                                        range.forEach((date) => hMap.set(date, h));
                                    }
                                }
                            });
                            store.holidays.set(userId, hMap);
                        });
                        await store.saveHolidayCache(startDate, endDate);
                    }),
                });
            }
        }

        // ===== 4. Fetch Time Off - OPTIONAL =====
        if (store.config.applyTimeOff) {
            if (!bypassPersistentCache) {
                await store.loadTimeOffCache(startDate, endDate);
            } else {
                store.timeOff.clear();
            }
            const missingUsers = bypassPersistentCache
                ? store.users
                : store.users.filter((u) => !store.timeOff.has(u.id));
            if (missingUsers.length > 0) {
                optionalPromises.push({
                    name: 'timeOff',
                    promise: Api.fetchAllTimeOff(
                        store.claims.workspaceId,
                        missingUsers,
                        startDate,
                        endDate,
                        { signal, onProgress: (fetched, phase) => UI.updateLoadingProgress(fetched, phase, missingUsers.length) }
                    ).then(async (timeOff) => {
                        if (thisRequestId !== currentRequestId) {
                            return;
                        }
                        timeOff.forEach((value, userId) => {
                            store.timeOff.set(userId, value);
                        });
                        await store.saveTimeOffCache(startDate, endDate);
                    }),
                });
            }
        }

        // ===== Fetch Entries (in parallel with optional calls) =====
        const entriesPromise =
            useCachedData && cachedEntries
                ? Promise.resolve(cachedEntries)
                : Api.fetchDetailedReport(
                      store.claims.workspaceId,
                      `${startDate}T00:00:00Z`,
                      `${endDate}T23:59:59Z`,
                      {
                          signal,
                          onProgress: (page, phase) => {
                              UI.updateLoadingProgress(page, phase);
                          },
                      }
                  );

        if (useCachedData && cachedEntries) {
            UI.updateLoadingProgress(0, 'cached data');
        }

        const optionalResultsPromise = optionalPromises.length > 0
            ? Promise.allSettled(optionalPromises.map((p) => p.promise))
            : Promise.resolve([]);

        const entries = await entriesPromise;
        if (thisRequestId !== currentRequestId) {
            return;
        }

        // Cache the fetched entries for potential reuse
        if (!useCachedData && cacheKey && entries && entries.length > 0) {
            void store.setCachedReport(cacheKey, entries);
        }

        store.rawEntries = entries;

        // ===== Wait for Optional Fetches with Graceful Failure =====
        const optionalResults = await optionalResultsPromise;
        if (thisRequestId !== currentRequestId) {
            return;
        }
        optionalResults.forEach((result, index) => {
            if (result.status === 'rejected') {
                const reason = result.reason as Error;
                if (reason?.name !== 'AbortError') {
                    const name = optionalPromises[index].name;
                    console.warn(`Optional fetch '${name}' failed:`, reason);
                    if (name === 'profiles') {
                        store.apiStatus.profilesFailed = store.users.length;
                    }
                    if (name === 'holidays') {
                        store.apiStatus.holidaysFailed = store.users.length;
                    }
                    if (name === 'timeOff') {
                        store.apiStatus.timeOffFailed = store.users.length;
                    }
                }
            }
        });

        // ===== Stale Request Detection =====
        if (thisRequestId !== currentRequestId) {
            return;
        }

        // ===== Trigger Calculation & Rendering =====
        runCalculation(requestDateRange, syncAmountDisplayAvailability);

        // Show the tab navigation (Summary/Detailed) now that we have results
        const tabNavCard = document.getElementById('tabNavCard');
        if (tabNavCard) tabNavCard.style.display = 'flex';

        // Enable Export button (disabled until we have analysis results)
        const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement | null;
        if (exportBtn) exportBtn.disabled = false;

        // Display API status banner (warnings for failed optional fetches)
        UI.renderApiStatus();

        // Display pagination warning if results were truncated
        UI.renderPaginationWarning();

        // Display rate limit status if we hit throttling during fetch
        UI.renderThrottleStatus(store.throttleStatus.retryCount);
    } catch (error) {
        const err = error as Error;

        // Abort errors are expected when a new request cancels an old one
        if (err.name === 'AbortError') {
            if (thisRequestId === currentRequestId) {
                store.rawEntries = null;
            }
            return;
        }

        console.error('Report generation failed:', error);
        reportError(err, {
            module: 'main',
            operation: 'handleGenerateReport',
            level: 'error',
            metadata: {
                dateRange: { start: startDate, end: endDate },
            },
        });
        UI.showError({
            title: 'Report Generation Failed',
            message: 'An error occurred while fetching time entries. Please try again.',
            action: 'retry',
            type: 'API_ERROR',
            timestamp: new Date().toISOString(),
        });
    } finally {
        // ===== Cleanup =====
        clearReportTimeout();
        // Only the latest in-flight request owns global loading + controller cleanup.
        // Stale requests must not clear indicators or controller state for newer requests.
        if (thisRequestId === currentRequestId) {
            UI.clearLoadingProgress();
            UI.renderLoading(false);
            abortController = null;
        }
    }
}
