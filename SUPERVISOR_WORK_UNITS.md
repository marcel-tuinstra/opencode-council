# Supervisor Work Units

This repository still does not ship a full Supervisor runtime. This document is the reviewable v1 contract for intake normalization so future Supervisor execution can accept both tracker-backed and non-ticketed work without splitting the planning model.

## Canonical shape

Every intake should normalize into a `WorkUnit` with the same minimum planning fields:

- `objective`: the primary outcome the Supervisor is trying to achieve
- `constraints`: guardrails, policy limits, or execution boundaries
- `acceptanceCriteria`: the minimum checks that define done
- `dependencies`: upstream work, documents, people, or systems that can block execution
- `riskTags`: lightweight routing or caution labels like `workflow`, `reliability`, or `security`
- `evidenceLinks`: links the Supervisor or reviewer can use to verify context or outputs
- `source`: preserved origin metadata for tracker-backed and ad-hoc work alike

The typed contract lives in `plugins/orchestration-workflows/work-unit.ts`.

## Lane planning contract

Lane planning should consume normalized `WorkUnit` records rather than tracker-native payloads.
The planning helper remains tracker-agnostic by pairing each normalized work unit with a local planning id, dependency ids, and structural signals:

- `fileOverlap`: how much source-area contention is expected across units
- `coupling`: how many neighboring systems or modules are likely to move together
- `blastRadius`: whether the change stays contained, touches adjacent surfaces, or spans broadly
- `unknownCount`: unresolved questions that raise coordination or review cost
- `testIsolation`: whether validation is isolated, partial, shared, or absent

The lane planner must use those structural signals plus explicit dependency edges to produce:

- a dependency graph that shows blocked versus parallelizable units
- lane recommendations derived from dependency order and structural complexity
- a clear statement that expected duration is not a gating input

The typed lane planning contract lives in `plugins/orchestration-workflows/lane-plan.ts`.

## Lane lifecycle contract

Lane execution should use one conservative lifecycle so planning, review, and cap enforcement stay auditable across repositories.

- `planned`: the lane is defined but work has not started yet
- `active`: the lane is currently consuming implementation capacity and counts toward the active lane cap
- `waiting`: the lane is blocked on an external dependency, human decision, or upstream change and does not count toward the active lane cap
- `review_ready`: the lane has produced a reviewable handoff, such as a PR, and no longer counts toward the active lane cap unless it re-enters active work
- `complete`: the lane is finished and terminal

Allowed v1 transitions are intentionally narrow:

- `planned -> active`
- `active -> waiting | review_ready`
- `waiting -> active | review_ready`
- `review_ready -> active | complete`

The typed lane lifecycle and cap contract lives in `plugins/orchestration-workflows/lane-lifecycle.ts`.

## Supported intake modes

### Tracker-backed

External tracker items normalize into the same shape. The source block should preserve any available metadata that helps trace the original planning record, such as:

- tracker kind (for example Shortcut, Jira, GitHub, Linear, or custom)
- tracker entity type
- tracker id or key
- app URL
- workflow state id
- owner ids
- label names
- parent epic or objective ids

Tracker-specific metadata is useful when present, but the canonical planning fields should stay usable even if only a subset of metadata is available.

### Ad-hoc

Prompt-defined work, document-defined tasks, and manually entered requests also normalize into `WorkUnit` records.

Ad-hoc work must not require a ticket id. Instead, its source block can carry lightweight provenance such as:

- prompt/session reference
- document path or URL
- human-provided title
- captured-by or requested-by metadata

## Normalization rules

- The canonical planning fields are identical for tracker-backed and ad-hoc intake.
- Missing ticket metadata must not block normalization if the work already has the required planning fields.
- When a tracker-backed intake does not provide an explicit objective, normalization may fall back to the source title.
- Source metadata should be preserved as raw key-value data rather than forcing any single ticket-system dependency into the core `WorkUnit` shape.
- Lane planning must work from normalized `WorkUnit` records and explicit dependency ids, not tracker-specific fields.
- Expected duration can be preserved elsewhere for reporting, but it must not change lane gating or dependency decisions.

## Current implementation boundary

This repository currently ships typed Supervisor intake, lane-planning, and lane-lifecycle contracts plus minimal helpers (`normalizeWorkUnit`, `planWorkUnitLanes`, and lane lifecycle/cap policy helpers) so future wiring can reuse one canonical model. It does not introduce a full Supervisor runtime or automatic intake ingestion yet.
