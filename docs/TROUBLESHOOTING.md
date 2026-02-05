# OTPLUS Troubleshooting Guide

**Version:** 2.0.0
**Last Updated:** February 2026
**Audience:** End Users, Support Staff

---

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Common Errors](#common-errors)
3. [Debug Mode](#debug-mode)
4. [Performance Issues](#performance-issues)
5. [Data Issues](#data-issues)
6. [Browser-Specific Issues](#browser-specific-issues)
7. [Self-Service Fixes](#self-service-fixes)

---

## Quick Diagnostics

### Check Application Health

Open your browser's Developer Console (F12 or Cmd+Option+I) and run:

```javascript
// Get application diagnostics
window.__OTPLUS_DIAGNOSTICS__()
```

This returns:
- `version` - Application version
- `isAuthenticated` - Whether the user is authenticated
- `cacheStats` - Profile, holiday, and time-off cache sizes
- `apiStatus` - Any API failures
- `throttleStatus` - Rate limiting information
- `dateRange` - Currently selected date range

### Check Network Issues

1. Open Developer Tools (F12)
2. Go to the **Network** tab
3. Regenerate the report
4. Look for requests with red status or errors

---

## Common Errors

### "No authentication token provided"

**Cause:** The addon was opened outside of Clockify.

**Solution:**
1. Close the current tab
2. Open Clockify and access the addon through the Clockify interface
3. The addon only works when embedded in Clockify

---

### "Failed to fetch initial detailed report page"

**Causes:**
- Clockify API is experiencing issues
- Network connectivity problems
- Rate limiting

**Solutions:**
1. Check Clockify status at [status.clockify.me](https://status.clockify.me)
2. Wait 30 seconds and click **Generate Report** again
3. If you see a yellow "API throttled" banner, wait for it to clear
4. Try a smaller date range

---

### "Circuit breaker is open"

**Cause:** Multiple consecutive API failures triggered the safety mechanism.

**Solution:**
1. Wait 30 seconds for automatic recovery
2. If the issue persists, reload the page
3. Check if Clockify API is experiencing issues

---

### "Authentication Error" / "Session expired"

**Cause:** Your Clockify session has expired.

**Solution:**
1. Reload the Clockify page (not just the addon)
2. This refreshes your authentication token

---

### "localStorage quota exceeded"

**Cause:** Browser storage is full.

**Solution:**
1. Clear OTPLUS data:
   ```javascript
   // Run in browser console
   Object.keys(localStorage)
     .filter(k => k.startsWith('otplus_') || k.startsWith('overtime_'))
     .forEach(k => localStorage.removeItem(k));
   location.reload();
   ```
2. Or clear all site data for Clockify in browser settings

---

### Numbers Don't Match Expected Values

**Causes:**
- Capacity settings don't match your expectations
- Holidays or time-off not being applied
- User overrides are set

**Solutions:**
1. Check the **Settings** panel:
   - Verify "Use profile capacity" is enabled if you want per-user capacities
   - Verify "Apply holidays" and "Apply time-off" are enabled
2. Check **Overrides** panel for any user-specific settings
3. Verify the date range covers the expected period
4. Compare with the **Detailed** tab to see entry-by-entry breakdown

---

## Debug Mode

### Enable Debug Logging

```javascript
// Enable detailed logging
localStorage.setItem('otplus_debug', 'true');
location.reload();
```

With debug mode enabled, you'll see:
- Detailed timing information in the console
- API request/response details
- Calculation step-by-step logs

### Disable Debug Mode

```javascript
localStorage.removeItem('otplus_debug');
location.reload();
```

### Enable JSON Log Format

For structured logs (useful for log aggregation):

```javascript
localStorage.setItem('otplus_log_format', 'json');
location.reload();
```

### View Metrics

```javascript
// View performance metrics
window.__OTPLUS_METRICS__.summary()

// Export metrics in Prometheus format
window.__OTPLUS_METRICS__.prometheus()
```

---

## Performance Issues

### Report Generation is Slow

**Typical causes:**
- Large date range (> 90 days)
- Many users in workspace (> 100)
- Slow network connection

**Solutions:**
1. **Reduce date range** - Try 30 days instead of 90
2. **Use cached results** - When prompted, choose "Use Cached" for unchanged data
3. **Check your connection** - Slow networks increase API response times

### Performance Guidelines

| Users | Recommended Date Range |
|-------|----------------------|
| < 20  | Up to 90 days |
| 20-100 | Up to 30 days |
| 100-500 | Up to 14 days |
| 500+ | Up to 7 days |

### Browser Becomes Unresponsive

**Cause:** Processing too many entries at once.

**Solutions:**
1. Reduce the date range
2. Close other browser tabs to free memory
3. Try a different browser (Chrome recommended)

---

## Data Issues

### Missing Users in Report

**Causes:**
- Users have no time entries in the selected date range
- Users were added after the date range

**Solution:**
- Verify the user has logged time entries in Clockify for the selected dates

### Missing Time Entries

**Cause:** The 10,000 entry limit was reached.

**Check:**
```javascript
window.__OTPLUS_DIAGNOSTICS__().cacheStats
```

If you see a warning about pagination truncation:
1. Reduce the date range
2. Generate reports in smaller chunks

### Holidays/Time-Off Not Applied

**Check:**
1. Verify "Apply holidays" and "Apply time-off" are enabled in Settings
2. Check if the data was loaded:
   ```javascript
   const diag = window.__OTPLUS_DIAGNOSTICS__();
   console.log('Holidays loaded:', diag.cacheStats.holidaysCount);
   console.log('Time-off loaded:', diag.cacheStats.timeOffCount);
   ```
3. If counts are 0, the data may have failed to load - regenerate the report

---

## Browser-Specific Issues

### Safari: Storage Restrictions

**Issue:** Safari's Intelligent Tracking Prevention may block storage.

**Solutions:**
1. Disable "Prevent cross-site tracking" temporarily
2. Or use Chrome/Firefox instead

### Firefox: Private Browsing

**Issue:** localStorage is disabled in private browsing.

**Impact:** Settings won't persist between sessions, but the app still works.

### Mobile Browsers

**Issue:** Mobile browsers may have aggressive memory limits.

**Solutions:**
1. Use smaller date ranges
2. Close other browser tabs
3. Use desktop browser for large reports

---

## Self-Service Fixes

### Reset All Settings

```javascript
// Clear all OTPLUS data and reset
Object.keys(localStorage)
  .filter(k => k.startsWith('otplus_') || k.startsWith('overtime_'))
  .forEach(k => localStorage.removeItem(k));
sessionStorage.removeItem('otplus_report_cache');
location.reload();
```

### Force Fresh Data Fetch

1. Click the **Refresh** button in the UI, OR
2. Run in console:
   ```javascript
   sessionStorage.removeItem('otplus_report_cache');
   ```
3. Generate the report again

### Clear Report Cache Only

```javascript
sessionStorage.removeItem('otplus_report_cache');
```

### Export Diagnostic Information

When contacting support, include this:

```javascript
console.log('=== OTPLUS SUPPORT INFO ===');
console.log(JSON.stringify(window.__OTPLUS_DIAGNOSTICS__(), null, 2));
```

---

## Getting Help

If the above solutions don't resolve your issue:

1. **Collect diagnostics:**
   ```javascript
   JSON.stringify(window.__OTPLUS_DIAGNOSTICS__(), null, 2)
   ```

2. **Note the error message** (screenshot if possible)

3. **Note your browser and version**

4. **Contact support** with this information

---

## FAQ

**Q: Why do I need to access OTPLUS through Clockify?**
A: OTPLUS requires a valid Clockify authentication token that's only provided when embedded in the Clockify interface.

**Q: Is my data stored securely?**
A: Yes. Authentication tokens are never stored in persistent storage. Configuration preferences are saved locally in your browser. When `encryptStorage` is enabled, overrides are encrypted with AES-GCM before being written to localStorage.

**Q: Can I use OTPLUS offline?**
A: No. OTPLUS requires live access to Clockify APIs to fetch your time entries.

**Q: Why is the addon slower for large workspaces?**
A: OTPLUS fetches profile, holiday, and time-off data for each user, which requires multiple API calls.

---

*Last updated: February 2026*
