/**
 * @fileoverview Configuration Management
 *
 * Event binding and state synchronization for application config controls.
 * Extracted from main.ts to reduce module size (CQ-1).
 */

import { store } from './state.js';
import * as UI from './ui/index.js';
import { debounce, validateInputBounds } from './utils.js';
import { downloadSummaryCsv, downloadDetailedCsv } from './export.js';
import { saveServerConfig } from './settings-api.js';
import { runCalculation } from './worker-manager.js';
import {
    getThisWeekRange,
    getLastWeekRange,
    getLast2WeeksRange,
    getLastMonthRange,
    getThisMonthRange,
} from './date-presets.js';
import type { TimeEntry } from './types.js';

const debouncedServerConfigSave = debounce(() => {
    if (!store.ui.isAdmin) return;
    saveServerConfig(store.config, store.calcParams).then((ok) => {
        if (!ok) {
            console.warn('[OTPLUS] Failed to save config to server — changes are local only');
        }
    });
}, 500);

/** Flush any pending debounced config save (e.g. on beforeunload). */
export function flushPendingConfigSave(): void {
    debouncedServerConfigSave.flush();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function updateDailyThresholdState(): void {
    const dailyInput = document.getElementById('configDaily') as HTMLInputElement | null;
    const helper = document.getElementById('dailyThresholdHelper') as HTMLElement | null;
    if (!dailyInput || !helper) return;

    const useProfile = store.config.useProfileCapacity;
    dailyInput.disabled = useProfile;
    helper.style.display = useProfile ? 'inline' : 'none';

    if (useProfile) {
        dailyInput.style.opacity = '0.5';
        dailyInput.style.cursor = 'not-allowed';
    } else {
        dailyInput.style.opacity = '1';
        dailyInput.style.cursor = '';
    }
}

function updateWeeklyThresholdState(): void {
    const weeklyContainer = document.getElementById('weeklyThresholdContainer');
    if (!weeklyContainer) return;
    const basis = (store.config.overtimeBasis || 'daily').toLowerCase();
    const showWeekly = basis === 'weekly' || basis === 'both';
    weeklyContainer.classList.toggle('hidden', !showWeekly);
}

type TabKey = 'summary' | 'detailed';

function setActiveTab(tab: TabKey): void {
    const summaryBtn = document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="summary"]');
    const detailedBtn = document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="detailed"]');
    const summaryCard = document.getElementById('summaryCard');
    const detailedCard = document.getElementById('detailedCard');

    const isSummary = tab === 'summary';

    if (summaryBtn) {
        summaryBtn.classList.toggle('active', isSummary);
        summaryBtn.setAttribute('aria-selected', isSummary ? 'true' : 'false');
    }
    if (detailedBtn) {
        detailedBtn.classList.toggle('active', !isSummary);
        detailedBtn.setAttribute('aria-selected', !isSummary ? 'true' : 'false');
    }

    if (summaryCard) summaryCard.classList.toggle('hidden', !isSummary);
    if (detailedCard) detailedCard.classList.toggle('hidden', isSummary);

    store.ui.activeTab = tab;
}

function parseTabKey(value: string | undefined): TabKey | null {
    if (value === 'summary' || value === 'detailed') return value;
    return null;
}

// ============================================================================
// RATE DETECTION
// ============================================================================

function hasCostRates(entries: TimeEntry[] | null): boolean {
    if (!Array.isArray(entries) || entries.length === 0) return true;

    return entries.some((entry) => {
        const rawCostRate = (entry?.costRate as { amount?: number })?.amount ?? entry?.costRate;
        const costRate = Number(rawCostRate);
        if (Number.isFinite(costRate) && costRate !== 0) return true;

        const amounts = Array.isArray(entry?.amounts) ? entry.amounts : [];
        return amounts.some((amount) => {
            const type = String(amount?.type || amount?.amountType || '').toUpperCase();
            if (type !== 'COST' && type !== 'PROFIT') return false;
            const value = Number(amount?.value ?? amount?.amount);
            return Number.isFinite(value) && value !== 0;
        });
    });
}

