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

## Ad-hoc run history registry contract

Ad-hoc work needs a lightweight audit record even when no tracker ticket exists yet. The smallest v1 registry contract should stay immutable and tracker-agnostic while preserving enough detail to link follow-up artifacts later.

- `runId`: stable record identifier for the originating execution
- `workUnitId`: normalized work-unit key used by planning and later references
- `objective`: copied from the normalized `WorkUnit` so reports stay aligned with intake
- `repo`, `branch`, `commitSet`, `operator`, `createdAt`: durable execution provenance for the originating run
- `evidenceLinks`: copied from the originating `WorkUnit` for immediate audit context
- `relatedArtifacts`: later PRs, merge packets, postmortems, or other review artifacts that should point back to the same run

The typed helper lives in `plugins/orchestration-workflows/ad-hoc-run-history.ts`.

### Before / after behavior

Before:

- Ad-hoc work could normalize into a `WorkUnit`, but there was no typed immutable registry record for the actual run.
- Follow-up PRs or postmortems had no canonical place to point back to the originating non-ticketed execution.

After:

- An ad-hoc run can be captured as an immutable typed record keyed by work-unit id, repo, branch, commit set, operator, objective, and evidence links.
- Later artifacts can link back to that originating run by creating a new record snapshot instead of mutating history in place.

Prompting and messaging example:

```text
Before: "We handled this from Slack and can look up the branch later if needed."
After: "Ad-hoc run adhoc:wu-17:2026-03-12T17:00:00Z recorded for work unit wu-17 with repo, branch, commit set, operator, evidence, and follow-up PR links."
```

If a future change only extends the typed registry contract without introducing runtime prompting or behavior, PR notes should state that clearly.

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

### Goal-plan to lane-plan bridge

Beta intake now has a thin bridge between delegated goal planning and dependency-safe lane planning.

- `planSupervisorGoal` classifies whether a delegated goal is safe to plan, then returns intent, confidence, budget class, advisory lane count, role recommendations, and approval boundaries.
- `decomposeSupervisorGoalIntoLanes` takes that supported goal-plan result plus explicit normalized planning work units and produces:
  - the dependency-safe `LanePlan`
  - a scheduler-facing lane-definition preview
  - warnings when advisory lane count diverges from dependency-safe decomposition
- This bridge is intentionally conservative: it does not infer work units from freeform text yet, and it fails closed when goal planning is unsupported or no explicit work units are provided.

The typed bridge helper lives in `plugins/orchestration-workflows/lane-decomposition.ts`.

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

## Scheduler and dispatch loop contract

Lane planning, worktree provisioning, and runtime session lifecycle now connect through one scheduler/dispatch abstraction.

- lane definitions are materialized from a dependency-aware `LanePlan`
- dependency-complete lanes can activate only when the active lane cap allows them to start
- active lanes receive deterministic worktree and session assignments
- blocked, waiting, review-ready, and complete outcomes are derived from durable state plus explicit lane intent
- post-merge completion can release managed worktrees without operator babysitting between approval boundaries

The typed scheduler and dispatch loop live in `plugins/orchestration-workflows/supervisor-scheduler.ts`.

## Turn ownership and handoff contract

Multi-role collaboration can stay in one lane as long as turn ownership remains explicit and auditable.

- A lane has exactly one active role with write authority at a time.
- The active role may hand off to another role or re-enter the same role later, but every turn change must record a handoff contract.
- Each handoff contract must capture a delta summary, current risks, and the next required evidence so the receiving role can continue without widening lane concurrency.
- Re-entry loops such as `DEV -> TESTER -> DEV` stay in the same lane and remain valid as long as each hop records its own handoff packet.

The typed turn ownership helper and handoff contract live in `plugins/orchestration-workflows/turn-ownership.ts`.

### Before / after behavior

Before:

- Roles could coordinate in one lane only by convention.
- A handoff could be implied by a short message such as "tester can pick this up now".
- Reviewers or the next role often had to infer what changed, what was risky, and what evidence still mattered.

After:

- A lane keeps exactly one active role with write authority at a time.
- A turn transfer must include a structured handoff contract with delta summary, risks, next required evidence, and attached evidence.
- Re-entry loops such as `DEV -> TESTER -> DEV` stay valid, but each hop must leave a traceable contract.

Prompting and messaging example:

```text
Before: "Implementation is done; QA can test now."
After: "Current owner DEV -> next owner TESTER, scope test, trigger implementation complete, risks listed, next required evidence listed."
```

If a future change only refactors this helper without changing prompting, handoff messaging, or visible behavior, PR notes should state that clearly instead of implying a user-facing change.

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
