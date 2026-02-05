# OTPLUS Operational Runbook

**Version:** 2.0.0
**Last Updated:** February 2026
**Audience:** Support Engineers, On-Call Staff

---

## Table of Contents

1. [Quick Reference](#quick-reference)
2. [Incident Response](#incident-response)
3. [Common Issues & Resolutions](#common-issues--resolutions)
4. [Escalation Paths](#escalation-paths)
5. [Diagnostic Procedures](#diagnostic-procedures)
6. [Recovery Procedures](#recovery-procedures)

---

## Quick Reference

### Key Contacts

| Role | Contact | Escalation Time |
|------|---------|-----------------|
| Primary On-Call | See PagerDuty | Immediate |
| Engineering Lead | TBD | 15 minutes |
| Clockify Support | support@clockify.me | External dependency |

### Status Check Commands

```javascript
// In browser console on affected user's machine:

// 1. Check application health
window.__OTPLUS_HEALTH_CHECK__()
// Returns: { status: 'healthy'|'degraded'|'unhealthy', components: {...}, issues: [...] }

// 2. Check application diagnostics
window.__OTPLUS_DIAGNOSTICS__()

// 3. Enable debug logging
localStorage.setItem('otplus_debug', 'true')

// 4. Check storage status
console.log('localStorage used:', JSON.stringify(localStorage).length)

// 5. View performance metrics
window.__OTPLUS_METRICS__.summary()

// 6. Export Prometheus metrics
window.__OTPLUS_METRICS__.prometheus()
```

### Quick Actions

| Issue | Quick Fix |
|-------|-----------|
| App not loading | Clear cache and reload |
| Data not appearing | Check date range, refresh |
| Slow performance | Reduce date range |
| Rate limit errors | Wait 30 seconds, retry |
| Storage errors | Clear OTPLUS data |

---

## Incident Response

### Severity Levels

| Level | Description | Response Time | Example |
|-------|-------------|---------------|---------|
| SEV1 | Complete outage | < 15 min | App won't load for any user |
| SEV2 | Major functionality broken | < 1 hour | Calculations returning wrong values |
| SEV3 | Minor functionality affected | < 4 hours | Export not working |
| SEV4 | Cosmetic/low impact | Next business day | UI alignment issue |

### Incident Response Steps

1. **Acknowledge** - Confirm receipt within 5 minutes
2. **Assess** - Determine severity and impact
3. **Communicate** - Update status page/stakeholders
4. **Diagnose** - Use diagnostic procedures below
5. **Mitigate** - Apply quick fixes if available
6. **Resolve** - Implement permanent fix
7. **Document** - Post-incident review

---

## Common Issues & Resolutions

### Issue: "Failed to fetch initial detailed report page"

**Symptoms:**
- Error message on report generation
- Console shows network errors

**Diagnosis:**
1. Check browser network tab for failed requests
2. Verify Clockify API status at status.clockify.me
3. Check user's authentication token validity

**Resolution:**
1. If Clockify API is down: Wait for recovery
2. If token expired: Reload the Clockify page (new token issued)
3. If network issue: Check user's internet connection

**Escalation:** If persists > 30 minutes, escalate to SEV2

---

### Issue: "Circuit breaker is open"

**Symptoms:**
- Requests immediately fail with status 503
- Console shows "Circuit breaker open" messages

**Diagnosis:**
```javascript
// Check circuit breaker state
// (if exported, otherwise check console logs)
console.log('Circuit breaker tripped due to repeated failures')
```

**Resolution:**
1. Wait 30 seconds for auto-recovery attempt
2. If Clockify API is healthy, circuit will close
3. If issue persists, check Clockify API status

**Root Cause:** Usually indicates Clockify API instability

---

### Issue: "localStorage quota exceeded"

**Symptoms:**
- Console shows QuotaExceededError
- Config changes not persisting
- Warning about fallback storage

**Diagnosis:**
```javascript
// Check storage usage
const used = JSON.stringify(localStorage).length;
console.log(`Storage used: ${(used/1024).toFixed(2)} KB`);
```

**Resolution:**
1. Clear OTPLUS cached data:
   ```javascript
   // Clear all OTPLUS data
   Object.keys(localStorage)
     .filter(k => k.startsWith('otplus_') || k.startsWith('overtime_'))
     .forEach(k => localStorage.removeItem(k));
   ```
2. Clear browser cache for the domain
3. Check for other extensions consuming storage

---

### Issue: Slow Report Generation

**Symptoms:**
- Loading spinner for > 30 seconds
- Browser becomes unresponsive

**Diagnosis:**
1. Check date range (> 90 days is slow)
2. Check user count in workspace
3. Enable debug timing:
   ```javascript
   localStorage.setItem('otplus_debug', 'true');
   ```

**Resolution:**
1. Reduce date range to 30 days or less
2. If large workspace, generate reports by team
3. Use cached results when available

---

### Issue: Incorrect Overtime Calculations

**Symptoms:**
- Numbers don't match expected values
- Discrepancy between OTPLUS and manual calculation

**Diagnosis:**
1. Check capacity settings match user expectation
2. Verify holiday/time-off data was loaded
3. Check for user overrides

```javascript
// Get diagnostics
const diag = window.__OTPLUS_DIAGNOSTICS__();
console.log('Profiles loaded:', diag.cacheStats.profilesCount);
console.log('Holidays loaded:', diag.cacheStats.holidaysCount);
```

**Resolution:**
1. Verify profile capacity in Clockify matches expectation
2. Check if holidays/time-off should be applied
3. Clear cache and regenerate report
4. Compare with detailed entries view

**Escalation:** If calculation logic appears wrong, escalate to engineering

---

### Issue: Rate Limit (429) Errors

**Symptoms:**
- Yellow warning banner shows "API throttled"
- Requests slowing down significantly

**Diagnosis:**
```javascript
const diag = window.__OTPLUS_DIAGNOSTICS__();
console.log('Throttle retries:', diag.throttleStatus.retryCount);
```

**Resolution:**
1. Wait for automatic retry (addon handles this)
2. If persistent, reduce concurrent usage
3. Check if other integrations are consuming API quota

---

### Issue: Authentication Errors (401/403)

**Symptoms:**
- "Authentication Error" message
- Token-related errors in console

**Resolution:**
1. Reload the Clockify page (issues fresh token)
2. Check user permissions in Clockify
3. Verify addon is enabled for the workspace

---

## Escalation Paths

### When to Escalate

| Condition | Action |
|-----------|--------|
| SEV1 incident | Immediate escalation to engineering lead |
| Issue persists > 1 hour | Escalate to engineering |
| Data corruption suspected | Escalate to engineering |
| Security concern | Escalate to security team |
| Clockify API issue | Contact Clockify support |

### Escalation Information to Include

1. **User context:**
   - Workspace ID (hashed from diagnostics)
   - Browser and version
   - Date/time of issue

2. **Diagnostic output:**
   ```javascript
   JSON.stringify(window.__OTPLUS_DIAGNOSTICS__(), null, 2)
   ```

3. **Console errors:**
   - Screenshot or copy of browser console
   - Network tab failures

4. **Steps to reproduce:**
   - Date range used
   - Actions taken before error

---

## Diagnostic Procedures

### Full Diagnostic Collection

```javascript
// Run in browser console:

// 1. Get application diagnostics
const diag = window.__OTPLUS_DIAGNOSTICS__();
console.log('=== OTPLUS DIAGNOSTICS ===');
console.log(JSON.stringify(diag, null, 2));

// 2. Check storage
console.log('\n=== STORAGE STATUS ===');
const storageKeys = Object.keys(localStorage)
  .filter(k => k.startsWith('otplus_') || k.startsWith('overtime_'));
console.log('OTPLUS keys:', storageKeys);
console.log('Total storage:', JSON.stringify(localStorage).length, 'bytes');

// 3. Check for errors
console.log('\n=== RECENT ERRORS ===');
console.log('Check console above for any red error messages');
```

### Network Diagnostic

1. Open browser Developer Tools (F12)
2. Go to Network tab
3. Reproduce the issue
4. Look for:
   - Failed requests (red)
   - 429 status codes (rate limit)
   - 401/403 status codes (auth)
   - 5xx status codes (server error)

### Performance Diagnostic

```javascript
// Enable performance timing
localStorage.setItem('otplus_debug', 'true');

// Reproduce issue, then check console for timing logs:
// [DEBUG] [Calc] Processing took: XXXms
```

---

## Recovery Procedures

### Procedure: Clear All OTPLUS Data

**Use when:** Corrupted state, persistent errors

```javascript
// Clear all OTPLUS data from localStorage
Object.keys(localStorage)
  .filter(k => k.startsWith('otplus_') || k.startsWith('overtime_'))
  .forEach(k => localStorage.removeItem(k));

// Clear session storage
sessionStorage.removeItem('otplus_report_cache');

// Reload page
location.reload();
```

### Procedure: Reset to Factory Defaults

**Use when:** Complete reset needed

1. Clear browser data for Clockify domain
2. Disable and re-enable the addon in Clockify
3. Reload the page

### Procedure: Force Cache Refresh

**Use when:** Stale data suspected

1. Click any "Refresh" button in the UI
2. Or programmatically:
   ```javascript
   sessionStorage.removeItem('otplus_report_cache');
   ```
3. Regenerate the report

### Procedure: Recover from Circuit Breaker

**Use when:** Circuit breaker stuck open

1. Wait 30 seconds for automatic recovery
2. If still stuck:
   ```javascript
   // Reload the page to reset circuit breaker state
   location.reload();
   ```

---

## Monitoring Checklist

### Daily Checks

- [ ] Check error tracking (Sentry) for new issues
- [ ] Review any user-reported problems
- [ ] Verify Clockify API status

### Weekly Checks

- [ ] Review error trends in Sentry
- [ ] Check dependency security advisories
- [ ] Review performance metrics

### Monthly Checks

- [ ] Review and update runbook if needed
- [ ] Check for new Clockify API changes
- [ ] Review and rotate any credentials

---

## Appendix: Error Code Reference

| Error | Meaning | Action |
|-------|---------|--------|
| 401 | Invalid/expired token | Reload page |
| 403 | Permission denied | Check user permissions |
| 404 | Resource not found | Check workspace/user IDs |
| 429 | Rate limited | Wait and retry |
| 500 | Clockify server error | Wait and retry |
| 503 | Circuit breaker open | Wait 30s |

---

*This runbook should be reviewed and updated quarterly or after any significant incident.*
