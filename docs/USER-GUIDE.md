# OTPLUS User Guide

This guide is for administrators and managers using the OTPLUS addon to generate overtime reports in Clockify.

---

## Getting Started

### What is OTPLUS
OTPLUS is a Clockify addon that provides advanced overtime analysis. It helps managers and payroll admins accurately track working hours, capacity utilization, and billable hour breakdowns while respecting individual employee schedules and regional holidays.

### How to Access the Addon
OTPLUS is available as an addon within your Clockify workspace. Access it through the Clockify interface where addons are installed.

---

## Generating Reports

### Selecting Date Range
Use the date picker to choose your reporting period. Two quick selectors are available:
- **Last Month** - Automatically selects the previous calendar month
- **This Month** - Automatically selects the current calendar month

If you select a very large range (more than 365 days), OTPLUS will ask for confirmation before fetching.

### Generate
- Click **Generate** to start building the report

If cached data exists for the same date range, OTPLUS will prompt you to reuse it or refresh for the latest data.

---

## Understanding the Views

### Summary View
The summary view provides aggregated data with:
- **Total hours breakdown** - Regular hours vs overtime hours
- **Billable vs non-billable** - See how time is categorized
- **Grouping options** - Organize data by:
  - User
  - Project
  - Client
  - Task
  - Date
  - Week

### Detailed View
The detailed view shows an entry-by-entry breakdown:
- **Pagination** - 50 entries per page for fast rendering
- **Status badges** - Visual indicators for special day types:
  - `HOLIDAY ENTRY` - Holiday time entry (counts as regular hours, does not affect capacity)
  - `TIME-OFF ENTRY` - Time-off time entry (counts as regular hours, does not affect capacity)
  - `HOLIDAY` - Company holiday
  - `OFF-DAY` - Non-working day per user's schedule
  - `TIME-OFF` - Day with approved time-off (work on this day is overtime)
  - `BREAK` - Break time entries
- **Columns include**:
  - Date, Start, End
  - User
  - Regular hours, Overtime hours
  - Billable hours
  - Rate ($/h)
  - Regular $, OT $, T2 $, Total $
  - Status

---

## Configuration Options

### Daily Capacity Threshold
Set the number of hours that constitute a full workday. Hours worked beyond this threshold are counted as overtime.

### Overtime Basis (Daily, Weekly, Both)
Choose how overtime is computed:
- **Daily** - Overtime begins when daily capacity is exceeded.
- **Weekly** - Overtime begins when the weekly threshold is exceeded (Monday-based weeks).
- **Both** - Calculates daily and weekly overtime in parallel and reports the combined OT (maximum of the two). The summary strip adds OT Daily, OT Weekly, and OT Overlap metrics.

### Weekly Threshold (Weekly or Both)
Defines the number of hours in a week before overtime begins. Default is 40 hours.

### Overtime Multiplier (Tier 1)
Set the multiplier applied to overtime hours for cost calculations (e.g., 1.5x for time-and-a-half).

### Tier 2 Overtime
Configure a second overtime tier for extended overtime:
- **Threshold** - Hours after which Tier 2 applies
- **Multiplier** - Rate multiplier for Tier 2 hours

### Display Toggles

| Toggle | Description |
|--------|-------------|
| **Decimal time** | Show `8.50` instead of `8h 30m` |
| **Billable breakdown** | Show billable vs non-billable split |
| **Use profile capacity** | Pull daily capacity from user's Clockify profile |

If billability is disabled in the workspace, OTPLUS hides all money columns, the Amounts selector, and the billable breakdown, and shows time-only metrics.

### Report Time Zone
OTPLUS groups dates using the viewer’s Clockify profile time zone. There is no manual override.

---

## User Overrides

Override capacity settings for individual users when their schedule differs from the default.

### Override Modes

OTPLUS supports three override modes, each with different scope and behavior:

#### Global Mode
- **Scope**: Applies the same capacity to all dates
- **Use case**: Employees who work consistent hours every day (e.g., part-time employees with 4h/day)
- **Fields**: Daily capacity (hours), Overtime multiplier
- **Example**: Set 4h capacity for a part-time employee → any hours beyond 4h on any day are overtime

#### Weekly Mode
- **Scope**: Applies different capacity for each day of the week
- **Use case**: Employees with variable schedules (e.g., 10h Mon-Thu, 0h Fri)
- **Fields**: Capacity and multiplier per weekday (MONDAY, TUESDAY, etc.)
- **Example**: Set 10h for Mon-Thu, 0h for Fri → employee has a 4x10 schedule

