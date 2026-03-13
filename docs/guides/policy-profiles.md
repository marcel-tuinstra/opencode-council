# Supervisor Policy Profiles

This repository does not yet ship a full Supervisor runtime. Until that lands, this document is the reviewable v1 contract for policy defaults, repository classification, and override points.

## Canonical default profile

The initial default profile is `v1-safe`.

It is the baseline that implementation teams should assume unless a repository opts into something stricter.

| Area | `v1-safe` default | Why it is the default |
| --- | --- | --- |
| Lane lifecycle and caps | `lane_states: planned -> active -> waiting -> review_ready -> complete`; `max_active_lanes_by_tier: 2/3/4` for `small-high-risk`, `medium-moderate-risk`, `large-mature`; `max_concurrent_code_changes: 1`; `max_open_pull_requests: 1` | Allows limited planning concurrency without widening implementation or review concurrency by default. |
| Merge mode | `manual`; optional `auto-merge` only by explicit repo opt-in | Keeps human approval as the default; any auto-merge path must stay behind repository policy, service-criticality checks, and path eligibility. |
| Budget thresholds | `soft_run_tokens: 6400`, `soft_step_tokens: 2800`, warning thresholds at `80%`, `100%`, and `120%`, escalation past `120%`, `truncate_at_tokens: 1400`; optional runaway hard-stop remains opt-in and can reuse `hard_run_tokens: 8400` / `hard_step_tokens: 4000` as explicit override thresholds | Keeps budget control soft by default, adds progressive warnings plus required escalation after `120%`, and preserves hard-stop only as explicit runaway protection. |
| Escalation mode | `ask-first` | Pushes risky or ambiguous actions back to a human before the workflow continues. |

## Repository classification rubric

Use repository classification to decide whether a repo should stay on the baseline `v1-safe` profile or opt into a stricter repository policy. Classification does not justify widening automation beyond `v1-safe` by default.

Choose the highest-risk tier that matches. Production impact, security sensitivity, and rollback difficulty outrank repository size.

| Tier | When to use it | Typical signals | Policy guidance |
| --- | --- | --- | --- |
| Small/high-risk | Small surface area, new ownership, or limited history, but mistakes are costly | Infra or deployment repo, secrets or access-policy changes, weak test coverage, no proven rollback path, sparse ownership | Stay on `v1-safe`; keep manual merge, default to `max_active_lanes: 2`, and retain `1` concurrent code-change lane plus `1` open PR; prefer earlier escalation and lower token thresholds if the repo opts into stricter automation |
| Medium/moderate-risk | Established repo with bounded blast radius and workable delivery controls | Service or app repo with regular CI, at least one clear owner, repeatable review habits, and partial rollback coverage | Default to `v1-safe`; default to `max_active_lanes: 3`, while concurrent code changes and open PRs remain `1`; repo-level policy may tighten escalation or budgets, but should not widen merge behavior or lane caps without explicit configuration |
| Large/mature | Broad codebase with strong ownership and proven operational controls | Monorepo or shared platform with CODEOWNERS, required CI, release playbooks, stable rollback, and clear change domains | Default still starts at `v1-safe`; default to `max_active_lanes: 4`, keep `1` concurrent code-change lane and `1` open PR, and allow `queue` merge only when the repo explicitly enables it and CI is required |

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
- a configured hard-stop runaway threshold is exceeded
- a merge would be required to finish the task
- a request asks to broaden automation beyond the default policy

Escalation means the Supervisor should stop autonomous execution, summarize the blocking condition, and ask for the smallest clarifying human decision.

## Safe default vs opt-in stricter automation

Use `v1-safe` unless a repository explicitly opts into tighter automation policy.

| Area | `v1-safe` | Opt-in stricter automation |
| --- | --- | --- |
| Lane caps | Active lane caps follow repo tier defaults (`2/3/4`), while code changes and open PRs stay at `1` | Same or lower caps; never higher than the tier default without explicit configuration |
| Merge mode | Manual merge only | `queue` or `auto-merge` is allowed only when the repo explicitly enables it, the repo is classified `large-mature`, and merge eligibility still passes service-criticality and path checks |
| Budget thresholds | Soft budget governance with warnings at `80%`, `100%`, and `120%`, mandatory escalation past `120%`, and opt-in runaway hard-stop thresholds | Lower warning or hard-stop thresholds to force earlier compaction or escalation |
| Escalation | Ask on risky actions | Ask earlier and on more categories, such as any repo-policy override or any failed validation |

Stricter automation is opt-in because it changes delivery posture. It should be enabled only with an explicit repository-level policy, not inferred from a single task.

## Override points

Override points are intentionally minimal.

1. Runtime default: `v1-safe` from this document.
2. Repository policy file: the runtime now reads a committed repo-local policy from `.opencode/supervisor-policy.json`.
3. Environment overrides: runtime budget thresholds may still be adjusted with the existing `ORCHESTRATION_WORKFLOWS_BUDGET_*` variables in `plugins/orchestration-workflows/budget.ts`; those values win over the repo policy file for the live budget governor.
4. Per-run human instruction: a user may narrow the policy for a specific run; widening the policy beyond `v1-safe` requires explicit opt-in.

Precedence should be: direct human instruction for the active run, then committed repository policy, then runtime defaults.

## Implementation notes

- Treat this file as the canonical reference for story work that introduces Supervisor policy wiring.
- Keep the canonical intake model aligned with `SUPERVISOR_WORK_UNITS.md` so tracker-backed and ad-hoc work share the same minimum planning fields.
- Repository tiering should feed policy selection conservatively: classification sets the default active lane cap, but does not silently widen merge behavior or code-change concurrency.
- Keep the repo policy file field names aligned with the defaults and tiers defined here.
- Do not introduce automatic merge behavior as a silent default; it must remain a repository opt-in.
- Merge eligibility should treat service criticality and changed-path scope as the primary gates; labels may inform routing or intent, but should remain secondary hints.
- Lane cap overrides should come only from explicit configuration, not from inferred repo maturity beyond the default tier mapping.
- Budget escalation past `120%` should require a human-readable justification, a recorded scope-or-lane reduction decision, and a checkpoint review before autonomous execution resumes when hard-stop is disabled.
- Invalid repo policy config should fail safe: keep the `v1-safe` defaults for any invalid field and surface diagnostics for operators.
