# Supervisor Policy Profiles

This repository does not yet ship a full Supervisor runtime. Until that lands, this document is the reviewable v1 contract for policy defaults, repository classification, and override points.

## Canonical default profile

The initial default profile is `v1-safe`.

It is the baseline that implementation teams should assume unless a repository opts into something stricter.

| Area | `v1-safe` default | Why it is the default |
| --- | --- | --- |
| Lane caps | `max_active_workstreams: 1`, `max_concurrent_code_changes: 1`, `max_open_pull_requests: 1` | Keeps execution serial, reviewable, and easy to unwind. |
| Merge mode | `manual` | Requires a human to merge; no auto-merge by default. |
| Budget thresholds | `soft_run_tokens: 6400`, `hard_run_tokens: 8400`, `soft_step_tokens: 2800`, `hard_step_tokens: 4000`, `truncate_at_tokens: 1400` | Reuses the current budget governor defaults already implemented in `plugins/orchestration-workflows/budget.ts`. |
| Escalation mode | `ask-first` | Pushes risky or ambiguous actions back to a human before the workflow continues. |

## Repository classification rubric

Use repository classification to decide whether a repo should stay on the baseline `v1-safe` profile or opt into a stricter repository policy. Classification does not justify widening automation beyond `v1-safe` by default.

Choose the highest-risk tier that matches. Production impact, security sensitivity, and rollback difficulty outrank repository size.

| Tier | When to use it | Typical signals | Policy guidance |
| --- | --- | --- | --- |
| Small/high-risk | Small surface area, new ownership, or limited history, but mistakes are costly | Infra or deployment repo, secrets or access-policy changes, weak test coverage, no proven rollback path, sparse ownership | Stay on `v1-safe`; keep manual merge and `1/1/1` lane caps; prefer earlier escalation and lower token thresholds if the repo opts into stricter automation |
| Medium/moderate-risk | Established repo with bounded blast radius and workable delivery controls | Service or app repo with regular CI, at least one clear owner, repeatable review habits, and partial rollback coverage | Default to `v1-safe`; lane caps remain `1/1/1`; repo-level policy may tighten escalation or budgets, but should not widen merge or lane behavior by default |
| Large/mature | Broad codebase with strong ownership and proven operational controls | Monorepo or shared platform with CODEOWNERS, required CI, release playbooks, stable rollback, and clear change domains | Default still starts at `v1-safe`; only an explicit repo policy may allow `queue` merge, and only when CI is required; lane caps stay at `1/1/1` unless a human explicitly overrides them |

## Examples and edge cases

| Case | Recommended tier | Why |
| --- | --- | --- |
| Small Terraform repo that manages production networking | Small/high-risk | Low line count does not reduce the blast radius of an incorrect change |
| Mid-size product service with healthy CI and a normal on-call rotation | Medium/moderate-risk | Delivery controls exist, but the repo is not mature enough to infer stricter automation |
| Large monorepo with required CI, code owners, and rehearsed rollback procedures | Large/mature | Process maturity lowers operational uncertainty, even with a broad surface area |
| Docs-only or marketing site repo with no production side effects | Medium/moderate-risk | Small size alone is not enough for the highest-risk tier; classify by real-world impact |
| Mature but security-sensitive access-control repo | Small/high-risk | Sensitive changes and difficult recovery outweigh maturity signals |
| Newly split repo extracted from a mature monorepo | Medium/moderate-risk | Inherit some process maturity, but wait for repo-local history and ownership before treating it as large/mature |

When evidence is mixed, use these tie-breakers:

- If a repo can directly impact production, credentials, billing, or access control, classify it as small/high-risk unless strong counter-evidence is documented.
- If maturity signals depend on another repository or team process that is not enforced here, classify conservatively.
- If a repo is temporarily in incident or migration mode, keep the stored tier stable and narrow the active run with human instruction instead of reclassifying permanently.
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
- Repository tiering should feed policy selection conservatively: classification may justify stricter handling, but not silently broader automation.
- If runtime config is added later, keep its field names aligned with the defaults and tiers defined here.
- Do not introduce automatic merge behavior as a silent default; it must remain a repository opt-in.
