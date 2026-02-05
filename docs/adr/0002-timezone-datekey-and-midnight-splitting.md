# 0002. Timezone, dateKey, and midnight-spanning entry handling

Date: 2026-01-18

## Status
Superseded by ADR-0006 (timezone precedence update).
Note: manual report timezone selection has been removed; use ADR-0006 for current precedence.

## Context
Overtime is computed by day and sometimes by week. If we bucket time incorrectly (timezone drift, DST, midnight crossing),
we miscompute capacity and overtime. Current behavior must be deterministic.

## Decision
1) Canonical reporting timezone (in priority order):
   a) User-selected timezone in OTPLUS settings
   b) Workspace timezone (if available from Clockify / configuration)
   c) Browser/system timezone

2) dateKey calculation:
   - dateKey must be derived from (instant + canonicalTimezone) and must be DST-safe.
   - Implementation may use Temporal if available; otherwise use Intl.DateTimeFormat with an explicit `timeZone`.

3) Midnight-spanning entries:
   - Entries are attributed entirely to the day they *started* (no splitting across dates).
   - A shift from 10 PM to 2 AM counts as 4 hours on Day 1.
   - This simplifies implementation and matches Clockify's native reporting behavior.

## Consequences
- Reports become stable across DST transitions.
- Midnight-spanning entries may attribute all hours (including OT) to the start day.
- Users should be aware that late-night work crossing midnight will show on the day it began.
