/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  initializeElements,
  getElements,
  setElements,
  formatHoursDisplay,
  renderAmountStack,
  buildProfitStacks,
  getAmountLabels,
  getSwatchColor,
  getAmountDisplayMode,
  AMOUNT_STACK_ITEMS
} from '../../js/ui/shared.js';
import { store } from '../../js/state.js';
import { standardAfterEach } from '../helpers/setup.js';

describe('Shared UI Module', () => {
  afterEach(() => {
    standardAfterEach();
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store config
    store.config = {
      useProfileCapacity: true,
      useProfileWorkingDays: true,
      applyHolidays: true,
      applyTimeOff: true,
      showBillableBreakdown: true,
      showDecimalTime: false,
      enableTieredOT: false,
      amountDisplay: 'earned',
      overtimeBasis: 'daily',
      maxPages: 50
    };

    document.body.innerHTML = '';
  });

  describe('getElements', () => {
    it('should throw error when called before initialization', () => {
      // Reset cached elements by setting to null
      setElements(null);

      expect(() => getElements()).toThrow('UI elements not initialized');
    });

    it('should return cached elements after initialization', () => {
      document.body.innerHTML = `
        <div id="resultsContainer"></div>
        <div id="summaryStrip"></div>
        <div id="summaryTableBody"></div>
        <div id="loadingState"></div>
        <div id="emptyState"></div>
        <div id="apiStatusBanner"></div>
        <div id="mainView"></div>
        <div id="overridesPage"></div>
        <button id="openOverridesBtn"></button>
        <button id="closeOverridesBtn"></button>
        <div id="overridesUserList"></div>
      `;

      initializeElements(true);
      const elements = getElements();

      expect(elements.resultsContainer).toBeTruthy();
      expect(elements.summaryStrip).toBeTruthy();
      expect(elements.loadingState).toBeTruthy();
    });
  });

  describe('setElements', () => {
    it('should set cached elements directly', () => {
      const mockElements = {
        resultsContainer: document.createElement('div'),
        summaryStrip: null,
        summaryTableBody: null,
        loadingState: null,
        emptyState: null,
        apiStatusBanner: null,
        mainView: null,
        overridesPage: null,
        openOverridesBtn: null,
        closeOverridesBtn: null,
        overridesUserList: null
      };

      setElements(mockElements);
      const elements = getElements();

      expect(elements.resultsContainer).toBe(mockElements.resultsContainer);
    });
  });

  describe('initializeElements', () => {
    it('should cache DOM elements', () => {
      document.body.innerHTML = `
        <div id="resultsContainer"></div>
        <div id="loadingState"></div>
      `;

      const elements = initializeElements(true);

      expect(elements.resultsContainer).toBe(document.getElementById('resultsContainer'));
      expect(elements.loadingState).toBe(document.getElementById('loadingState'));
    });

    it('should return cached elements without force', () => {
      document.body.innerHTML = '<div id="resultsContainer"></div>';
      const first = initializeElements(true);

      document.body.innerHTML = '<div id="resultsContainer" class="new"></div>';
      const second = initializeElements(false);

      expect(second).toBe(first);
    });

    it('should re-initialize with force=true', () => {
      document.body.innerHTML = '<div id="resultsContainer"></div>';
      const first = initializeElements(true);

      document.body.innerHTML = '<div id="resultsContainer" class="new"></div>';
      const second = initializeElements(true);

      expect(second).not.toBe(first);
    });
  });

  describe('formatHoursDisplay', () => {
    it('should format hours as HH:MM when showDecimalTime is false', () => {
      store.config.showDecimalTime = false;

      expect(formatHoursDisplay(8.5)).toBe('8h 30m');
    });

    it('should format hours as decimal when showDecimalTime is true', () => {
      store.config.showDecimalTime = true;

      expect(formatHoursDisplay(8.5)).toBe('8.50');
    });

    it('should handle zero', () => {
      store.config.showDecimalTime = false;
      expect(formatHoursDisplay(0)).toBe('0h');

      store.config.showDecimalTime = true;
      expect(formatHoursDisplay(0)).toBe('0.00');
    });
  });

  describe('renderAmountStack', () => {
    it('should render stack with right alignment by default', () => {
      const lines = [
        { label: 'Amt', value: 100 },
        { label: 'Cost', value: 80 }
      ];

      const html = renderAmountStack(lines);

      expect(html).toContain('amount-stack-right');
      expect(html).toContain('Amt');
      expect(html).toContain('Cost');
    });

    it('should render stack with left alignment', () => {
      const lines = [{ label: 'Amt', value: 100 }];

      const html = renderAmountStack(lines, 'left');

      expect(html).toContain('amount-stack-left');
    });

    it('should handle non-array input gracefully', () => {
      const html = renderAmountStack(null);

      expect(html).toContain('amount-stack');
      expect(html).not.toContain('undefined');
    });

    it('should handle undefined input gracefully', () => {
      const html = renderAmountStack(undefined);

      expect(html).toContain('amount-stack');
    });

    it('should handle empty array', () => {
      const html = renderAmountStack([]);

      expect(html).toContain('amount-stack');
    });
  });

  describe('buildProfitStacks', () => {
    it('should build profit stacks from amounts by type', () => {
      const amountsByType = {
        earned: { rate: 50, regularAmount: 400 },
        cost: { rate: 40, regularAmount: 320 },
        profit: { rate: 10, regularAmount: 80 }
      };

      const html = buildProfitStacks(amountsByType, (a) => a.rate || 0);

      expect(html).toContain('amount-stack');
      expect(html).toContain('Amt');
      expect(html).toContain('Cost');
      expect(html).toContain('Profit');
    });

    it('should handle undefined amounts', () => {
      const html = buildProfitStacks(undefined, (a) => a.rate || 0);

      expect(html).toContain('amount-stack');
    });

    it('should handle partial amounts by type', () => {
      const amountsByType = {
        earned: { rate: 50 }
        // cost and profit missing
      };

      const html = buildProfitStacks(amountsByType, (a) => a.rate || 0, 'left');

      expect(html).toContain('amount-stack-left');
    });

    it('should use accessor function correctly', () => {
      const amountsByType = {
        earned: { regularAmount: 100 },
        cost: { regularAmount: 80 },
        profit: { regularAmount: 20 }
      };

      const html = buildProfitStacks(amountsByType, (a) => a.regularAmount || 0);

      expect(html).toContain('$100');
      expect(html).toContain('$80');
      expect(html).toContain('$20');
    });
  });

  describe('getAmountDisplayMode', () => {
    it('should return earned by default', () => {
      store.config.amountDisplay = 'earned';

      expect(getAmountDisplayMode()).toBe('earned');
    });

    it('should return cost when configured', () => {
      store.config.amountDisplay = 'cost';

      expect(getAmountDisplayMode()).toBe('cost');
    });

    it('should return profit when configured', () => {
      store.config.amountDisplay = 'profit';

      expect(getAmountDisplayMode()).toBe('profit');
    });

    it('should lowercase the display mode', () => {
      store.config.amountDisplay = 'EARNED';

      expect(getAmountDisplayMode()).toBe('earned');
    });

    it('should handle null/undefined by returning earned', () => {
      store.config.amountDisplay = null;

      expect(getAmountDisplayMode()).toBe('earned');
    });
  });

  describe('getAmountLabels', () => {
    it('should return earned labels by default', () => {
      store.config.amountDisplay = 'earned';

      const labels = getAmountLabels();

      expect(labels.column).toBe('Amount');
      expect(labels.total).toBe('Total (with OT)');
      expect(labels.base).toBe('Amount (no OT)');
      expect(labels.rate).toBe('Rate $/h');
      expect(labels.isProfit).toBeUndefined();
    });

    it('should return cost labels', () => {
      store.config.amountDisplay = 'cost';

      const labels = getAmountLabels();

      expect(labels.column).toBe('Cost');
      expect(labels.total).toBe('Total Cost (with OT)');
      expect(labels.base).toBe('Cost (no OT)');
      expect(labels.rate).toBe('Cost rate $/h');
    });

    it('should return profit labels', () => {
      store.config.amountDisplay = 'profit';

      const labels = getAmountLabels();

      expect(labels.column).toBe('Profit');
      expect(labels.total).toBe('Totals (with OT)');
      expect(labels.base).toBe('Base (no OT)');
      expect(labels.rate).toBe('Rate $/h');
      expect(labels.isProfit).toBe(true);
    });
  });

  describe('getSwatchColor', () => {
    it('should return consistent color for same key', () => {
      const color1 = getSwatchColor('user123');
      const color2 = getSwatchColor('user123');

      expect(color1).toBe(color2);
    });

    it('should return different colors for different keys', () => {
      const color1 = getSwatchColor('alice');
      const color2 = getSwatchColor('bob');
      const color3 = getSwatchColor('charlie');

      // At least some should be different
      expect(color1 !== color2 || color2 !== color3 || color1 !== color3).toBe(true);
    });

    it('should handle undefined key', () => {
      const color = getSwatchColor(undefined);

      expect(color).toBeTruthy();
      expect(color.startsWith('#')).toBe(true);
    });

    it('should handle null key', () => {
      const color = getSwatchColor(null);

      expect(color).toBeTruthy();
      expect(color.startsWith('#')).toBe(true);
    });

    it('should handle empty string key', () => {
      const color = getSwatchColor('');

      expect(color).toBeTruthy();
      expect(color.startsWith('#')).toBe(true);
    });

    it('should return valid hex color', () => {
      const color = getSwatchColor('test');

      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    });

    it('should use hash-based selection from color palette', () => {
      // Different keys should produce deterministic colors from the palette
      const colors = new Set();
      for (let i = 0; i < 20; i++) {
        colors.add(getSwatchColor(`user_${i}`));
      }

      // Should have variety (not all same color)
      expect(colors.size).toBeGreaterThan(1);
    });
  });

  describe('AMOUNT_STACK_ITEMS', () => {
    it('should have earned, cost, and profit items', () => {
      expect(AMOUNT_STACK_ITEMS).toHaveLength(3);
      expect(AMOUNT_STACK_ITEMS.map(i => i.key)).toEqual(['earned', 'cost', 'profit']);
      expect(AMOUNT_STACK_ITEMS.map(i => i.label)).toEqual(['Amt', 'Cost', 'Profit']);
    });
  });

  describe('Edge value tests', () => {
    describe('formatHoursDisplay edge cases', () => {
      it('should handle negative hours', () => {
        store.config.showDecimalTime = false;
        const result = formatHoursDisplay(-2);
        // Negative hours should be handled gracefully
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });

      it('should handle very large hours values', () => {
        store.config.showDecimalTime = false;
        const result = formatHoursDisplay(10000);
        expect(result).toBeDefined();
        expect(result).toContain('10000');
      });

      it('should handle NaN', () => {
        store.config.showDecimalTime = false;
        const result = formatHoursDisplay(NaN);
        // NaN should be handled gracefully (may show 0 or dash)
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });

      it('should handle Infinity', () => {
        store.config.showDecimalTime = false;
        const result = formatHoursDisplay(Infinity);
        // Infinity should be handled gracefully
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });

      it('should handle negative Infinity', () => {
        store.config.showDecimalTime = false;
        const result = formatHoursDisplay(-Infinity);
        expect(result).toBeDefined();
        expect(typeof result).toBe('string');
      });

      it('should handle decimal precision correctly', () => {
        store.config.showDecimalTime = true;
        const result = formatHoursDisplay(8.333333333);
        expect(result).toBe('8.33');
      });

      it('should handle very small decimal values', () => {
        store.config.showDecimalTime = true;
        const result = formatHoursDisplay(0.01);
        expect(result).toBe('0.01');
      });
    });

    describe('renderAmountStack edge cases', () => {
      it('should handle lines with zero values', () => {
        const lines = [
          { label: 'Amt', value: 0 },
          { label: 'Cost', value: 0 }
        ];
        const html = renderAmountStack(lines);
        expect(html).toContain('$0');
      });

      it('should handle lines with negative values', () => {
        const lines = [
          { label: 'Amt', value: -100 },
          { label: 'Profit', value: -50 }
        ];
        const html = renderAmountStack(lines);
        expect(html).toBeDefined();
        expect(html).toContain('amount-stack');
      });

      it('should handle lines with NaN values', () => {
        const lines = [
          { label: 'Amt', value: NaN }
        ];
        const html = renderAmountStack(lines);
        expect(html).toBeDefined();
        expect(html).toContain('amount-stack');
      });

      it('should handle lines with very large values', () => {
        const lines = [
          { label: 'Amt', value: 1000000000 }
        ];
        const html = renderAmountStack(lines);
        expect(html).toBeDefined();
        expect(html).toContain('amount-stack');
      });

      it('should handle lines with undefined label', () => {
        const lines = [
          { label: undefined, value: 100 }
        ];
        const html = renderAmountStack(lines);
        expect(html).toBeDefined();
      });
    });

    describe('buildProfitStacks edge cases', () => {
      it('should handle zero values in all types', () => {
        const amountsByType = {
          earned: { rate: 0, regularAmount: 0 },
          cost: { rate: 0, regularAmount: 0 },
          profit: { rate: 0, regularAmount: 0 }
        };
        const html = buildProfitStacks(amountsByType, (a) => a.rate || 0);
        expect(html).toContain('amount-stack');
      });

      it('should handle negative profit values', () => {
        const amountsByType = {
          earned: { rate: 50, regularAmount: 400 },
          cost: { rate: 60, regularAmount: 480 },
          profit: { rate: -10, regularAmount: -80 }
        };
        const html = buildProfitStacks(amountsByType, (a) => a.regularAmount || 0);
        expect(html).toBeDefined();
        expect(html).toContain('amount-stack');
      });

      it('should handle accessor returning NaN', () => {
        const amountsByType = {
          earned: { rate: 'not-a-number' },
          cost: { rate: null },
          profit: { rate: undefined }
        };
        const html = buildProfitStacks(amountsByType, (a) => a.rate);
        expect(html).toBeDefined();
      });
    });

    describe('getSwatchColor edge cases', () => {
      it('should handle numeric key', () => {
        const color = getSwatchColor(123);
        expect(color).toBeTruthy();
        expect(color.startsWith('#')).toBe(true);
      });

      it('should handle object key', () => {
        const color = getSwatchColor({ id: 'test' });
        expect(color).toBeTruthy();
        expect(color.startsWith('#')).toBe(true);
      });

      it('should handle very long string key', () => {
        const longKey = 'a'.repeat(1000);
        const color = getSwatchColor(longKey);
        expect(color).toBeTruthy();
        expect(color.startsWith('#')).toBe(true);
      });

      it('should handle special characters in key', () => {
        const color = getSwatchColor('user@domain.com<script>');
        expect(color).toBeTruthy();
        expect(color.startsWith('#')).toBe(true);
      });
    });
  });

  describe('XSS Prevention - Rendering Utilities', () => {
    // Note: renderAmountStack and buildProfitStacks use predefined labels from
    // AMOUNT_STACK_ITEMS constant, not user input. The tests below verify
    // that the utility functions handle edge cases gracefully.

    it('should not allow HTML injection via color keys in getSwatchColor', () => {
      const maliciousKey = '<script>alert("xss")</script>';
      const color = getSwatchColor(maliciousKey);

      // Color should still be a valid hex color, not HTML
      expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(color).not.toContain('<');
      expect(color).not.toContain('>');
    });

    it('should return consistent colors for keys with special characters', () => {
      const specialKeys = [
        '<script>',
        '</script>',
        '"><img onerror=alert()>',
        "' OR '1'='1",
        '${alert(1)}'
      ];

      specialKeys.forEach(key => {
        const color = getSwatchColor(key);
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      });
    });

    it('should handle numeric values safely in amount stack', () => {
      // Amount stack expects numeric values - verify it handles them correctly
      const lines = [
        { label: 'Amt', value: 100 },
        { label: 'Cost', value: 0 },
        { label: 'Profit', value: -50 }
      ];

      const html = renderAmountStack(lines);

      // Should contain formatted currency values
      expect(html).toContain('$100');
      expect(html).toContain('$0');
      expect(html).toContain('amount-stack');
    });

    it('should use predefined safe labels from AMOUNT_STACK_ITEMS', () => {
      // Verify the constant contains safe, non-XSS labels
      expect(AMOUNT_STACK_ITEMS).toHaveLength(3);

      AMOUNT_STACK_ITEMS.forEach(item => {
        expect(item.label).not.toContain('<');
        expect(item.label).not.toContain('>');
        expect(item.key).toMatch(/^(earned|cost|profit)$/);
      });
    });

    it('should handle buildProfitStacks with missing amount types gracefully', () => {
      const amountsByType = {
        earned: { rate: 50 }
        // cost and profit missing
      };

      const html = buildProfitStacks(amountsByType, (a) => a?.rate || 0);

      // Should still produce valid HTML structure
      expect(html).toContain('amount-stack');
      expect(html).not.toContain('undefined');
    });

    it('should produce safe output for special CSS class context', () => {
      // Verify amount-stack CSS classes are safe and properly quoted
      const html = renderAmountStack([{ label: 'Test', value: 100 }]);

      // Classes should be alphanumeric with hyphens only
      const classMatches = html.match(/class="([^"]+)"/g);
      classMatches?.forEach(match => {
        expect(match).toMatch(/^class="[\w\s-]+"$/);
      });
    });
  });
});
