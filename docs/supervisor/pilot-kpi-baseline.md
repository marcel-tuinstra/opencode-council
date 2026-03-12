# Supervisor Pilot KPI Baseline

This repository does not yet ship a full Supervisor runtime. This document defines the baseline metrics and review method for the first Supervisor pilot so the team can make a go/no-go decision without widening beyond the existing `v1-safe` contracts.

## Pilot goal

- Measure whether the Supervisor operating model improves delivery flow without increasing coordination failures or unmanaged budget risk.
- Compare a pre-pilot baseline against the first pilot cohort using the same lane lifecycle, observability, runbook, and budget-governance evidence.
- Keep the pilot reviewable with docs-first evidence instead of introducing new runtime-only instrumentation.

## Scope and source of truth

- The pilot follows the conservative lane lifecycle in `SUPERVISOR_OPERATIONS_RUNBOOK.md`: `planned -> active -> waiting -> review_ready -> complete`.
- Every pilot branch starts from fresh `main`, opens one focused PR against `main`, and keeps one active write owner per lane.
- Observability snapshots from `plugins/orchestration-workflows/observability-dashboard.ts` remain the source of truth for lane state, heartbeat, blocker state, budget status, policy decisions, and ownership transitions.
- Budget status comes from `plugins/orchestration-workflows/budget-governance.ts` and uses the existing `80%`, `100%`, and `120%` warning/escalation thresholds.
- Review-ready evidence stays aligned to `EVIDENCE_PACKET_TEMPLATE.md`; pilot measurement must link back to the packet and PR for each lane.

## Baseline metrics

| Metric | Definition | Pre-pilot baseline capture | Pilot capture | Why it matters |
| --- | --- | --- | --- | --- |
| Throughput | Completed reviewable lanes per week, plus median elapsed time from `active` to `review_ready`. | Use the most recent 4 weeks of comparable work, or the last 10 completed lanes if that yields more evidence. | Measure the same values across the full pilot window. | Shows whether the operating model moves work to review faster without adding unsafe parallelism. |
| Conflict rate | Percentage of lanes with at least one coordination conflict: failed handoff, stale or missing heartbeat during active work, blocker caused by unclear ownership, or re-entry from `review_ready` back to `active` for missing packet evidence. | Review historical PRs, packets, and any available observability or handoff records for the same 4-week or 10-lane window. | Count the same conflict signals from observability snapshots, runbook incident handling, and PR history during the pilot. | Confirms whether the Supervisor model reduces avoidable coordination churn. |
| Review latency | Median elapsed time from `review_ready` plus PR open to the first human review response or approval request. | Sample the same comparison window from merged or closed PRs tied to similar work. | Measure every pilot PR from open time to first human review event. | Tests whether structured packets help reviewers respond faster. |
| Budget overrun rate | Percentage of lanes that cross `100%` budget usage and percentage that require escalation past `120%`. | Reconstruct from available usage notes, compaction logs, or reviewer notes for the baseline window when possible; if exact historical usage is unavailable, mark the baseline as partial and record the evidence gap. | Use the budget-governance status and triggered thresholds for each pilot lane. | Confirms whether the pilot stays inside the soft-governance model before broader rollout. |

## Comparison method

### Pre-pilot baseline

Before the pilot starts:

1. Select a comparison set from the last 4 calendar weeks of similar workflow work, or the last 10 comparable completed lanes if volume is low.
2. Exclude exceptional incidents that are unrelated to the workflow itself, but record every exclusion in the baseline packet.
3. Capture one baseline packet with the metric values, sample size, evidence links, and any known evidence gaps.
4. If budget history is incomplete, keep the other three metrics measurable and mark budget overrun as a partial baseline instead of inventing data.

### Post-pilot readout

After the pilot window ends:

1. Compute the same four metrics across every pilot lane.
2. Compare pilot results against the pre-pilot baseline using medians for elapsed-time metrics and percentages for conflict and budget-overrun metrics.
3. Review the numbers together with qualitative evidence from blocker summaries, ownership transitions, and runbook incident notes so the decision is not made from one metric alone.
4. Treat the result as ready for a go/no-go decision only when every pilot lane has a linked PR, evidence packet, and observability snapshot or an explicit note that the artifact was unavailable.

## Capture and review workflow

### Required artifacts per pilot lane

- PR opened against `main`.
- Review-ready packet using `EVIDENCE_PACKET_TEMPLATE.md`.
- Observability snapshot covering lane state, heartbeat, blocker status, budget status, policy decisions, and ownership transitions.
- Short metric row added to the pilot tracker or review doc with throughput timestamp, conflict flags, first-review timestamp, and budget status.

### Review cadence

- Before pilot start: publish the pre-pilot baseline packet and confirm the comparison set.
- During the pilot: update the metric row for each lane when it reaches `review_ready` and again when human review begins or budget escalation occurs.
- Weekly during the pilot: review aggregate metrics for trend changes, especially repeated conflict signals or budget escalation past `120%`.
- After pilot completion: publish one final pilot readout with the before/after comparison and a go/no-go recommendation.

## Alignment to existing contracts

- `SUPERVISOR_OPERATIONS_RUNBOOK.md`: conflict signals come from the documented stuck-lane, failed-handoff, and budget-escalation incident flows.
- `plugins/orchestration-workflows/observability-dashboard.ts`: pilot evidence must use the existing snapshot fields instead of inventing new state categories.
- `plugins/orchestration-workflows/budget-governance.ts`: overrun tracking uses current threshold semantics and escalation behavior.
- `plugins/orchestration-workflows/lane-lifecycle.ts`: throughput and review latency are measured across the existing conservative lifecycle, especially the move into `review_ready`.
- `EVIDENCE_PACKET_TEMPLATE.md`: review latency and conflict analysis must link back to the named owner, reviewer, and verification evidence in the packet.

## Before / after behavior

Before:

- The repository had observability, runbook, lifecycle, and budget contracts, but no shared KPI baseline for deciding whether the first Supervisor pilot was successful.
- A pilot review would have required ad hoc metric selection and inconsistent evidence capture across lanes.

After:

- The first Supervisor pilot now has one documented KPI baseline covering throughput, conflict rate, review latency, and budget overrun.
- Pre-pilot and post-pilot comparisons now use one repeatable capture and review method tied to the existing workflow contracts.

Example:

```text
Before: "The pilot felt smoother, but we need to piece together PRs and notes to prove it."
After: "The pilot improved median active-to-review_ready time by 18%, reduced conflict rate from 30% to 10%, held median first-review latency flat, and triggered no budget escalations past 120%."
```

If a future change only adjusts internal helper types or adds instrumentation without changing this KPI review method, PR notes should state that there is no user-facing prompting, messaging, or workflow change.
