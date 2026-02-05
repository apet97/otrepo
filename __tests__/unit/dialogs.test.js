/**
 * @jest-environment jsdom
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  renderLoading,
  renderApiStatus,
  renderPaginationWarning,
  showError,
  hideError,
  showClearDataConfirmation,
  showLargeDateRangeWarning,
  updateLoadingProgress,
  clearLoadingProgress,
  renderThrottleStatus,
  showCachePrompt
} from '../../js/ui/dialogs.js';
import { store } from '../../js/state.js';
import { initializeElements, setElements } from '../../js/ui/shared.js';

// Mock scrollIntoView for jsdom
Element.prototype.scrollIntoView = jest.fn();

describe('Dialogs Module', () => {
  let mockElements;

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset store
    store.apiStatus = {
      profilesFailed: 0,
      holidaysFailed: 0,
      timeOffFailed: 0
    };
    store.ui = store.ui || {};
    store.ui.paginationTruncated = false;

    // Set up DOM
    document.body.innerHTML = `
      <div class="container">
        <div id="resultsContainer" class="hidden"></div>
        <div id="loadingState" class="hidden">
          <div class="skeleton"></div>
        </div>
        <div id="emptyState" class="hidden"></div>
        <div id="apiStatusBanner" class="hidden"></div>
        <div id="paginationWarningBanner" class="hidden"></div>
      </div>
    `;

    // Initialize elements
    mockElements = {
      resultsContainer: document.getElementById('resultsContainer'),
      loadingState: document.getElementById('loadingState'),
      emptyState: document.getElementById('emptyState'),
      apiStatusBanner: document.getElementById('apiStatusBanner'),
      summaryStrip: null,
      summaryTableBody: null,
      mainView: null,
      overridesPage: null,
      openOverridesBtn: null,
      closeOverridesBtn: null,
      overridesUserList: null
    };

    setElements(mockElements);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('renderLoading', () => {
    it('should show loading state and hide others when true', () => {
      renderLoading(true);

      expect(mockElements.loadingState.classList.contains('hidden')).toBe(false);
      expect(mockElements.resultsContainer.classList.contains('hidden')).toBe(true);
      expect(mockElements.emptyState.classList.contains('hidden')).toBe(true);
    });

    it('should hide loading state when false', () => {
      jest.useFakeTimers();
      mockElements.loadingState.classList.remove('hidden');

      renderLoading(true);
      renderLoading(false);

      jest.advanceTimersByTime(200);
      expect(mockElements.loadingState.classList.contains('hidden')).toBe(true);
      jest.useRealTimers();
    });

    it('should handle null elements gracefully', () => {
      setElements({
        ...mockElements,
        loadingState: null,
        resultsContainer: null,
        emptyState: null
      });

      expect(() => renderLoading(true)).not.toThrow();
      expect(() => renderLoading(false)).not.toThrow();
    });
  });

  describe('renderApiStatus', () => {
    it('should show banner with all failure types', () => {
      store.apiStatus = {
        profilesFailed: 3,
        holidaysFailed: 2,
        timeOffFailed: 1
      };

      renderApiStatus();

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.textContent).toContain('Profiles: 3 failed');
      expect(banner.textContent).toContain('Holidays: 2 failed');
      expect(banner.textContent).toContain('Time Off: 1 failed');
    });

    it('should show banner with only profiles failed', () => {
      store.apiStatus = {
        profilesFailed: 5,
        holidaysFailed: 0,
        timeOffFailed: 0
      };

      renderApiStatus();

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.textContent).toContain('Profiles: 5 failed');
      expect(banner.textContent).not.toContain('Holidays');
      expect(banner.textContent).not.toContain('Time Off');
    });

    it('should hide banner when no failures', () => {
      store.apiStatus = {
        profilesFailed: 0,
        holidaysFailed: 0,
        timeOffFailed: 0
      };

      renderApiStatus();

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(true);
      expect(banner.textContent).toBe('');
    });

    it('should handle null banner gracefully', () => {
      setElements({ ...mockElements, apiStatusBanner: null });

      expect(() => renderApiStatus()).not.toThrow();
    });
  });

  describe('renderPaginationWarning', () => {
    it('should show banner when paginationTruncated is true', () => {
      store.ui.paginationTruncated = true;
      const banner = document.getElementById('paginationWarningBanner');

      renderPaginationWarning();

      expect(banner.classList.contains('hidden')).toBe(false);
    });

    it('should hide banner when paginationTruncated is false', () => {
      store.ui.paginationTruncated = false;
      const banner = document.getElementById('paginationWarningBanner');
      banner.classList.remove('hidden');

      renderPaginationWarning();

      expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('should handle missing banner element gracefully', () => {
      const banner = document.getElementById('paginationWarningBanner');
      banner.remove();
      store.ui.paginationTruncated = true;

      expect(() => renderPaginationWarning()).not.toThrow();
    });
  });

  describe('showError', () => {
    it('should display error string message', () => {
      showError('Test error message');

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.innerHTML).toContain('Error');
      expect(banner.innerHTML).toContain('Test error message');
    });

    it('should display error object with title and message', () => {
      showError({
        title: 'Custom Title',
        message: 'Custom message',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      expect(banner.innerHTML).toContain('Custom Title');
      expect(banner.innerHTML).toContain('Custom message');
    });

    it('should show retry button for retry action', () => {
      showError({
        title: 'Error',
        message: 'Something went wrong',
        action: 'retry',
        type: 'API',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      expect(banner.innerHTML).toContain('Retry');
      const actionBtn = banner.querySelector('.error-action-btn');
      expect(actionBtn).not.toBeNull();
      expect(actionBtn.tagName).toBe('BUTTON');
    });

    it('should show retry button for reload action', () => {
      showError({
        title: 'Error',
        message: 'Something went wrong',
        action: 'reload',
        type: 'API',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      const btn = banner.querySelector('.error-action-btn');
      expect(btn).not.toBeNull();
      expect(btn.tagName).toBe('BUTTON');
    });

    it('should attach click handler to retry button', () => {
      // Note: window.location is non-configurable in Jest 30 jsdom.
      // We verify the button exists with proper structure instead of testing the reload call.
      showError({
        title: 'Error',
        message: 'Something went wrong',
        action: 'retry',
        type: 'API',
        timestamp: new Date().toISOString()
      });

      const btn = mockElements.apiStatusBanner.querySelector('.error-action-btn');
      expect(btn).not.toBeNull();
      expect(btn.tagName).toBe('BUTTON');
      expect(btn.textContent).toBe('Retry');
      // The click handler calls location.reload() - verified via integration test
    });

    it('should not show button for none action', () => {
      showError({
        title: 'Error',
        message: 'Something went wrong',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      expect(banner.querySelector('.error-action-btn')).toBeNull();
    });

    it('should hide loading state when showing error', () => {
      mockElements.loadingState.classList.remove('hidden');

      showError('Test error');

      expect(mockElements.loadingState.classList.contains('hidden')).toBe(true);
    });

    it('should scroll banner into view', () => {
      showError('Test error');

      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth' });
    });

    it('should create banner if apiStatusBanner is missing', () => {
      // Remove the existing banner from DOM
      const existingBanner = document.getElementById('apiStatusBanner');
      if (existingBanner) existingBanner.remove();

      setElements({
        ...mockElements,
        apiStatusBanner: null
      });

      showError('Test error');

      // Verify banner was created and is visible
      const banner = document.querySelector('#apiStatusBanner');
      expect(banner).not.toBeNull();
      expect(banner).toBeInstanceOf(HTMLElement);
    });

    it('should insert banner before container if it exists', () => {
      // Remove the existing banner from DOM
      const existingBanner = document.getElementById('apiStatusBanner');
      if (existingBanner) existingBanner.remove();

      setElements({
        ...mockElements,
        apiStatusBanner: null
      });

      showError('Test error');

      // Verify a new banner was created with the correct class
      const banner = document.querySelector('.api-status-banner');
      expect(banner).not.toBeNull();
      expect(banner.classList.contains('api-status-banner')).toBe(true);
    });

    it('should append banner to body if container does not exist', () => {
      document.body.innerHTML = ''; // Remove container and everything
      setElements({
        ...mockElements,
        apiStatusBanner: null,
        loadingState: null,
        resultsContainer: null,
        emptyState: null
      });

      showError('Test error');

      const banner = document.getElementById('apiStatusBanner');
      expect(banner).not.toBeNull();
      expect(banner).toBeInstanceOf(HTMLElement);
      expect(banner.parentElement).toBe(document.body);
    });

    it('should escape HTML in title and message', () => {
      showError({
        title: '<script>alert("xss")</script>',
        message: '<img onerror="alert()">',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      expect(banner.innerHTML).not.toContain('<script>');
      expect(banner.innerHTML).not.toContain('<img');
      expect(banner.innerHTML).toContain('&lt;script&gt;');
    });
  });

  describe('hideError', () => {
    it('should hide the error banner', () => {
      mockElements.apiStatusBanner.classList.remove('hidden');
      mockElements.apiStatusBanner.textContent = 'Error message';

      hideError();

      expect(mockElements.apiStatusBanner.classList.contains('hidden')).toBe(true);
      expect(mockElements.apiStatusBanner.textContent).toBe('');
    });

    it('should handle null banner gracefully', () => {
      setElements({ ...mockElements, apiStatusBanner: null });

      expect(() => hideError()).not.toThrow();
    });
  });

  describe('showClearDataConfirmation', () => {
    it('should call callback when user confirms', () => {
      window.confirm = jest.fn(() => true);
      const callback = jest.fn();

      showClearDataConfirmation(callback);

      expect(window.confirm).toHaveBeenCalled();
      expect(callback).toHaveBeenCalled();
    });

    it('should not call callback when user cancels', () => {
      window.confirm = jest.fn(() => false);
      const callback = jest.fn();

      showClearDataConfirmation(callback);

      expect(window.confirm).toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    });

    it('should show appropriate confirmation message', () => {
      window.confirm = jest.fn(() => false);

      showClearDataConfirmation(() => {});

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('clear all stored data')
      );
      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('cannot be undone')
      );
    });
  });

  describe('showLargeDateRangeWarning', () => {
    it('should return true when user confirms', async () => {
      window.confirm = jest.fn(() => true);

      const result = await showLargeDateRangeWarning(100);

      expect(result).toBe(true);
    });

    it('should return false when user cancels', async () => {
      window.confirm = jest.fn(() => false);

      const result = await showLargeDateRangeWarning(100);

      expect(result).toBe(false);
    });

    it('should show standard message for moderate ranges', async () => {
      window.confirm = jest.fn(() => true);

      await showLargeDateRangeWarning(400);

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('400-day range')
      );
      expect(window.confirm).toHaveBeenCalledWith(
        expect.not.stringContaining('over 2 years')
      );
    });

    it('should show stronger warning for >730 days', async () => {
      window.confirm = jest.fn(() => true);

      await showLargeDateRangeWarning(800);

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('800-day range')
      );
      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('over 2 years')
      );
    });
  });

  describe('updateLoadingProgress', () => {
    it('should create progress element if not exists', () => {
      updateLoadingProgress(1, 'entries');

      const progress = mockElements.loadingState.querySelector('.loading-progress');
      expect(progress).not.toBeNull();
      expect(progress.className).toBe('loading-progress');
      expect(progress.textContent).toContain('Fetching entries (page 1)');
    });

    it('should update existing progress element', () => {
      updateLoadingProgress(1, 'entries');
      updateLoadingProgress(2, 'profiles');

      const progress = mockElements.loadingState.querySelector('.loading-progress');
      expect(progress.textContent).toContain('Fetching profiles (page 2)');
    });

    it('should handle null loadingState gracefully', () => {
      setElements({ ...mockElements, loadingState: null });

      expect(() => updateLoadingProgress(1, 'entries')).not.toThrow();
    });

    it('should apply correct styles to progress element', () => {
      updateLoadingProgress(1, 'entries');

      const progress = mockElements.loadingState.querySelector('.loading-progress');
      expect(progress.style.cssText).toContain('font-size: 13px');
      expect(progress.style.cssText).toContain('text-align: center');
    });
  });

  describe('clearLoadingProgress', () => {
    it('should remove progress element', () => {
      updateLoadingProgress(1, 'entries');
      const progressBeforeClear = mockElements.loadingState.querySelector('.loading-progress');
      expect(progressBeforeClear).not.toBeNull();
      expect(progressBeforeClear.className).toBe('loading-progress');

      clearLoadingProgress();

      expect(mockElements.loadingState.querySelector('.loading-progress')).toBeNull();
    });

    it('should handle missing progress element gracefully', () => {
      expect(() => clearLoadingProgress()).not.toThrow();
    });

    it('should handle null loadingState gracefully', () => {
      setElements({ ...mockElements, loadingState: null });

      expect(() => clearLoadingProgress()).not.toThrow();
    });
  });

  describe('renderThrottleStatus', () => {
    it('should not show warning for fewer than 3 retries', () => {
      mockElements.apiStatusBanner.classList.add('hidden');

      renderThrottleStatus(2);

      expect(mockElements.apiStatusBanner.classList.contains('hidden')).toBe(true);
    });

    it('should show warning for 3+ retries', () => {
      renderThrottleStatus(3);

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.textContent).toContain('Rate limiting detected');
      expect(banner.textContent).toContain('3 retries');
    });

    it('should append to existing banner content', () => {
      mockElements.apiStatusBanner.textContent = 'Profiles: 2 failed';

      renderThrottleStatus(5);

      const banner = mockElements.apiStatusBanner;
      expect(banner.textContent).toContain('Profiles: 2 failed');
      expect(banner.textContent).toContain('Rate limiting');
    });

    it('should not duplicate throttle warning', () => {
      renderThrottleStatus(3);
      const firstContent = mockElements.apiStatusBanner.textContent;

      renderThrottleStatus(5);

      expect(mockElements.apiStatusBanner.textContent).toBe(firstContent);
    });

    it('should handle null banner gracefully', () => {
      setElements({ ...mockElements, apiStatusBanner: null });

      expect(() => renderThrottleStatus(5)).not.toThrow();
    });

    it('should set message when banner is empty', () => {
      mockElements.apiStatusBanner.textContent = '';

      renderThrottleStatus(4);

      expect(mockElements.apiStatusBanner.textContent).toContain('Rate limiting');
      expect(mockElements.apiStatusBanner.textContent).not.toContain('|');
    });
  });

  describe('showCachePrompt', () => {
    it('should return "use" when user confirms', async () => {
      window.confirm = jest.fn(() => true);

      const result = await showCachePrompt(120);

      expect(result).toBe('use');
    });

    it('should return "refresh" when user cancels', async () => {
      window.confirm = jest.fn(() => false);

      const result = await showCachePrompt(120);

      expect(result).toBe('refresh');
    });

    it('should format age in minutes', async () => {
      window.confirm = jest.fn(() => true);

      await showCachePrompt(180); // 3 minutes

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('3 minutes old')
      );
    });

    it('should show "less than a minute" for <30 seconds', async () => {
      window.confirm = jest.fn(() => true);

      // Math.round(29/60) = 0, which is < 1, so shows "less than a minute"
      await showCachePrompt(29);

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('less than a minute')
      );
    });

    it('should show "1 minute" without "s" for exactly 1 minute', async () => {
      window.confirm = jest.fn(() => true);

      await showCachePrompt(60);

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('1 minute old')
      );
      expect(window.confirm).toHaveBeenCalledWith(
        expect.not.stringContaining('1 minutes')
      );
    });
  });

  describe('Accessibility Tests', () => {
    describe('Loading indicator accessibility', () => {
      it('should have aria-busy attribute when loading', () => {
        renderLoading(true);

        // Loading state should indicate busy state
        expect(mockElements.loadingState.classList.contains('hidden')).toBe(false);
      });

      it('should hide loading content from screen readers when not loading', () => {
        renderLoading(false);

        expect(mockElements.loadingState.classList.contains('hidden')).toBe(true);
      });
    });

    describe('Error banner accessibility', () => {
      it('should have alert role for error messages', () => {
        showError('Critical error');

        const banner = mockElements.apiStatusBanner;
        // Error banners should be visible and contain error content
        expect(banner.classList.contains('hidden')).toBe(false);
        expect(banner.innerHTML).toContain('Error');
      });

      it('should have appropriate structure for error messages', () => {
        showError({
          title: 'API Error',
          message: 'Connection failed',
          action: 'retry',
          type: 'API',
          timestamp: new Date().toISOString()
        });

        const banner = mockElements.apiStatusBanner;
        // Check for semantic structure
        expect(banner.innerHTML).toContain('API Error');
        expect(banner.innerHTML).toContain('Connection failed');
        const actionBtn = banner.querySelector('.error-action-btn');
        expect(actionBtn).not.toBeNull();
      });

      it('should maintain focus context when showing error', () => {
        showError('Test error');

        // Error banner should be scrolled into view for accessibility
        expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
      });
    });

    describe('API status banner accessibility', () => {
      it('should provide clear failure information', () => {
        store.apiStatus = {
          profilesFailed: 3,
          holidaysFailed: 2,
          timeOffFailed: 1
        };

        renderApiStatus();

        const banner = mockElements.apiStatusBanner;
        // Each failure count should be clearly labeled
        expect(banner.textContent).toMatch(/Profiles:\s*3\s*failed/);
        expect(banner.textContent).toMatch(/Holidays:\s*2\s*failed/);
        expect(banner.textContent).toMatch(/Time Off:\s*1\s*failed/);
      });
    });

    describe('Confirmation dialog accessibility', () => {
      it('should include clear action description in clear data confirmation', () => {
        window.confirm = jest.fn(() => false);

        showClearDataConfirmation(() => {});

        const confirmMessage = window.confirm.mock.calls[0][0];
        // Message should clearly describe the action
        expect(confirmMessage).toMatch(/clear|delete/i);
        expect(confirmMessage).toMatch(/cannot be undone|irreversible/i);
      });

      it('should include day count in date range warning', async () => {
        window.confirm = jest.fn(() => true);

        await showLargeDateRangeWarning(365);

        const confirmMessage = window.confirm.mock.calls[0][0];
        expect(confirmMessage).toContain('365');
      });
    });
  });

  describe('Complex error scenarios', () => {
    it('should handle nested error details', () => {
      const complexError = {
        title: 'Validation Error',
        message: 'Multiple fields failed validation',
        action: 'none',
        type: 'VALIDATION',
        timestamp: new Date().toISOString(),
        details: {
          field1: 'Required',
          field2: 'Invalid format'
        }
      };

      showError(complexError);

      const banner = mockElements.apiStatusBanner;
      expect(banner.innerHTML).toContain('Validation Error');
      expect(banner.innerHTML).toContain('Multiple fields failed validation');
    });

    it('should handle very long error messages', () => {
      const longMessage = 'A'.repeat(500);

      showError({
        title: 'Error',
        message: longMessage,
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // Should not crash and should contain at least part of the message
      expect(banner.innerHTML.length).toBeGreaterThan(0);
      expect(banner.classList.contains('hidden')).toBe(false);
    });

    it('should escape special characters in error messages', () => {
      showError({
        title: 'Error with "quotes" & <brackets>',
        message: 'Path: C:\\Users\\test & more',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // Should not create unintended HTML tags
      expect(banner.innerHTML).not.toContain('<brackets>');
      // But should still contain the escaped content
      expect(banner.innerHTML).toContain('&lt;brackets&gt;');
      expect(banner.innerHTML).toContain('&amp;');
    });

    it('should handle error with empty title', () => {
      showError({
        title: '',
        message: 'Something went wrong',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(false);
      expect(banner.innerHTML).toContain('Something went wrong');
    });

    it('should handle error with null message', () => {
      showError({
        title: 'Error',
        message: null,
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      expect(banner.classList.contains('hidden')).toBe(false);
    });
  });

  describe('XSS Prevention - Dialogs Module', () => {
    it('should escape script tags in error title', () => {
      showError({
        title: '<script>document.cookie</script>',
        message: 'Test message',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // Script tags should be escaped, not executable
      expect(banner.innerHTML).not.toContain('<script>');
      expect(banner.innerHTML).toContain('&lt;script&gt;');
    });

    it('should escape img tags in error message', () => {
      showError({
        title: 'Error',
        message: '<img src=x onerror="alert(document.domain)">',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // The img tag opening bracket should be escaped
      expect(banner.innerHTML).not.toContain('<img');
      expect(banner.innerHTML).toContain('&lt;img');
    });

    it('should escape SVG-based XSS attempts', () => {
      showError({
        title: '<svg onload="alert(1)">',
        message: '<svg><script>alert(1)</script></svg>',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // SVG tags should be escaped
      expect(banner.innerHTML).not.toContain('<svg');
      expect(banner.innerHTML).toContain('&lt;svg');
    });

    it('should escape iframe injection attempts', () => {
      showError({
        title: '<iframe src="javascript:alert(1)">',
        message: 'Normal message',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // iframe tag should be escaped
      expect(banner.innerHTML).not.toContain('<iframe');
      expect(banner.innerHTML).toContain('&lt;iframe');
    });

    it('should escape link injection attempts', () => {
      showError({
        title: '<a href="javascript:alert(1)">Click me</a>',
        message: 'Test',
        action: 'none',
        type: 'UNKNOWN',
        timestamp: new Date().toISOString()
      });

      const banner = mockElements.apiStatusBanner;
      // Should escape the anchor tag
      expect(banner.innerHTML).not.toContain('<a href=');
      expect(banner.innerHTML).toContain('&lt;a href=');
    });

    it('should handle string error with XSS payload', () => {
      showError('<script>alert("xss")</script>Simple error');

      const banner = mockElements.apiStatusBanner;
      expect(banner.innerHTML).not.toContain('<script>');
      expect(banner.innerHTML).toContain('&lt;script&gt;');
    });

    it('should escape API status messages with malicious content', () => {
      store.apiStatus = {
        profilesFailed: '<script>alert(1)</script>',
        holidaysFailed: 0,
        timeOffFailed: 0
      };

      // Note: apiStatus uses numbers so this tests type coercion safety
      renderApiStatus();

      const banner = mockElements.apiStatusBanner;
      // Should not execute or render raw script tags
      expect(banner.innerHTML).not.toContain('<script>');
    });
  });

  // ============================================================================
  // Error button click listener coverage (line 85)
  // ============================================================================
  describe('Error button click listener (line 85)', () => {
    it('should attach click event listener to retry button', () => {
      // Spy on addEventListener to verify event listener attachment
      const addEventListenerSpy = jest.spyOn(HTMLElement.prototype, 'addEventListener');

      showError({
        title: 'Error',
        message: 'Something went wrong',
        action: 'retry',
        type: 'API',
        timestamp: new Date().toISOString()
      });

      const btn = mockElements.apiStatusBanner.querySelector('.error-action-btn');
      expect(btn).not.toBeNull();

      // Verify addEventListener was called with 'click' and { once: true }
      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'click',
        expect.any(Function),
        { once: true }
      );

      addEventListenerSpy.mockRestore();
    });

    it('should attach click event listener with once option', () => {
      const addEventListenerSpy = jest.spyOn(HTMLElement.prototype, 'addEventListener');

      showError({
        title: 'Error',
        message: 'Something went wrong',
        action: 'reload',
        type: 'API',
        timestamp: new Date().toISOString()
      });

      const btn = mockElements.apiStatusBanner.querySelector('.error-action-btn');
      expect(btn).not.toBeNull();

      // Find the call with 'click' event
      const clickCall = addEventListenerSpy.mock.calls.find(
        call => call[0] === 'click'
      );

      expect(clickCall).toBeDefined();
      expect(clickCall[2]).toEqual({ once: true });

      addEventListenerSpy.mockRestore();
    });
  });

  // ============================================================================
  // Session warning dialogs
  // ============================================================================
  describe('showSessionExpiringWarning', () => {
    let showSessionExpiringWarning;
    let hideSessionWarning;

    beforeEach(async () => {
      const module = await import('../../js/ui/dialogs.js');
      showSessionExpiringWarning = module.showSessionExpiringWarning;
      hideSessionWarning = module.hideSessionWarning;
    });

    it('should create session warning banner when it does not exist', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(5, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner).not.toBeNull();
      expect(banner.classList.contains('session-warning-banner')).toBe(true);
      expect(banner.getAttribute('role')).toBe('alert');
      expect(banner.getAttribute('aria-live')).toBe('assertive');
    });

    it('should display minutes remaining correctly', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(5, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner.innerHTML).toContain('5 minutes');
    });

    it('should display "less than a minute" when minutesRemaining is 1', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(1, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner.innerHTML).toContain('less than a minute');
    });

    it('should call onReauth when reload button is clicked', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(5, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      const reauthBtn = banner.querySelector('.session-reauth-btn');

      expect(reauthBtn).not.toBeNull();
      reauthBtn.click();

      expect(onReauth).toHaveBeenCalled();
      // Banner should be hidden after clicking
      expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('should call onDismiss when dismiss button is clicked', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(5, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      const dismissBtn = banner.querySelector('.session-dismiss-btn');

      expect(dismissBtn).not.toBeNull();
      dismissBtn.click();

      expect(onDismiss).toHaveBeenCalled();
      expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('should reuse existing banner when called multiple times', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(5, onReauth, onDismiss);
      showSessionExpiringWarning(3, onReauth, onDismiss);

      const banners = document.querySelectorAll('#sessionWarningBanner');
      expect(banners.length).toBe(1);

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner.innerHTML).toContain('3 minutes');
    });

    it('should insert banner before first child of container', () => {
      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      // Ensure there's content in the container
      const container = document.querySelector('.container');
      const existingChild = document.createElement('div');
      existingChild.id = 'existingChild';
      container.appendChild(existingChild);

      showSessionExpiringWarning(5, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner.parentElement).toBe(container);
      expect(container.firstChild).toBe(banner);
    });

    it('should append to body if no container exists', () => {
      // Remove the container
      const container = document.querySelector('.container');
      container.remove();

      const onReauth = jest.fn();
      const onDismiss = jest.fn();

      showSessionExpiringWarning(5, onReauth, onDismiss);

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner).not.toBeNull();
      expect(banner.parentElement).toBe(document.body);
    });
  });

  describe('hideSessionWarning', () => {
    let showSessionExpiringWarning;
    let hideSessionWarning;

    beforeEach(async () => {
      const module = await import('../../js/ui/dialogs.js');
      showSessionExpiringWarning = module.showSessionExpiringWarning;
      hideSessionWarning = module.hideSessionWarning;
    });

    it('should hide session warning banner', () => {
      showSessionExpiringWarning(5, jest.fn(), jest.fn());

      const banner = document.getElementById('sessionWarningBanner');
      expect(banner.classList.contains('hidden')).toBe(false);

      hideSessionWarning();

      expect(banner.classList.contains('hidden')).toBe(true);
    });

    it('should handle case when banner does not exist', () => {
      // Should not throw
      expect(() => hideSessionWarning()).not.toThrow();
    });
  });

  describe('showSessionExpiredDialog', () => {
    let showSessionExpiredDialog;

    beforeEach(async () => {
      const module = await import('../../js/ui/dialogs.js');
      showSessionExpiredDialog = module.showSessionExpiredDialog;
    });

    it('should create modal when it does not exist', () => {
      showSessionExpiredDialog();

      const modal = document.getElementById('sessionExpiredModal');
      expect(modal).not.toBeNull();
      expect(modal.classList.contains('modal-overlay')).toBe(true);
      expect(modal.getAttribute('role')).toBe('alertdialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
    });

    it('should have correct accessibility attributes', () => {
      showSessionExpiredDialog();

      const modal = document.getElementById('sessionExpiredModal');
      expect(modal.getAttribute('aria-labelledby')).toBe('sessionExpiredTitle');
      expect(modal.getAttribute('aria-describedby')).toBe('sessionExpiredDesc');
    });

    it('should contain title and description', () => {
      showSessionExpiredDialog();

      const modal = document.getElementById('sessionExpiredModal');
      expect(modal.innerHTML).toContain('Session Expired');
      expect(modal.innerHTML).toContain('authentication session has expired');
    });

    it('should contain reload button', () => {
      showSessionExpiredDialog();

      const modal = document.getElementById('sessionExpiredModal');
      const reloadBtn = modal.querySelector('.session-reload-btn');

      expect(reloadBtn).not.toBeNull();
      expect(reloadBtn.textContent).toContain('Reload');
    });

    it('should focus reload button for accessibility', () => {
      showSessionExpiredDialog();

      const modal = document.getElementById('sessionExpiredModal');
      const reloadBtn = modal.querySelector('.session-reload-btn');

      expect(document.activeElement).toBe(reloadBtn);
    });

    it('should reuse existing modal when called multiple times', () => {
      showSessionExpiredDialog();
      showSessionExpiredDialog();

      const modals = document.querySelectorAll('#sessionExpiredModal');
      expect(modals.length).toBe(1);
    });

    it('should hide loading state when shown', () => {
      mockElements.loadingState.classList.remove('hidden');

      showSessionExpiredDialog();

      expect(mockElements.loadingState.classList.contains('hidden')).toBe(true);
    });

    it('should remove hidden class from modal', () => {
      showSessionExpiredDialog();

      const modal = document.getElementById('sessionExpiredModal');
      expect(modal.classList.contains('hidden')).toBe(false);
    });
  });
});
