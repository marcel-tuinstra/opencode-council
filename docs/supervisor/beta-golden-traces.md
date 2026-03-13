# Supervisor Beta Golden Traces

This document is the reviewable release-readiness reference for Shortcut story `sc-439` (`Supervisor Scenario Evals + Golden Traces`). It keeps Beta validation at the test layer on top of the existing supervisor execution workflow rather than introducing a new runtime entry point.

## Validation target

- Story: `sc-439`
- Harness: `tests/supervisor-golden-traces.test.ts`
- Fixtures: `tests/fixtures/supervisor-golden-traces-fixture.ts`
- Reviewer command: `npm test -- tests/supervisor-golden-traces.test.ts`

## Scenario matrix

| Scenario | Plan shape | Governance outcome | Final status |
| --- | --- | --- | --- |
| Single-lane happy path | `lane-1` only | `accept` | run `review_ready`, `lane-1:review_ready` |
| Multi-lane dependency path | `lane-2` depends on `lane-1` | `accept` | run `review_ready`, `lane-1:complete`, `lane-2:review_ready` |
| Failed handoff | `lane-1` only | `repair` | run `paused`, `lane-1:active` |
| Protected-path governance block | `lane-1` only | `block` after protected-path `deny` | run `active`, `lane-1:active` |
| Recovery / resume | `lane-1` only | `accept` after explicit approval resume | run `active`, `lane-1:active` |

## What reviewers should inspect

- The fixture file names the five required reliability scenarios and their expected golden traces.
- Each scenario asserts plan shape, governance routing, and final run or lane state from the shipped execution workflow helpers.
- The release-readiness proof test compacts the scenario outcomes into one matrix so Beta reviewers can confirm all five traces stayed stable.

## Why this is enough for Beta readiness

- It proves the must-pass scenarios on the current workflow surface without widening runtime scope.
- It keeps trace assertions deterministic by pinning timestamps and avoiding temp-path assertions.
- It fails loudly if lane planning, governance routing, recovery, or review-ready behavior regresses.