function hasAmountRates(entries: TimeEntry[] | null): boolean {
    if (!Array.isArray(entries) || entries.length === 0) return true;

    return entries.some((entry) => {
        const hourlyRate = Number((entry?.hourlyRate as { amount?: number })?.amount);
        const rawEarnedRate =
            (entry?.earnedRate as { amount?: number })?.amount ?? entry?.earnedRate;
        const earnedRate = Number(rawEarnedRate);
        const rawCostRate = (entry?.costRate as { amount?: number })?.amount ?? entry?.costRate;
        const costRate = Number(rawCostRate);

        if (
            (Number.isFinite(hourlyRate) && hourlyRate !== 0) ||
            (Number.isFinite(earnedRate) && earnedRate !== 0) ||
            (Number.isFinite(costRate) && costRate !== 0)
        ) {
            return true;
        }

        const amounts = Array.isArray(entry?.amounts) ? entry.amounts : [];
        return amounts.some((amount) => {
            const value = Number(amount?.value ?? amount?.amount);
            return Number.isFinite(value) && value !== 0;
        });
    });
}

/** Sync amount display dropdown availability based on entry data. */
export function syncAmountDisplayAvailability(entries: TimeEntry[] | null): void {
    const amountRatesAvailable = hasAmountRates(entries);
    store.ui.hasAmountRates = amountRatesAvailable;

    const costRatesAvailable = amountRatesAvailable ? hasCostRates(entries) : false;
    store.ui.hasCostRates = costRatesAvailable;

    const amountDisplayEl = document.getElementById('amountDisplay') as HTMLSelectElement | null;
    if (!amountDisplayEl) return;
    const amountDisplayContainer = document.getElementById('amountDisplayContainer');
    if (amountDisplayContainer) {
        amountDisplayContainer.classList.toggle('hidden', !amountRatesAvailable);
    }
    amountDisplayEl.disabled = !amountRatesAvailable;

    if (!amountRatesAvailable) {
        if (store.config.amountDisplay !== 'earned') {
            store.config.amountDisplay = 'earned';
            store.saveConfig();
            debouncedServerConfigSave();
        }
        amountDisplayEl.value = 'earned';
        return;
    }

    const costOption = amountDisplayEl.querySelector(
        'option[value="cost"]'
    ) as HTMLOptionElement | null;
    const profitOption = amountDisplayEl.querySelector(
        'option[value="profit"]'
    ) as HTMLOptionElement | null;

    if (costOption) {
        costOption.hidden = !costRatesAvailable;
        costOption.disabled = !costRatesAvailable;
    }
    if (profitOption) {
        profitOption.hidden = !costRatesAvailable;
        profitOption.disabled = !costRatesAvailable;
    }

    const validDisplays = new Set(['earned', 'cost', 'profit']);
    let nextDisplay = String(store.config.amountDisplay || '').toLowerCase();
    if (!validDisplays.has(nextDisplay)) nextDisplay = 'earned';

    if (!costRatesAvailable && (nextDisplay === 'cost' || nextDisplay === 'profit')) {
        nextDisplay = 'earned';
    }

    if (store.config.amountDisplay !== nextDisplay) {
        store.config.amountDisplay = nextDisplay as 'earned' | 'cost' | 'profit';
        store.saveConfig();
        debouncedServerConfigSave();
    }

    amountDisplayEl.value = nextDisplay;
}

// ============================================================================
// EVENT BINDING
// ============================================================================

/* eslint-disable complexity, max-lines-per-function -- Config event binding requires handling many form fields */
let _configEventsBound = false;
const _configListeners: Array<{ el: EventTarget; type: string; fn: EventListener }> = [];

function trackListener(el: EventTarget, type: string, fn: EventListener): void {
    el.addEventListener(type, fn);
    _configListeners.push({ el, type, fn });
}

