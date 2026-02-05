# ADRs (Architecture Decision Records)

We record architecturally significant decisions as ADRs.

## Format
We use the Michael Nygard ADR format:
- Title
- Date
- Status
- Context
- Decision
- Consequences

## Location
All ADRs live in: docs/adr/

## Numbering
- Files are numbered sequentially: 0001, 0002, …
- Numbers are never reused.

## Editing rules
- Do not rewrite accepted ADRs to match today’s reality.
- If a decision changes: create a new ADR and mark the old one as “Superseded by ADR-XXXX”.

## When to write an ADR
Write one when changing:
- overtime rules (daily/weekly/holiday/time-off)
- timezone/date-bucketing behavior
- API strategy (rate limiting, retries, batching)
- caching/persistence approach
- export/security rules (CSV injection, XSS)
- testing strategy or quality gates
