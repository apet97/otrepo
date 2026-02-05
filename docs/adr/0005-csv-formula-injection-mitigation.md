# 0005. CSV export: formula injection mitigation

Date: 2026-01-18

## Status
Accepted

## Context
CSV exports are opened in spreadsheets that may interpret cell values as formulas.
User-controlled fields (client/project/task/description) can trigger CSV injection.

## Decision
Before writing CSV cells:
- If the (trimmed) value begins with any of:
  =, +, -, @, tab (\t), carriage return (\r)
  then prefix the value with a single quote (').

Rule applies even if the value begins with quotes, e.g. `"=SUM(1,1)"`.

## Consequences
- Prevents common spreadsheet formula execution vectors.
- Users can still intentionally remove the prefix after export; that is acceptable.
- Export tests must cover the edge cases above.
