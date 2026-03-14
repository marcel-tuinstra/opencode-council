# Supervisor Scheduler And Dispatch Loop

This repository now ships a typed scheduler/dispatch abstraction that turns a dependency-aware lane plan into deterministic lane records, worktree assignments, runtime session assignments, and state transitions.

The implementation lives in `plugins/orchestration-workflows/supervisor-scheduler.ts`.

## What it decides

For each lane, the dispatcher evaluates the same inputs in the same order:

1. completion signal
2. validated review-ready packet + lane output contract
3. unfinished dependency lanes
4. explicit waiting blockers
5. active-lane cap availability
6. worktree provisioning need
7. runtime session launch, resume, or replacement need

That ordering keeps dispatch restart-safe and explainable. A later run sees the same durable lane, worktree, and session state and arrives at the same next action.

## State progression

The loop stays inside the currently approved lifecycle boundaries:

- `planned`: lane exists but cannot start yet because dependencies are incomplete or the active lane cap is saturated
- `active`: lane is eligible to run and should have a managed worktree plus an attached runtime session
- `waiting`: lane was active, but an external blocker now pauses forward motion
- `review_ready`: lane produced a validated review-ready packet plus lane output contract and waits at the approval boundary
- `complete`: lane finished after merge and its managed worktree can be released

The scheduler does not add merge automation yet. It now treats `review_ready` as a typed boundary: a lane must present a valid review-ready packet and lane output contract before the loop will promote it.

## Dispatch actions

The current loop can emit one next action per lane per pass:

- `provision-worktree`
- `launch-session`
- `resume-session`
- `replace-session`
- `release-worktree`
- `none`

`none` is still meaningful when the lane is blocked, waiting, already running, or intentionally parked at `review_ready`.

## Before / after behavior

Before:

- Lane planning, worktree management, and runtime session lifecycle existed as separate helpers.
- An operator could inspect each piece, but there was no single deterministic loop that decided the next lane action and lane state from durable state plus lane intent.

After:

- A lane plan can be materialized into durable lanes with explicit dependency edges.
- The dispatcher can advance a ready lane by activating it, provisioning a worktree, assigning a runtime owner deterministically, and launching or resuming the next runtime session.
- Waiting, blocked, review-ready, and complete outcomes are decided in one explainable pass.
- A lane cannot silently become `review_ready`; the dispatcher validates the review-ready packet and persists the lane handoff artifacts that justify the transition.

## Example

```text
Pass 1: lane-1 becomes active and provisions a managed worktree; lane-2 stays blocked on lane-1.
Pass 2: lane-1 launches its first runtime session with the assigned owner.
Pass 3: lane-1 reports an external blocker and moves to waiting.
Pass 4: lane-1 becomes review_ready after producing a reviewable handoff.
Pass 5: lane-1 becomes complete after merge and releases its managed worktree.
```

## Current boundary

This loop is intentionally practical, not final. It coordinates the shipped alpha helpers and leaves obvious hooks for future approval-gate work in sc-403 rather than inventing a broader policy engine early.