#### Per-Day Mode
- **Scope**: Applies capacity to specific calendar dates only
- **Use case**: One-off schedule changes (e.g., half-day on a specific date, special event)
- **Fields**: Date picker, capacity, multiplier
- **Example**: Set 4h capacity for Dec 24 → employee has a half-day that specific date

### Mode Priority

When a user has overrides in multiple modes, OTPLUS applies them in this order:

1. **Per-Day** overrides take highest priority (specific dates)
2. **Weekly** overrides apply next (for days without per-day overrides)
3. **Global** overrides apply last (for any remaining days)
4. **Default** capacity (8h) applies if no overrides are set

### Tips

- Use **Global** mode for consistent part-time employees
- Use **Weekly** mode for compressed work weeks (4x10, 9/80 schedules)
- Use **Per-Day** mode for holidays, special events, or schedule exceptions
- Copy overrides between users who share the same schedule to save time

---

## Exporting Data

### CSV Export
Export your report data to CSV format for use in spreadsheets or payroll systems.

### Included Columns
The export includes all visible columns plus:
- `TotalHoursDecimal` - Total hours in decimal format for calculations
- `DailyOvertimeHours`, `WeeklyOvertimeHours`, `OverlapOvertimeHours`, `CombinedOvertimeHours` - Overtime breakdown fields for audits

### Formula Injection Protection
OTPLUS automatically sanitizes exported data to prevent spreadsheet formula injection attacks. Fields starting with `=`, `+`, `-`, or `@` are safely escaped.

---

## Settings Persistence

### How Settings Are Saved
- All configuration choices are saved in your browser's localStorage
- Each admin has their own independent settings
- Settings automatically survive page reloads and browser restarts
- When encrypted storage is enabled, override data is encrypted with AES-GCM before being saved

### Per-Workspace
Override configurations are saved per workspace, so switching workspaces loads the appropriate settings.

---

## Troubleshooting

### Report Taking Too Long
If a report is taking too long to generate:
1. Try a smaller date range (especially for workspaces with many users)
2. Check for rate limiting - a banner may appear if requests are being throttled
3. Large date ranges (365+ days) trigger a confirmation prompt; consider breaking into smaller periods

### Rate Limiting
Clockify enforces API rate limits. If you see a "Rate Limited" banner:
1. Wait a few seconds - OTPLUS automatically retries with backoff
2. For very large reports, expect some delay as requests are paced
3. Avoid running multiple reports simultaneously in different tabs

### Data Looks Wrong
If the numbers don't match expectations:
1. Check user overrides - custom capacity settings affect calculations
2. Verify the daily capacity threshold is set correctly
3. Confirm holidays and time-off are properly recorded in Clockify (half-day requests use their provided hours)
4. If dates look shifted, confirm your Clockify profile time zone is correct for your reporting policy
5. Remember: PTO entry types (HOLIDAY/TIME_OFF entries) are informational only - they don't affect capacity. Only API-provided holidays and time-off affect overtime calculations.

### Holidays/Time-Off Not Applied
If holidays or time-off aren't reducing capacity:
1. Verify the holiday is assigned to the user in Clockify's Holidays feature
2. Ensure time-off requests have "Approved" status
3. Check that the "Apply Holidays" and "Apply Time-Off" toggles are enabled in OTPLUS settings
4. Note: An entry with type "HOLIDAY" does NOT make the day a holiday - only the Clockify holiday calendar affects capacity

### Profile Capacity Not Working
If user capacity isn't coming from Clockify profiles:
1. Ensure "Use profile capacity" is enabled in settings
2. Verify the user has `workCapacityHours` set in their Clockify member profile
3. Check for user-specific overrides that may be taking precedence

### Dark Mode
OTPLUS automatically follows your Clockify profile preference. To change:
1. Go to your Clockify profile settings
2. Change the theme preference to DARK or LIGHT
3. Reload the addon

### Report Cancelled Unexpectedly
Starting a new report automatically cancels any in-progress report. This is normal behavior to prevent duplicate fetches and ensures you always see fresh data.

### API Errors
If you see an error dialog:
- **AUTH_ERROR**: Your session expired. Reload the addon from Clockify.
- **RATE_LIMIT**: Too many requests. Wait and try again with a smaller date range.
- **NOT_FOUND**: Workspace access issue. Verify your Clockify permissions.
- **NETWORK_ERROR**: Check your internet connection.
- **API_ERROR**: Clockify server issue. Try again later.
