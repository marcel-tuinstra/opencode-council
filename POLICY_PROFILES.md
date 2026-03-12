# Supervisor Policy Profiles

This repository does not yet ship a full Supervisor runtime. Until that lands, this document is the reviewable v1 contract for policy defaults and override points.

## Canonical default profile

The initial default profile is `v1-safe`.

It is the baseline that implementation teams should assume unless a repository opts into something stricter.

| Area | `v1-safe` default | Why it is the default |
| --- | --- | --- |
| Lane caps | `max_active_workstreams: 1`, `max_concurrent_code_changes: 1`, `max_open_pull_requests: 1` | Keeps execution serial, reviewable, and easy to unwind. |
| Merge mode | `manual` | Requires a human to merge; no auto-merge by default. |
| Budget thresholds | `soft_run_tokens: 6400`, `hard_run_tokens: 8400`, `soft_step_tokens: 2800`, `hard_step_tokens: 4000`, `truncate_at_tokens: 1400` | Reuses the current budget governor defaults already implemented in `plugins/orchestration-workflows/budget.ts`. |
| Escalation mode | `ask-first` | Pushes risky or ambiguous actions back to a human before the workflow continues. |

## Escalation behavior

`v1-safe` escalates instead of proceeding when any of the following is true:

- scope is ambiguous and the next action could materially change the outcome
- a change is destructive, irreversible, or affects production state
- a secret, credential, or account-specific value is required
- a hard budget threshold is exceeded
- a merge would be required to finish the task
- a request asks to broaden automation beyond the default policy

Escalation means the Supervisor should stop autonomous execution, summarize the blocking condition, and ask for the smallest clarifying human decision.

## Safe default vs opt-in stricter automation

Use `v1-safe` unless a repository explicitly opts into tighter automation policy.

| Area | `v1-safe` | Opt-in stricter automation |
| --- | --- | --- |
| Lane caps | One active workstream and one code-change lane | Same or lower caps; never higher than default without an explicit human override |
| Merge mode | Manual merge only | `queue` is allowed only when the repo explicitly enables it and CI is required |
| Budget thresholds | Current repository defaults | Lower soft and hard thresholds to force earlier compaction or escalation |
| Escalation | Ask on risky actions | Ask earlier and on more categories, such as any repo-policy override or any failed validation |

Stricter automation is opt-in because it changes delivery posture. It should be enabled only with an explicit repository-level policy, not inferred from a single task.

## Override points

Override points are intentionally minimal.

1. Runtime default: `v1-safe` from this document.
2. Repository policy file: future Supervisor implementations should read a committed repo-local policy from `.opencode/supervisor-policy.json`.
3. Environment overrides: budget thresholds may already be adjusted with the existing `ORCHESTRATION_WORKFLOWS_BUDGET_*` variables in `plugins/orchestration-workflows/budget.ts`.
4. Per-run human instruction: a user may narrow the policy for a specific run; widening the policy beyond `v1-safe` requires explicit opt-in.

Precedence should be: direct human instruction for the active run, then committed repository policy, then runtime defaults.

## Implementation notes

- Treat this file as the canonical reference for story work that introduces Supervisor policy wiring.
- If runtime config is added later, keep its field names aligned with the defaults defined here.
- Do not introduce automatic merge behavior as a silent default; it must remain a repository opt-in.
