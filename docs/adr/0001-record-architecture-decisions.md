# 0001. Record architecture decisions

Date: 2026-01-18

## Status
Accepted

## Context
OTPLUS has rules that must remain stable across refactors:
- overtime computation and attribution rules
- timezone/date bucketing rules
- security constraints (read-only, export safety)
- performance constraints (large workspaces)

New contributors need the “why” behind choices to avoid regressions.

## Decision
We will record architecturally significant decisions as ADRs in docs/adr.
We will use the Michael Nygard ADR template.
ADRs are numbered sequentially and kept in version control.
When decisions change, we will add a new ADR and mark previous ones as superseded.

## Consequences
- Future changes are easier to reason about and review.
- Some overhead is added for significant changes.
- The ADR trail becomes part of the project’s quality and auditability.
