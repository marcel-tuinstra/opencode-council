# Session Runtime Adapter

The Alpha supervisor foundation now includes a typed session runtime adapter and lifecycle helper in `plugins/orchestration-workflows/session-runtime-adapter.ts`.

## What it tracks

Each lane/worktree session record now has enough typed metadata to support restart-safe runtime tracking without building the full scheduler:

- runtime kind for the attached session
- current owner for the session turn
- attached and latest heartbeat timestamps
- session status, including `stalled` and `replaced`
- failure reason when a session fails or stalls
- replacement linkage between retired and current sessions

Alpha still expects one current session per lane/worktree. Replacement keeps prior session records for auditability instead of mutating history away.

## Lifecycle model

- `launchSession(...)` starts the first runtime session for a lane that already has a managed worktree.
- `resumeSession(...)` re-attaches to the current durable session when a stalled, paused, or handed-off lane needs to continue.
- `recordHeartbeat(...)` updates durable heartbeat, owner, status, and failure details.
- `detectStalledSession(...)` marks the current session as `stalled` when the heartbeat ages past the configured timeout.
- `replaceSession(...)` retires the current durable session as `replaced`, launches a new session for the same worktree, and moves the lane pointer to the replacement.

## Recovery assumptions

- Durable run state from `docs/supervisor/durable-state-store.md` remains the control-plane source of truth.
- Lane/worktree provisioning from `docs/supervisor/lane-worktree-provisioner.md` must happen before a runtime session is launched.
- Alpha does not auto-schedule replacement sessions; it only provides the typed lifecycle and audit trail needed for higher-level orchestration later.
- Session replacement is lane-local and worktree-local; a replacement does not move work across worktrees.

## Before / after behavior

Before:

- Durable state could store a bare session id and heartbeat timestamp, but it had no typed runtime adapter for launch, attach, stall detection, or replacement.
- Operators had to infer whether a lane should resume its current session or launch a replacement from ad-hoc state.

After:

- Alpha has a typed runtime adapter contract plus a focused lifecycle helper for launch, attach, heartbeat updates, stall detection, and replacement.
- Durable session records now capture owner, failure reason, and replacement lineage so the control plane can recover one session per worktree safely.

Example:

```text
Before: "Lane beta has a worktree and a stale session id, but I still need to decide manually whether to reattach or replace it."
After: "Check the heartbeat age; if it is still recoverable, resume the current lane session, and if it is stalled or failed, replace it while keeping the old session linked in durable state."
```

If a later change only refactors adapter internals without changing the lane-to-worktree session model or the replacement/stall rules, PR notes should say there is no operator-facing workflow change.
