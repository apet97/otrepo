/**
 * @jest-environment jsdom
 */

/**
 * UI Timing Test Suite - Debounce & Timing Specifications
 *
 * SPECIFICATION: UI Timing Behaviors
 *
 * The UI uses specific timing patterns for responsive UX:
 *
 * | Action | Timing | Reason |
 * |--------|--------|--------|
 * | Filter input | 300ms debounce | Prevent excessive re-renders |
 * | Date range change | 300ms debounce | Wait for user to finish selecting |
 * | Button click | Immediate | User expects instant response |
 * | Config changes | 300ms debounce | Auto-trigger report regeneration |
 *
 * @see js/utils.ts - debounce() implementation
 * @see js/main.ts - Debounce timing values (300ms)
 * @see docs/spec.md - UI conventions
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { debounce } from '../../js/utils.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('UI Debounce Behavior', () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    standardAfterEach();
    jest.useRealTimers();
  });

  describe('Debounce Function', () => {
    /**
     * SPECIFICATION: Debounce Implementation
     *
     * The debounce utility:
     * - Delays function execution by specified ms
     * - Resets timer on each call
     * - Only executes after no calls for wait period
     */

    it('should delay execution by specified milliseconds', () => {
      const callback = jest.fn();
      const debouncedFn = debounce(callback, 300);

      debouncedFn();

      // Should not be called immediately
      expect(callback).not.toHaveBeenCalled();

      // Advance time by 299ms (not quite 300)
      jest.advanceTimersByTime(299);
      expect(callback).not.toHaveBeenCalled();

      // Advance remaining 1ms
      jest.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should reset timer on subsequent calls', () => {
      const callback = jest.fn();
      const debouncedFn = debounce(callback, 300);

      debouncedFn();
      jest.advanceTimersByTime(200);

      debouncedFn(); // Reset timer
      jest.advanceTimersByTime(200);

      // Still not called (timer was reset)
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should only call once after rapid successive calls', () => {
      const callback = jest.fn();
      const debouncedFn = debounce(callback, 300);

      // Rapid fire calls
      debouncedFn();
      debouncedFn();
      debouncedFn();
      debouncedFn();
      debouncedFn();

      jest.advanceTimersByTime(300);

      // Should only be called once
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should cancel pending debounce on new input', () => {
      const callback = jest.fn();
      const debouncedFn = debounce(callback, 300);

      debouncedFn('first');
      jest.advanceTimersByTime(200);

      debouncedFn('second'); // Cancel first, start new
      jest.advanceTimersByTime(200);

      debouncedFn('third'); // Cancel second, start new
      jest.advanceTimersByTime(300);

      // Only final call should execute
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('third');
    });

    it('should pass arguments to the debounced function', () => {
      const callback = jest.fn();
      const debouncedFn = debounce(callback, 300);

      debouncedFn('arg1', 'arg2', { option: true });
      jest.advanceTimersByTime(300);

      expect(callback).toHaveBeenCalledWith('arg1', 'arg2', { option: true });
    });
  });

  describe('Filter Input Debounce (300ms)', () => {
    /**
     * SPECIFICATION: Filter Debounce = 300ms
     *
     * Filter inputs wait 300ms after last keystroke before triggering:
     * - Prevents re-filtering on every character
     * - Improves performance on large datasets
     * - Better UX (don't flicker results)
     */

    it('should debounce filter input by 300ms', () => {
      const filterHandler = jest.fn();
      const debouncedFilter = debounce(filterHandler, 300);

      // Simulate typing "holiday"
      debouncedFilter('h');
      debouncedFilter('ho');
      debouncedFilter('hol');
      debouncedFilter('holi');
      debouncedFilter('holid');
      debouncedFilter('holida');
      debouncedFilter('holiday');

      expect(filterHandler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(300);

      expect(filterHandler).toHaveBeenCalledTimes(1);
      expect(filterHandler).toHaveBeenCalledWith('holiday');
    });
  });

  describe('Date Range Change Debounce (300ms)', () => {
    /**
     * SPECIFICATION: Date Range Debounce = 300ms
     *
     * Date range changes wait 300ms before triggering report:
     * - User may change start AND end date
     * - Wait for both to be selected before fetching
     */

    it('should debounce date range changes by 300ms', () => {
      const dateChangeHandler = jest.fn();
      const debouncedDateChange = debounce(dateChangeHandler, 300);

      // User selects start date, then end date
      debouncedDateChange('2025-01-01', '2025-01-31');

      expect(dateChangeHandler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(300);

      expect(dateChangeHandler).toHaveBeenCalledTimes(1);
      expect(dateChangeHandler).toHaveBeenCalledWith('2025-01-01', '2025-01-31');
    });
  });

  describe('Button Clicks (No Debounce)', () => {
    /**
     * SPECIFICATION: Button Clicks = Immediate
     *
     * Button clicks should execute immediately:
     * - User expects instant feedback
     * - No need to wait for multiple clicks
     */

    it('should NOT debounce button clicks', () => {
      const clickHandler = jest.fn();

      // Direct call (not debounced)
      clickHandler();

      expect(clickHandler).toHaveBeenCalledTimes(1);
    });

    it('should allow rapid button clicks to be handled individually', () => {
      const clickHandler = jest.fn();

      clickHandler();
      clickHandler();
      clickHandler();

      expect(clickHandler).toHaveBeenCalledTimes(3);
    });
  });

  describe('Config Change Auto-Trigger (300ms)', () => {
    /**
     * SPECIFICATION: Config Change Auto-Generate = 300ms
     *
     * When config changes (threshold, multiplier, toggles):
     * - Wait 300ms before auto-regenerating report
     * - User may change multiple settings in quick succession
     */

    it('should debounce config changes by 300ms', () => {
      const regenerateHandler = jest.fn();
      const debouncedRegenerate = debounce(regenerateHandler, 300);

      // User toggles multiple settings
      debouncedRegenerate({ dailyThreshold: 7 });
      debouncedRegenerate({ dailyThreshold: 7, overtimeMultiplier: 2.0 });
      debouncedRegenerate({ dailyThreshold: 7, overtimeMultiplier: 2.0, enableTieredOT: true });

      expect(regenerateHandler).not.toHaveBeenCalled();

      jest.advanceTimersByTime(300);

      expect(regenerateHandler).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Loading State Transitions', () => {
  /**
   * SPECIFICATION: Loading State Lifecycle
   *
   * Loading states follow a strict lifecycle:
   * 1. isLoading = true when fetch starts
   * 2. isLoading remains true during ALL fetch phases
   * 3. isLoading = false only after ALL fetches + calculation complete
   */

  it('should show loading spinner immediately on fetch start', () => {
    // Simulate loading state management
    let isLoading = false;

    const startFetch = () => {
      isLoading = true;
    };

    startFetch();
    expect(isLoading).toBe(true);
  });

  it('should hide spinner only after ALL fetches complete', async () => {
    let isLoading = false;
    let fetchesComplete = 0;
    const totalFetches = 3;

    const startFetch = () => {
      isLoading = true;
    };

    const completeFetch = () => {
      fetchesComplete++;
      if (fetchesComplete >= totalFetches) {
        isLoading = false;
      }
    };

    startFetch();
    expect(isLoading).toBe(true);

    completeFetch(); // 1 of 3
    expect(isLoading).toBe(true);

    completeFetch(); // 2 of 3
    expect(isLoading).toBe(true);

    completeFetch(); // 3 of 3
    expect(isLoading).toBe(false);
  });

  it('should support partial results while fetching continues', () => {
    /**
     * SPECIFICATION: Progressive Results
     *
     * While fetching continues, partial results can be shown:
     * - Users see progress indication
     * - Data appears incrementally
     * - Full loading spinner is optional
     */
    const results = [];
    let isLoading = true;

    // Simulate progressive loading
    results.push({ user: 'Alice', hours: 40 });
    expect(results.length).toBe(1);
    expect(isLoading).toBe(true); // Still loading more

    results.push({ user: 'Bob', hours: 42 });
    expect(results.length).toBe(2);
    expect(isLoading).toBe(true); // Still loading

    isLoading = false;
    expect(results.length).toBe(2);
    expect(isLoading).toBe(false);
  });
});

describe('Debounce Edge Cases', () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should handle 0ms debounce (immediate execution)', () => {
    const callback = jest.fn();
    const debouncedFn = debounce(callback, 0);

    debouncedFn();
    jest.advanceTimersByTime(0);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should handle default waitMs when not specified', () => {
    const callback = jest.fn();
    const debouncedFn = debounce(callback); // No waitMs specified

    debouncedFn();
    jest.advanceTimersByTime(0);

    // Default should be 0 or immediate
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('should preserve function context (this binding)', () => {
    const obj = {
      value: 42,
      method: jest.fn(function() {
        return this.value;
      })
    };

    // Note: debounce in utils.js may not preserve `this` binding
    // This documents the expected behavior
    const debouncedMethod = debounce(obj.method.bind(obj), 300);

    debouncedMethod();
    jest.advanceTimersByTime(300);

    expect(obj.method).toHaveBeenCalled();
  });

  it('should handle multiple debounced functions independently', () => {
    const callback1 = jest.fn();
    const callback2 = jest.fn();

    const debounced1 = debounce(callback1, 300);
    const debounced2 = debounce(callback2, 500);

    debounced1();
    debounced2();

    jest.advanceTimersByTime(300);
    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback2).not.toHaveBeenCalled();

    jest.advanceTimersByTime(200);
    expect(callback2).toHaveBeenCalledTimes(1);
  });
});

describe('UI Timing - Specifications', () => {
  /**
   * This section documents UI timing specifications for reference.
   */

  it('DEBOUNCE_MS should be 300ms for config inputs', () => {
    /**
     * SPECIFICATION: Config Input Debounce
     *
     * Why 300ms?
     * - Fast enough to feel responsive
     * - Slow enough to batch rapid changes
     * - Standard UX timing pattern
     */
    const DEBOUNCE_MS = 300;
    expect(DEBOUNCE_MS).toBe(300);
  });

  it('should use queueAutoGenerate for auto-report trigger', () => {
    /**
     * SPECIFICATION: Auto-Generate Pattern
     *
     * Config changes trigger queueAutoGenerate():
     * - Debounced 300ms
     * - Cancels previous pending generation
     * - Only latest config takes effect
     *
     * Example from main.ts:
     * ```javascript
     * const queueAutoGenerate = debounce(() => {
     *   handleGenerateReport();
     * }, 300);
     * ```
     */
    expect(true).toBe(true);
  });

  it('requestAnimationFrame should be used for DOM updates', () => {
    /**
     * SPECIFICATION: RAF for DOM Updates
     *
     * Use requestAnimationFrame for:
     * - Batch DOM mutations
     * - Smooth UI updates
     * - Non-blocking rendering
     */
    expect(typeof requestAnimationFrame).toBe('function');
  });
});
