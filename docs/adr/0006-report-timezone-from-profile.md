# 0006. Report timezone from viewer profile

Date: 2026-01-29

## Status
Accepted

## Context
OTPLUS previously allowed a manual report timezone override and prioritized it ahead of
workspace/browser timezones. This created inconsistent bucketing across users and required
extra configuration. The product requirement is now to always use the viewer’s Clockify
profile timezone for report grouping.

## Decision
- Remove the manual report timezone input and config.
- Resolve the canonical timezone from the viewer’s profile timezone claim (`timeZone`) when available.
- Fallback order: viewer profile timezone → workspace timezone claim → browser default.

## Consequences
- Date bucketing always matches the viewer’s Clockify profile.
- Fewer configuration options and less risk of misconfigured reports.
- Legacy `reportTimeZone` settings are ignored.