/** Remove all config listeners (for testing or teardown). */
export function cleanupConfigEvents(): void {
    for (const { el, type, fn } of _configListeners) {
        el.removeEventListener(type, fn);
    }
    _configListeners.length = 0;
    _configEventsBound = false;
}

/**
 * Binds event listeners to all configuration controls and UI interactive elements.
 * @param handleGenerateReport - Callback to trigger report generation.
 */
export function bindConfigEvents(handleGenerateReport: (forceRefresh?: boolean) => void): void {
    if (_configEventsBound) return;
    _configEventsBound = true;

    // ========== Boolean Configuration Toggles ==========
    const configToggles = [
        { id: 'useProfileCapacity', key: 'useProfileCapacity' },
        { id: 'useProfileWorkingDays', key: 'useProfileWorkingDays' },
        { id: 'applyHolidays', key: 'applyHolidays' },
        { id: 'applyTimeOff', key: 'applyTimeOff' },
        { id: 'showBillableBreakdown', key: 'showBillableBreakdown' },
        { id: 'showDecimalTime', key: 'showDecimalTime' },
    ] as const;

    configToggles.forEach(({ id, key }) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
            el.checked = store.config[key];

            trackListener(el, 'change', ((e: Event) => {
                store.config[key] = (e.target as HTMLInputElement).checked;
                store.saveConfig();
                debouncedServerConfigSave();

                if (key === 'showBillableBreakdown') {
                    UI.renderSummaryExpandToggle();
                }

                if (key === 'useProfileCapacity') {
                    updateDailyThresholdState();
                    updateWeeklyThresholdState();
                }

                if (store.rawEntries) {
                    if (key === 'showDecimalTime') {
                        if (store.analysisResults) {
                            UI.renderSummaryStrip(store.analysisResults);
                            UI.renderSummaryTable(store.analysisResults);
                            UI.renderDetailedTable(store.analysisResults);
                        }
                    } else {
                        runCalculation();
                    }
                }
            }) as EventListener);
        }
    });

    // ========== Amount Display Mode Selector ==========
    const amountDisplayEl = document.getElementById('amountDisplay') as HTMLSelectElement | null;
    if (amountDisplayEl) {
        const validDisplays = new Set(['earned', 'cost', 'profit']);
        const currentDisplay = String(store.config.amountDisplay || '').toLowerCase();
        amountDisplayEl.value = validDisplays.has(currentDisplay) ? currentDisplay : 'earned';
        trackListener(amountDisplayEl, 'change', ((e: Event) => {
            const nextValue = String((e.target as HTMLSelectElement).value || '').toLowerCase();
            const allowCost = store.ui.hasCostRates !== false && store.ui.hasAmountRates !== false;
            let normalized: 'earned' | 'cost' | 'profit' = validDisplays.has(nextValue)
                ? (nextValue as 'earned' | 'cost' | 'profit')
                : 'earned';
            if (!allowCost && (normalized === 'cost' || normalized === 'profit')) {
                normalized = 'earned';
            }
            store.config.amountDisplay = normalized;
            store.saveConfig();
            debouncedServerConfigSave();
            amountDisplayEl.value = store.config.amountDisplay;
            if (store.rawEntries) runCalculation();
        }) as EventListener);
    }

    // ========== Overtime Basis Selector ==========
    const overtimeBasisEl = document.getElementById('overtimeBasis') as HTMLSelectElement | null;
    if (overtimeBasisEl) {
        const validBases = new Set(['daily', 'weekly', 'both']);
        const currentBasis = String(store.config.overtimeBasis || '').toLowerCase();
        overtimeBasisEl.value = validBases.has(currentBasis) ? currentBasis : 'daily';
        trackListener(overtimeBasisEl, 'change', ((e: Event) => {
            const nextValue = String((e.target as HTMLSelectElement).value || '').toLowerCase();
            store.config.overtimeBasis = (validBases.has(nextValue) ? nextValue : 'daily') as
                | 'daily'
                | 'weekly'
                | 'both';
            store.saveConfig();
            debouncedServerConfigSave();
            updateWeeklyThresholdState();
            if (store.rawEntries) runCalculation();
        }) as EventListener);
        updateWeeklyThresholdState();
    }

    // ========== Numeric Configuration Inputs ==========
    const dailyEl = document.getElementById('configDaily') as HTMLInputElement | null;
    if (dailyEl) {
        dailyEl.value = String(store.calcParams.dailyThreshold);
        trackListener(
            dailyEl,
            'input',
            debounce((e: Event) => {
                const parsed = parseFloat((e.target as HTMLInputElement).value);
                const validated = validateInputBounds(
                    'dailyThreshold',
                    Number.isNaN(parsed) ? 8 : parsed
                );
                store.calcParams.dailyThreshold = validated.value;
                store.saveConfig();
                debouncedServerConfigSave();
                if (store.rawEntries) runCalculation();
            }, 300) as EventListener
        );
    }

    const weeklyEl = document.getElementById('configWeekly') as HTMLInputElement | null;
    if (weeklyEl) {
        weeklyEl.value = String(store.calcParams.weeklyThreshold);
        trackListener(
            weeklyEl,
            'input',
            debounce((e: Event) => {
                const parsedWeekly = parseFloat((e.target as HTMLInputElement).value);
                const validatedWeekly = validateInputBounds(
                    'weeklyThreshold',
                    Number.isNaN(parsedWeekly) ? 40 : parsedWeekly
                );
                store.calcParams.weeklyThreshold = validatedWeekly.value;
                store.saveConfig();
                debouncedServerConfigSave();
                if (store.rawEntries) runCalculation();
            }, 300) as EventListener
        );
    }

    const multEl = document.getElementById('configMultiplier') as HTMLInputElement | null;
    if (multEl) {
        multEl.value = String(store.calcParams.overtimeMultiplier);
        trackListener(
            multEl,
            'input',
            debounce((e: Event) => {
                const parsedMult = parseFloat((e.target as HTMLInputElement).value);
                const validatedMult = validateInputBounds(
                    'overtimeMultiplier',
                    Number.isNaN(parsedMult) ? 1.5 : parsedMult
                );
                store.calcParams.overtimeMultiplier = validatedMult.value;
                store.saveConfig();
                debouncedServerConfigSave();
                if (store.rawEntries) runCalculation();
            }, 300) as EventListener
        );
    }

    // Enable Tiered OT Toggle
    const enableTieredOTEl = document.getElementById('enableTieredOT') as HTMLInputElement | null;
    const tier2ConfigEls = document.querySelectorAll('.tier2-config');

    function updateTier2Visibility(enabled: boolean) {
        tier2ConfigEls.forEach((el) => {
            (el as HTMLElement).style.display = enabled ? '' : 'none';
        });
    }

    if (enableTieredOTEl) {
        enableTieredOTEl.checked = store.config.enableTieredOT;
        updateTier2Visibility(store.config.enableTieredOT);

        trackListener(enableTieredOTEl, 'change', (() => {
            store.config.enableTieredOT = enableTieredOTEl.checked;

            if (enableTieredOTEl.checked) {
                store.calcParams.tier2Multiplier = store.calcParams.overtimeMultiplier;
                const tier2MultEl = document.getElementById(
                    'configTier2Multiplier'
                ) as HTMLInputElement | null;
                if (tier2MultEl) {
                    tier2MultEl.value = String(store.calcParams.tier2Multiplier);
                }
            }

            store.saveConfig();
            debouncedServerConfigSave();
            updateTier2Visibility(enableTieredOTEl.checked);
            if (store.rawEntries) runCalculation();
        }) as EventListener);
    }

    const tier2ThresholdEl = document.getElementById(
        'configTier2Threshold'
    ) as HTMLInputElement | null;
    if (tier2ThresholdEl) {
        tier2ThresholdEl.value = String(store.calcParams.tier2ThresholdHours ?? 0);
        trackListener(
            tier2ThresholdEl,
            'input',
            debounce((e: Event) => {
                const parsedT2Thresh = parseFloat((e.target as HTMLInputElement).value);
                const validatedT2Thresh = validateInputBounds(
                    'tier2ThresholdHours',
                    Number.isNaN(parsedT2Thresh) ? 0 : parsedT2Thresh
                );
                store.calcParams.tier2ThresholdHours = validatedT2Thresh.value;
                store.saveConfig();
                debouncedServerConfigSave();
                if (store.rawEntries) runCalculation();
            }, 300) as EventListener
        );
    }

    const tier2MultiplierEl = document.getElementById(
        'configTier2Multiplier'
    ) as HTMLInputElement | null;
    if (tier2MultiplierEl) {
        tier2MultiplierEl.value = String(store.calcParams.tier2Multiplier ?? 2.0);
        trackListener(
            tier2MultiplierEl,
            'input',
            debounce((e: Event) => {
                const parsedT2Mult = parseFloat((e.target as HTMLInputElement).value);
                const validatedT2Mult = validateInputBounds(
                    'tier2Multiplier',
                    Number.isNaN(parsedT2Mult) ? 2.0 : parsedT2Mult
                );
                store.calcParams.tier2Multiplier = validatedT2Mult.value;
                store.saveConfig();
                debouncedServerConfigSave();
                if (store.rawEntries) runCalculation();
            }, 300) as EventListener
        );
    }

    // ========== Initialize Dependent UI States ==========
    updateDailyThresholdState();

    // ========== Config Panel Collapse Toggle ==========
    const configToggle = document.getElementById('configToggle');
    const configContent = document.getElementById('configContent');
    if (configToggle && configContent) {
        trackListener(configToggle, 'click', (() => {
            const isCollapsed = configToggle.classList.toggle('collapsed');
            configContent.classList.toggle('hidden');
            configToggle.setAttribute('aria-expanded', String(!isCollapsed));
        }) as EventListener);
    }

    // ========== Tab Navigation ==========
    const tabNavCard = document.getElementById('tabNavCard') as HTMLElement | null;
    if (tabNavCard && !tabNavCard.dataset.listenerAttached) {
        tabNavCard.dataset.listenerAttached = 'true';
        const tabButtons = Array.from(tabNavCard.querySelectorAll<HTMLButtonElement>('.tab-btn'));

        const activate = (tabValue: string | undefined) => {
            const tab = parseTabKey(tabValue);
            if (tab) setActiveTab(tab);
        };

        tabButtons.forEach((btn) => {
            trackListener(btn, 'click', (() => activate(btn.dataset.tab)) as EventListener);
            trackListener(btn, 'keydown', ((e: Event) => {
                const ke = e as KeyboardEvent;
                if (ke.key === 'Enter' || ke.key === ' ') {
                    ke.preventDefault();
                    activate(btn.dataset.tab);
                }
            }) as EventListener);
        });
    }

    // ========== Export Button ==========
    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) {
        trackListener(exportBtn, 'click', (async () => {
            if (!store.analysisResults) return;
            if (store.ui.activeTab === 'summary') {
                await downloadSummaryCsv(store.analysisResults, store.ui.summaryGroupBy || 'user');
            } else {
                await downloadDetailedCsv(store.analysisResults);
            }
        }) as EventListener);
    }

    // ========== Refresh Button ==========
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        trackListener(refreshBtn, 'click', (() => {
            store.clearReportCache();
            handleGenerateReport(true);
        }) as EventListener);
    }

    // ========== Date Range Selection ==========
    const startInput = document.getElementById('startDate') as HTMLInputElement | null;
    const endInput = document.getElementById('endDate') as HTMLInputElement | null;

    const queueAutoGenerate = debounce(() => {
        const startValue = startInput?.value;
        const endValue = endInput?.value;
        if (!startValue || !endValue) return;
        if (startValue > endValue) return;
        handleGenerateReport();
    }, 300);

    if (startInput) {
        trackListener(startInput, 'change', queueAutoGenerate as EventListener);
    }
    if (endInput) {
        trackListener(endInput, 'change', queueAutoGenerate as EventListener);
    }

    // Cancel pending auto-generate when the user explicitly clicks Generate,
    // preventing a stale debounced call from showing a duplicate cache prompt.
    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        trackListener(generateBtn, 'click', (() => {
            queueAutoGenerate.cancel();
        }) as EventListener);
    }

    // ========== Date Preset Buttons ==========
    const presetButtons: Array<{ id: string; rangeFn: () => { start: string; end: string } }> = [
        { id: 'datePresetThisWeek', rangeFn: getThisWeekRange },
        { id: 'datePresetLastWeek', rangeFn: getLastWeekRange },
        { id: 'datePresetLast2Weeks', rangeFn: getLast2WeeksRange },
        { id: 'datePresetLastMonth', rangeFn: getLastMonthRange },
        { id: 'datePresetThisMonth', rangeFn: getThisMonthRange },
    ];

    for (const { id, rangeFn } of presetButtons) {
        const btn = document.getElementById(id);
        if (btn) {
            trackListener(btn, 'click', (() => {
                const range = rangeFn();
                const startEl = document.getElementById('startDate') as HTMLInputElement | null;
                const endEl = document.getElementById('endDate') as HTMLInputElement | null;
                if (startEl) startEl.value = range.start;
                if (endEl) endEl.value = range.end;
                queueAutoGenerate();
            }) as EventListener);
        }
    }

    // ========== Detailed Report Filter Chips ==========
    const filterContainer = document.getElementById('detailedFilters');
    if (filterContainer) {
        trackListener(filterContainer, 'click', ((e: Event) => {
            const target = (e as MouseEvent).target as HTMLElement;
            if (target.classList.contains('chip')) {
                const filter = target.dataset.filter;
                if (filter && store.analysisResults) {
                    UI.renderDetailedTable(store.analysisResults, filter);
                }
            }
        }) as EventListener);
    }

    // ========== Summary Table Grouping ==========
    const groupBySelect = document.getElementById('groupBySelect') as HTMLSelectElement | null;
    if (groupBySelect) {
        groupBySelect.value = store.ui.summaryGroupBy || 'user';

        trackListener(groupBySelect, 'change', ((e: Event) => {
            store.ui.summaryGroupBy = (e.target as HTMLSelectElement)
                .value as typeof store.ui.summaryGroupBy;
            store.ui.summaryPage = 1;
            store.saveUIState();
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        }) as EventListener);
    }

    // ========== Summary Expand Toggle ==========
    const summaryExpandToggleContainer = document.getElementById('summaryExpandToggleContainer');
    if (summaryExpandToggleContainer) {
        UI.renderSummaryExpandToggle();

        trackListener(summaryExpandToggleContainer, 'click', ((e: Event) => {
            const btn = ((e as MouseEvent).target as HTMLElement).closest('#summaryExpandToggle');
            if (!btn) return;
            store.ui.summaryExpanded = !store.ui.summaryExpanded;
            store.saveUIState();
            UI.renderSummaryExpandToggle();
            if (store.analysisResults) {
                UI.renderSummaryTable(store.analysisResults);
            }
        }) as EventListener);
    }

    // ========== Clear All Data Button ==========
    const clearDataBtn = document.getElementById('clearAllDataBtn');
    if (clearDataBtn) {
        trackListener(clearDataBtn, 'click', (() => {
            UI.showClearDataConfirmation(() => {
                store.clearAllData();
                location.reload();
            });
        }) as EventListener);
    }
}
