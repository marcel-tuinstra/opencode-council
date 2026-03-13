# Supervisor Alpha End-to-End Validation

This document captures the practical Alpha validation run for Shortcut story `sc-402` against real delivery epic `epic-323` (`OpenCode Orchestration Workflows`). It stays intentionally reviewable: the run is proven through the shipped helper contracts, one test harness, one pilot fixture, and one review packet trail rather than speculative runtime wiring.

## Validation target

- Epic: `epic-323` (`OpenCode Orchestration Workflows`)
- Story: `sc-402` (`Supervisor Alpha End-to-End Validation`)
- Base branch policy: `epic/supervisor-alpha`
- Validation harness: `tests/supervisor-alpha-end-to-end-validation.test.ts`
- Pilot fixture: `tests/fixtures/supervisor-alpha-end-to-end-fixture.ts`

## What the run proves

- Lane planning uses a real epic-shaped objective and resolves three lanes: delivery foundation, review prep, and KPI/retro capture.
- Worktree provisioning creates one durable worktree per lane while keeping each branch isolated.
- Session lifecycle exercises multiple lane sessions plus an explicit recovery replacement after a stale heartbeat.
- Approval flow pauses at a merge gate, records the checkpoint, and resumes only after an explicit approval signal.
- Review preparation renders one PR-ready evidence bundle tied back to the originating run and Shortcut story.

## Validation flow

1. Create one durable run for `epic-323` and seed lane state for the delivery, review, and retro lanes.
2. Provision three managed worktrees from `epic/supervisor-alpha`.
3. Launch active delivery and review sessions.
4. Force a stale-heartbeat condition on the review lane.
5. Classify recovery as `stuck-heartbeat`, then replace the failed review session with a fresh session on the same worktree.
6. Raise and approve one explicit merge approval gate.
7. Persist branch, pull-request, review-packet, and validation artifacts.
8. Render the PR body with `Summary`, `Before`, `After`, `Example`, and `Validation` sections.

## KPI results

The harness derives the final counts from durable state after the review bundle is prepared:

| KPI | Result |
| --- | --- |
| Lanes tracked | `3` |
| Active worktrees | `3` |
| Sessions recorded | `3` |
| Approval checkpoints | `1` |
| Recovery replacements | `1` |
| Review artifacts linked | `4` |

## Explicit checkpoints exercised

### Approval gate

- Boundary: `merge`
- Requested action: merge the Alpha validation PR into `epic/supervisor-alpha`
- Outcome: the lane pauses in `pending`, then resumes only after explicit approval from `marceltuinstra`

### Recovery path

- Failure class: `stuck-heartbeat`
- Disposition: `supervised-retry`
- Trigger: the review lane heartbeat ages past the `300000ms` timeout
- Recovery action: replace the review session while keeping the same durable worktree binding

## Retrospective gaps

- The pilot is still proven through a validation harness rather than a shipped supervisor runtime command.
- Session recovery is covered, but destructive worktree rebuilds still remain operator-led repair actions.
- KPI reporting is reconstructable from durable state, but the repository does not yet emit a standalone runtime artifact for it.

## Before / after user-visible impact

Before:

- No user-facing prompting, messaging, or behavior change.
- Alpha components existed separately, but there was no single end-to-end validation artifact proving they could run together across lanes, approval, review prep, and recovery.

After:

- No user-facing prompting, messaging, or behavior change.
- Alpha now has one concrete validation harness, pilot fixture, and documentation packet that prove the shipped components can complete one real epic-shaped run.
