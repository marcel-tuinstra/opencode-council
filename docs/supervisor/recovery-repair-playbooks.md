# Recovery And Repair Playbooks

The Alpha supervisor foundation now includes typed recovery and repair playbooks in `plugins/orchestration-workflows/recovery-repair-playbooks.ts`.

## What the helper classifies

The playbook classifier consumes durable lane state plus the current recovery signals and returns a focused Alpha-safe disposition:

- `stuck-heartbeat`: the current session heartbeat aged past the recovery timeout
- `failed-session`: the current durable session is explicitly marked failed
- `worktree-drift`: durable worktree state no longer matches git or filesystem reality
- `merge-conflict`: git conflict repair is required before review can continue
- `tool-outage`: a required runtime, git, MCP, or network path is unavailable
- `partial-completion`: the lane looks partly done, but review artifacts or approvals are still missing

## Recovery dispositions

- `supervised-retry`: retry inside the same lane boundary with a fresh session or tool retry
- `repair`: stop forward progress, repair the lane state, and rebuild review evidence before resuming
- `quarantine`: isolate the lane worktree first because the current state is not safe to reuse
- `escalate`: stop and request a human decision because Alpha cannot recover safely on its own

## Common failure classes and next actions

### Stuck heartbeat

- Durable signal: current session is `active`, but the last heartbeat is stale.
- Supervisor action: pause the lane and replace the runtime session on the same durable worktree.
- Why: Alpha keeps the retry lane-local and auditable instead of guessing whether the old session is still safe.

### Failed session

- Durable signal: current session status is `failed`.
- Supervisor action: pause, preserve the failure reason, and replace the session against the same worktree.
- Why: recovery stays inside the durable lane/worktree binding without silently widening scope.

### Worktree drift or collision

- Durable signal: reconciliation reports drift, collisions, or orphaned managed paths.
- Supervisor action: pause immediately; drift goes to supervised repair, while collisions or orphans go to quarantine.
- Approval model: destructive approval is required before releasing or rebuilding a drifted or quarantined worktree.
- Why: Alpha treats worktree repair as a controlled boundary because cleanup can discard local state.

### Merge conflict

- Durable signal: merge or rebase conflict is reported for the lane branch.
- Supervisor action: pause, repair the branch in a supervised lane session, rebuild review artifacts, and reopen review prep.
- Approval model: merge remains behind the existing merge approval gate; conflict repair itself does not widen merge authority.

### Tool outage

- Durable signal: runtime, git, MCP, or network path is unavailable.
- Supervisor action: retry when the outage is transient; escalate when it is not safely retryable.
- Why: Alpha only retries known transient failures and does not invent alternate tool paths.

### Partial completion

- Durable signal: a `review_ready` lane is missing ready `branch`, `pull-request`, or `review-packet` artifacts, or an approval remains pending.
- Supervisor action: rebuild missing evidence when the lane is incomplete; escalate when human approval is still pending.
- Why: the supervisor should not infer completion from partial artifacts or silently bypass approval.

## Durable-state alignment

- Classification starts from the persisted lane, worktree, session, approval, and artifact records.
- Review-ready completeness is inferred from durable artifact state instead of transient process memory.
- Worktree drift uses the reconciler output so repair decisions stay consistent with the provisioner contract.

## Before / after behavior

Before:

- The repository had separate durable state, session lifecycle, worktree reconciliation, scheduler, and approval helpers, but no single Alpha-safe recovery classifier tying them together.
- Operators had to infer whether a failure should retry, repair, quarantine, or escalate by reading several modules and docs.

After:

- Alpha has typed recovery playbooks that classify common supervisor failure modes into retry, repair, quarantine, or escalation paths.
- Recovery decisions stay aligned with durable state, worktree reconciliation, session lifecycle, and approval boundaries.

Example:

```text
Before: "The lane is review ready, but the PR is missing and the worktree looks odd; I need to inspect several helpers to decide what happens next."
After: "Classify the lane from durable state. If review artifacts are missing, rebuild them; if the worktree drifted, pause and request destructive approval before repair; if a session stalled, replace it on the same worktree."
```

There is no direct end-user prompting or messaging change in this Alpha helper. PR notes should say that explicitly.
