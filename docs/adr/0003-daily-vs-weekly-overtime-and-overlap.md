# 0003. Daily vs Weekly overtime and overlap handling

Date: 2026-01-18

## Status
Accepted

## Context
Some organizations use daily overtime rules, others weekly, and some need both reported.
If both are shown, totals can be misread or double-counted unless overlap is defined.

## Decision
We support 3 modes:
- daily
- weekly
- both

Definitions:
- Daily OT: compute OT per day using daily effective capacity.
- Weekly OT: compute OT per week using weekly capacity threshold.

Attribution:
- Daily OT uses “tail attribution” within each day (sort by start time; overtime assigned to the tail; entries are split if needed).
- Weekly OT uses “tail attribution” across the week (sort segments by time; overtime assigned to tail of the week).

When mode = both:
- We report 4 metrics:
  1) dailyOvertimeHours
  2) weeklyOvertimeHours
  3) overlapOvertimeHours = duration( intersection(dailyOTIntervals, weeklyOTIntervals) )
  4) combinedOvertimeHours = duration( union(dailyOTIntervals, weeklyOTIntervals) )

Notes:
- combinedOvertimeHours is the recommended “total OT” display to avoid double counting.
- Exports include all four fields for transparency.

## Consequences
- Both legal interpretations can be represented without confusion.
- Implementation requires interval math (merge/union/intersection), but remains deterministic and auditable.
