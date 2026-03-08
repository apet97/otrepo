/**
 * @fileoverview Date Preset Calculations
 *
 * Pure functions that compute date ranges for preset buttons (This Week, Last Week, etc.).
 * Extracted from main.ts to reduce module size (CQ-1).
 */

import { IsoUtils } from './utils.js';

export interface DatePresetRange {
    start: string; // YYYY-MM-DD
    end: string;   // YYYY-MM-DD
}

/** Monday-to-today of the current ISO week. */
export function getThisWeekRange(): DatePresetRange {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset)
    );
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    return { start: IsoUtils.toDateKey(start), end: IsoUtils.toDateKey(end) };
}

/** Last Monday through last Sunday. */
export function getLastWeekRange(): DatePresetRange {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const lastMondayOffset = dayOfWeek === 0 ? -13 : -6 - dayOfWeek;
    const lastSundayOffset = dayOfWeek === 0 ? -7 : -dayOfWeek;
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + lastMondayOffset)
    );
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + lastSundayOffset)
    );
    return { start: IsoUtils.toDateKey(start), end: IsoUtils.toDateKey(end) };
}

/** 14 days ago through today. */
export function getLast2WeeksRange(): DatePresetRange {
    const now = new Date();
    const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 13)
    );
    const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    return { start: IsoUtils.toDateKey(start), end: IsoUtils.toDateKey(end) };
}

/** First to last day of the previous calendar month. */
export function getLastMonthRange(): DatePresetRange {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
    return { start: IsoUtils.toDateKey(start), end: IsoUtils.toDateKey(end) };
}

/** First to last day of the current calendar month. */
export function getThisMonthRange(): DatePresetRange {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return { start: IsoUtils.toDateKey(start), end: IsoUtils.toDateKey(end) };
}
