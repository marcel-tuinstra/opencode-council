# Supervisor Epic Pilot

This repository still does not ship a full Supervisor runtime. This document packages the first real-epic Supervisor pilot for safe execution with multiple worktrees, one focused branch per work unit, and one reviewable retrospective tied to the existing contracts.

## Pilot target

- Selected epic: Shortcut epic `epic-323` (`OpenCode Orchestration Workflows`).
- Reason for selection: the epic already contains multiple focused workflow stories with bounded blast radius, mixed docs/helper work, and low-to-medium file overlap, which makes it a strong fit for dependency-aware lane planning.
- Safe-route baseline: `v1-safe` only; every implementation branch starts from fresh `main`, every PR targets `main`, branch chaining is not allowed, merge stays human-controlled, and no force-push flow is used.

## Pilot objective

- Validate that the Supervisor model can coordinate one real epic using explicit work units, worktree-backed lanes, structured handoffs, review packets, observability snapshots, merge policy, and budget governance.
- Keep implementation concurrency safe: multiple worktrees may exist in `planned`, `waiting`, or `review_ready`, but only one active code-change lane and one open PR are allowed at a time under `v1-safe`.
- Produce one artifact trail that can support go/no-go review without inventing a new runtime-only system.

## Pilot work units and lane plan

### Canonical work-unit set

| Work unit | Story / PR evidence | Primary contract area | Dependency notes | Suggested worktree |
| --- | --- | --- | --- | --- |
| Intake and lane planning foundation | `sc-340`, `sc-341`, PRs `#14`, `#13` | lifecycle, caps, lane planning | Unblocks the rest of the pilot planning language. | `../wt-epic-323-foundation` |
| Turn ownership and review packet flow | `sc-343`, `sc-346`, PRs `#15`, `#17` | handoffs, evidence packet | Depends on the baseline lane model; low code overlap with governance helpers. | `../wt-epic-323-handoff` |
| Governance and monitoring | `sc-347`, `sc-348`, `sc-344`, PRs `#18`, `#19`, `#20` | merge policy, budget governance, observability | Can be planned in parallel, but should enter active execution only after the current code lane clears review. | `../wt-epic-323-governance` |
| Operator packaging and review readiness | `sc-351`, `sc-355`, PRs `#21`, `#22` | runbook, KPI baseline | Depends on the prior contracts so the docs describe the merged operating model. | `../wt-epic-323-operations` |

### Lane-planning interpretation

- Parallelizable at planning time: handoff, governance, and operator-packaging work can all be prepared in separate worktrees because they touch mostly distinct docs or helper files.
- Serialized at execution time: `v1-safe` still limits the pilot to one active code-change lane and one open PR, so each prepared worktree waits for the previous lane to merge before it refreshes from `main` and opens review.
- Required lane states: use `planned -> active -> waiting -> review_ready -> complete`; parked worktrees should normally sit in `planned` or `waiting`, not `active`.

## Worktree execution flow

### 1. Lane intake and preparation

Before a lane starts:

1. Normalize the lane objective into the `WorkUnit` fields from `SUPERVISOR_WORK_UNITS.md`.
2. Record constraints: `safe-route-only`, `fresh-main-only`, `pr-base-main-only`, `no-branch-chaining`, `one-focused-branch`, `manual-merge`.
3. Name the worktree, target branch, expected reviewer, merge owner, and evidence links before code or docs change.
4. Create the worktree from updated `main`, not from another feature branch.

Recommended commands:

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git worktree add -b marceltuinstra/sc-340/lane-lifecycle--conservative ../wt-epic-323-foundation main
```

If a later lane was prepared early and `main` advanced before active execution, rebuild that lane from fresh `main` instead of rebasing a chained branch.

### 2. Active lane operation

- Keep exactly one active write owner per lane.
- Use the handoff contract from `EVIDENCE_PACKET_TEMPLATE.md` for every role transfer, including `DEV -> REVIEWER` and `DEV -> TESTER -> DEV` loops.
- Capture observability snapshots with the existing dashboard fields: lane state, heartbeat health, blockers, policy decisions, budget status, and ownership transitions.
- Keep budget review soft until `120%`; if the lane crosses that threshold, stop autonomous execution and follow the documented checkpoint escalation.

### 3. Review-ready and merge control

- Build the minimum evidence packet before moving the lane to `review_ready`.
- Open exactly one PR against `main` for the active lane.
- Keep merge human-controlled, even when the lane is docs-only.
- After merge, close the worktree or refresh it from `main` before any follow-up work.

## Execution record for epic 323

The pilot epic already produced one focused-PR sequence against `main` that exercises the merged contracts end to end.

| Sequence | Story | PR | Result |
| --- | --- | --- | --- |
| 1 | `sc-341` | `#13` | Added structural lane planning contract. |
| 2 | `sc-340` | `#14` | Added lane lifecycle and conservative cap policy. |
| 3 | `sc-343` | `#15` | Added explicit turn ownership and handoff contract. |
| 4 | `sc-345` | `#16` | Added immutable ad-hoc run history linkage. |
| 5 | `sc-346` | `#17` | Added review-ready evidence packet enforcement. |
| 6 | `sc-347` | `#18` | Added manual-first merge policy contract. |
| 7 | `sc-348` | `#19` | Added soft budget governance with `120%` escalation. |
| 8 | `sc-344` | `#20` | Added observability dashboard snapshot helper. |
| 9 | `sc-351` | `#21` | Added operator runbook and incident playbook. |
| 10 | `sc-355` | `#22` | Added KPI baseline for pilot review. |

