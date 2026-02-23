/**
 * @fileoverview Mock UI module for testing
 * Manual mock that doesn't depend on real DOM elements
 */

import { jest } from '@jest/globals';
import type { UserAnalysis, UICallbacks, FriendlyError } from '../types.js';

/**
 * Mock classList implementation
 */
interface MockClassList {
    add: jest.Mock;
    remove: jest.Mock;
}

/**
 * Mock element implementation
 */
interface MockElement {
    classList: MockClassList;
    innerHTML?: string;
    textContent?: string;
    appendChild?: jest.Mock;
    addEventListener?: jest.Mock;
}

/**
 * Mock DOM elements
 */
export const Elements: Record<string, MockElement> = {
    resultsContainer: { classList: { add: jest.fn(), remove: jest.fn() } },
    summaryStrip: { innerHTML: '', classList: { add: jest.fn(), remove: jest.fn() } },
    summaryTableBody: { innerHTML: '', appendChild: jest.fn(), classList: { add: jest.fn(), remove: jest.fn() } },
    loadingState: { classList: { add: jest.fn(), remove: jest.fn() } },
    emptyState: { classList: { add: jest.fn(), remove: jest.fn() }, textContent: '' },
    apiStatusBanner: { classList: { add: jest.fn(), remove: jest.fn() }, textContent: '' },
    // Overrides page elements
    mainView: { classList: { add: jest.fn(), remove: jest.fn() } },
    overridesPage: { classList: { add: jest.fn(), remove: jest.fn() } },
    openOverridesBtn: { addEventListener: jest.fn(), classList: { add: jest.fn(), remove: jest.fn() } },
    closeOverridesBtn: { addEventListener: jest.fn(), classList: { add: jest.fn(), remove: jest.fn() } },
    overridesUserList: { innerHTML: '', appendChild: jest.fn(), classList: { add: jest.fn(), remove: jest.fn() } }
};

/**
 * Initialize mock elements
 */
export const initializeElements = jest.fn(() => Elements);

/**
 * Get mock elements
 */
export const getElements = jest.fn(() => Elements);

/**
 * Hide error banner
 */
export const hideError = jest.fn();

/**
 * Render loading state
 */
export function renderLoading(_isLoading: boolean): void {
    // Mock implementation
}

/**
 * Render API status banner
 */
export function renderApiStatus(): void {
    // Mock implementation
}

/**
 * Render pagination warning banner
 */
export function renderPaginationWarning(): void {
    // Mock implementation
}

/**
 * Show the overrides page
 */
export function showOverridesPage(): void {
    // Mock implementation
}

/**
 * Hide the overrides page
 */
export function hideOverridesPage(): void {
    // Mock implementation
}

/**
 * Render the overrides page
 */
export function renderOverridesPage(): void {
    // Mock implementation
}

/**
 * Render summary strip
 */
export function renderSummaryStrip(_users: UserAnalysis[]): void {
    // Mock implementation
}

/**
 * Render summary expand toggle
 */
export function renderSummaryExpandToggle(): void {
    // Mock implementation
}

/**
 * Render summary table
 */
export function renderSummaryTable(_users: UserAnalysis[]): void {
    // Mock implementation
}

/**
 * Render detailed entries table
 */
export function renderDetailedTable(_users: UserAnalysis[], _filter?: string): void {
    // Mock implementation
}

/**
 * Bind UI events
 */
export function bindEvents(_callbacks: UICallbacks): void {
    // Mock implementation
}

/**
 * Show error banner
 */
export function showError(_error: FriendlyError | string): void {
    // Mock implementation
}

/**
 * Show clear data confirmation dialog
 */
export function showClearDataConfirmation(_onConfirm: () => void): void {
    // Mock implementation
}

/**
 * Reset all mock functions
 */
export function resetUiMocks(): void {
    initializeElements.mockClear();
    getElements.mockClear();
    hideError.mockClear();

    // Reset element mocks
    Object.values(Elements).forEach(el => {
        el.classList.add.mockClear();
        el.classList.remove.mockClear();
        if (el.appendChild) el.appendChild.mockClear();
        if (el.addEventListener) el.addEventListener.mockClear();
    });
}
