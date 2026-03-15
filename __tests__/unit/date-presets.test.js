/**
 * @jest-environment jsdom
 */
import { describe, it, expect } from '@jest/globals';

describe('date-presets', () => {
    let mod;
    beforeAll(async () => {
        mod = await import('../../js/date-presets.js');
    });

    it.each([
        ['getThisWeekRange'],
        ['getLastWeekRange'],
        ['getLast2WeeksRange'],
        ['getLastMonthRange'],
        ['getThisMonthRange'],
    ])('%s returns valid date range', (fnName) => {
        const result = mod[fnName]();
        expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(result.start <= result.end).toBe(true);
    });

    it('getThisMonthRange starts on the 1st', () => {
        const result = mod.getThisMonthRange();
        expect(result.start).toMatch(/-01$/);
    });

    it('getLastMonthRange end day is at least 28', () => {
        const result = mod.getLastMonthRange();
        const endDay = parseInt(result.end.split('-')[2], 10);
        expect(endDay).toBeGreaterThanOrEqual(28);
    });

    it('getLastMonthRange start is the 1st', () => {
        const result = mod.getLastMonthRange();
        expect(result.start).toMatch(/-01$/);
    });

    it('getLast2WeeksRange spans 14 days', () => {
        const result = mod.getLast2WeeksRange();
        const start = new Date(result.start + 'T00:00:00Z');
        const end = new Date(result.end + 'T00:00:00Z');
        const diffDays = (end - start) / (1000 * 60 * 60 * 24);
        expect(diffDays).toBe(13); // 14 days inclusive = 13 day difference
    });

    it('getThisWeekRange start is a Monday (day 1)', () => {
        const result = mod.getThisWeekRange();
        const startDate = new Date(result.start + 'T00:00:00Z');
        expect(startDate.getUTCDay()).toBe(1); // Monday
    });

    it('getLastWeekRange start is Monday and end is Sunday', () => {
        const result = mod.getLastWeekRange();
        const startDate = new Date(result.start + 'T00:00:00Z');
        const endDate = new Date(result.end + 'T00:00:00Z');
        expect(startDate.getUTCDay()).toBe(1); // Monday
        expect(endDate.getUTCDay()).toBe(0); // Sunday
    });
});