### Observed pilot outcomes

- Every listed PR targeted `main`.
- The merged branches were focused to one story at a time.
- The epic produced reusable artifacts for work units, lane planning, lifecycle, turn ownership, evidence packets, observability, merge policy, runbook, and KPI baseline.
- No critical policy violation appears in the recorded branch or PR sequence: the merged history stayed linear through `main`, with human-reviewed PRs and no branch-to-branch chaining.

## Review packet requirements for this pilot

Each lane packet should include, at minimum:

- acceptance trace linked to the story or work-unit objective
- scoped diff summary with the exact contract or helper touched
- repeatable verification results
- risk and rollback notes
- current owner, next owner, reviewer owner, merge owner, and follow-up owner
- fresh-`main` proof: branch creation point or base commit used for the lane
- worktree path used for the lane so reviewers can correlate local execution artifacts

## Observability and budget review

- Snapshot cadence: capture one snapshot when a lane enters `active`, one before `review_ready`, and one on any blocker or escalation.
- Minimum fields to preserve in the pilot packet: lane state, heartbeat status, blocker owner, last ownership transition, budget status, thresholds triggered, and most recent policy decision.
- Budget interpretation for this pilot: warnings at `80%`, `100%`, and `120%` stay informative until the lane crosses `120%`; past that point, the lane pauses for explicit human review.

## Retrospective

### What worked

- The epic was decomposable into focused, contract-shaped work units that could be prepared independently before activation.
- The `v1-safe` policy kept the pilot auditable: fresh-`main` branches, `main`-only PR targets, and human-controlled merges eliminated ambiguous branch ancestry.
- The merged artifacts now cover the full Supervisor flow from intake through review and post-lane measurement.

### Friction observed

- Multiple worktrees were useful for preparation and context retention, but the `1` active code lane and `1` open PR cap turned execution into an intentionally serialized queue.
- Fresh-`main` only execution means a parked worktree can become stale quickly; operators need an explicit rule for when to rebuild instead of continuing on an old branch.
- The existing evidence packet template did not explicitly ask for worktree path or base commit, even though both matter during pilot reconstruction.

### Required policy or process changes before broader rollout

- Add a lightweight worktree registry step to the runbook so each prepared lane records worktree path, base commit, and intended refresh point.
- Extend pilot evidence packets to record fresh-`main` proof and worktree location as first-class fields.
- Keep the default `1` active code-change lane for now, but define a stricter entry test for any future experiment that would widen active implementation concurrency beyond `v1-safe`.
- Add an explicit stale-worktree rule: if `main` has advanced since lane preparation and the lane has not opened a PR yet, recreate the lane from fresh `main` rather than rebasing a long-lived parked branch.

## Alignment to existing contracts

- `SUPERVISOR_WORK_UNITS.md`: pilot lanes are selected and normalized as explicit work units with shared intake fields.
- `plugins/orchestration-workflows/lane-plan.ts`: the pilot treats structural complexity and dependencies as planning inputs, not expected duration.
- `plugins/orchestration-workflows/lane-lifecycle.ts`: lane state changes follow the conservative lifecycle only.
- `plugins/orchestration-workflows/turn-ownership.ts`: one active write owner is maintained for every lane turn.
- `EVIDENCE_PACKET_TEMPLATE.md`: every review-ready handoff uses the same packet contract.
- `plugins/orchestration-workflows/observability-dashboard.ts`: snapshots remain the source of truth for pilot monitoring and reconstruction.
- `plugins/orchestration-workflows/merge-policy.ts`: merge stays human-approved by default.
- `plugins/orchestration-workflows/budget-governance.ts`: warning and escalation thresholds stay aligned to the current soft-governance model.
- `SUPERVISOR_OPERATIONS_RUNBOOK.md`: pause, recovery, and incident response follow the documented operator flow.
- `SUPERVISOR_PILOT_KPI_BASELINE.md`: pilot success measurement uses the existing baseline and comparison method.

## Before / after behavior

Before:

- The repository had the individual Supervisor contracts, but no single real-epic pilot package showing how to run them together with multiple worktrees under safe-route constraints.
- Operators had to infer how fresh-`main` branch rules, evidence packets, observability, and pilot retro fit together for one real epic.

After:

- The repository now has one epic-level pilot document that selects a real epic, defines a safe worktree flow, records the observed execution sequence, and captures the retrospective with concrete next policy changes.
- Operators can package future pilot lanes with one reviewable source of truth instead of reconstructing the process from separate contract docs.

Example:

```text
Before: "We have the lane contracts, but we still need to decide how one real epic should move through multiple worktrees without drifting from main."
After: "Epic 323 uses prepared worktrees for foundation, handoff, governance, and operator packaging, but every active lane still starts from fresh main, opens one focused PR to main, and records worktree plus base-commit evidence for review."
```

If a future update only revises this pilot packaging or refreshes the retrospective without changing execution behavior, PR notes should say there is no additional user-facing prompting or workflow change.
