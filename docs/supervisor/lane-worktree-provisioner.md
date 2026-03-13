# Lane Worktree Provisioner

This repository still does not ship a full Supervisor runtime. The lane worktree provisioner adds a practical Alpha helper for creating, reusing, reconciling, and releasing one managed git worktree per lane while keeping durable state as the control-plane source of truth.

## Managed location model

By default, managed lane worktrees live under `.opencode/supervisor/worktrees/<run-id>/<lane-id>`.

```text
.opencode/
  supervisor/
    worktrees/
      <run-id>/
        <lane-id>/
```

- Path segments are sanitized before use so lane ids cannot escape the managed root.
- Worktree ids are deterministic as `<run-id>:<lane-id>` so durable state and filesystem layout stay correlated.
- Alpha expects exactly one managed worktree per lane at a time.

## What the helper does

- Provision a new managed worktree when a lane does not already have a healthy assignment.
- Reuse the existing worktree when durable state, git worktree state, branch, and filesystem path still agree.
- Reconcile durable lane/worktree records against the actual git worktree list and the managed worktree root.
- Detect three classes of problems before more execution continues:
  - drift: lane, durable worktree, git, or filesystem state disagree
  - collisions: multiple durable records claim the same branch or path
  - orphans: managed worktree paths exist without a durable lane/worktree mapping
- Release a managed worktree explicitly and mark its durable record as `released`.

## Recovery assumptions

- Durable run state from `docs/supervisor/durable-state-store.md` remains the execution source of truth.
- Reconciliation should run before reusing a parked lane or after any interruption that may have changed local git/worktree state.
- A drifted lane worktree is not auto-healed in Alpha; operators should rebuild or release it explicitly so recovery stays auditable.
- Orphaned worktrees are detected for cleanup planning, but automatic deletion outside an explicit release path is intentionally out of scope for Alpha.

## Before / after behavior

Before:

- Durable state could remember lane-to-worktree intent, but there was no file/system-safe helper to provision or reconcile actual git worktree state.
- Operators had to inspect `git worktree list`, local directories, and state records manually to decide whether a lane was safe to reuse.

After:

- Alpha has a focused provisioner that creates or reuses one managed worktree per lane and persists the durable lane/worktree mapping.
- The reconciler reports drift, collisions, and orphans in one place so operators can recover or clean up deliberately.

Example:

```text
Before: "Lane beta says it owns a worktree, but I need to compare state.json, git worktree output, and disk by hand to know whether it is safe to reuse."
After: "Reconcile the lane worktree set first; if the lane is healthy, reuse it, and if drift or collisions appear, block provisioning until the lane is rebuilt or released."
```

If a later change only refactors the provisioner internals without changing the managed path model or reconciliation rules, PR notes should say there is no operator-facing workflow change.
