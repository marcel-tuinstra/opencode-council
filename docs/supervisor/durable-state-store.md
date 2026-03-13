# Durable State Store

The Alpha supervisor foundation now includes a durable control-plane state store in `plugins/orchestration-workflows/durable-state-store.ts`.

## What it persists

Each persisted run snapshot keeps the minimum restart-safe execution model needed for pause, resume, recovery, and auditability:

- run metadata and control-plane status
- lane state and branch linkage
- worktree assignment and filesystem path
- session ownership and latest heartbeat timestamp
- approval gate status
- artifact status and location
- applied mutation ids for idempotent retries
- append-only audit history for each committed mutation

This state is the execution source of truth for the supervisor control plane. It is not a replacement for Shortcut, GitHub, or other ticketing systems; those systems still own planning, review, and collaboration workflows.

## Default on-disk layout

By default, file-backed state lives under `.opencode/supervisor/state`.

```text
.opencode/
  supervisor/
    state/
      runs/
        <run-id>/
          state.json
          events/
            0001-<mutation-id>.json
            0002-<mutation-id>.json
```

- `state.json` is the latest fully materialized snapshot for fast recovery.
- `events/*.json` stores the committed audit trail in sequence order.
- Writes use a temp file plus rename so Alpha recovery can rely on restart-safe snapshot replacement.

## Usage model

- Create a file-backed store with `createFileBackedSupervisorStateStore()`.
- Start a run with `commitMutation(runId, { createRun, ... })`.
- Persist control-plane changes through focused mutations that upsert lanes, worktrees, sessions, approvals, and artifacts.
- Reuse the same `mutationId` when retrying an external side effect so the store remains idempotent.
- Reload with `getRunState(runId)` after a crash or restart.

## Before / after behavior

Before:

- The repository had typed supervisor lifecycle and observability helpers, but no durable execution state store for pause, resume, or crash recovery.
- Operators had to infer restart state from scattered artifacts instead of one persisted control-plane snapshot.

After:

- Alpha has a typed file-backed state store that persists run, lane, worktree, session, approval, and artifact state.
- Restart and retry flows can reload the latest control-plane snapshot and skip duplicate mutations by `mutationId`.

Example:

```text
Before: a restarted supervisor session had to reconstruct lane state from PRs, notes, and in-memory context.
After: the supervisor reloads state.json, sees the lane/worktree/session bindings, and ignores a retried mutation if its mutation id was already committed.
```

If a later change only refactors the persistence internals without changing the stored model or on-disk location, PR notes should say there is no operator-facing workflow change.
