# Supervisor Operations Runbook

This repository does not yet ship a full Supervisor runtime. This runbook defines the reviewable v1 operating model for normal operations, pause and recovery flow, and common incident response while staying aligned to the safe defaults in `POLICY_PROFILES.md`.

## Operating baseline

- Default policy is `v1-safe`: ask-first escalation, manual merge, and conservative concurrency.
- Start every implementation lane from fresh `main`; do not chain work from another feature branch.
- Keep exactly one active write owner per lane at a time, even when multiple roles participate.
- Treat `review_ready` as the handoff point where the lane has a reviewable packet and an open PR or equivalent artifact.
- Use observability snapshots to confirm lane state, heartbeat health, blocker state, policy decisions, ownership transitions, and budget status before changing course.

## Normal operations

### 1. Intake and lane start

Before starting work:

- Normalize the request into the canonical work-unit fields in `SUPERVISOR_WORK_UNITS.md`.
- Confirm dependencies, acceptance criteria, evidence links, and risk tags are recorded.
- Choose the smallest safe lane plan; expected duration is not a gating input.
- Keep code-change concurrency at `1` and open-PR concurrency at `1` unless an explicit repo policy says otherwise.

Checklist:

- [ ] Work unit has objective, constraints, acceptance criteria, dependencies, risk tags, evidence links, and source metadata.
- [ ] Lane dependencies and blocked vs parallelizable work are clear.
- [ ] Active lane count fits the repository tier cap.
- [ ] The implementation branch starts from fresh `main`.

### 2. Active execution

While a lane is active:

- Keep the lane lifecycle conservative: `planned -> active -> waiting -> review_ready -> complete`.
- Record every ownership handoff with delta summary, current risks, next required evidence, and attached evidence.
- Use the observability view as the source of truth for heartbeat freshness, blocker status, and recent policy decisions.
- Pause for a human decision when the next action is risky, ambiguous, destructive, or would broaden automation beyond `v1-safe`.

Checklist:

- [ ] Lane state matches actual work.
- [ ] Exactly one role holds active write authority.
- [ ] Latest handoff contract names the next owner and required evidence.
- [ ] Heartbeat is healthy or explicitly explained.
- [ ] No merge occurs without human approval.

### 3. Review-ready handoff

Before moving a lane to `review_ready`:

- Build the minimum review-ready packet from `EVIDENCE_PACKET_TEMPLATE.md`.
- Include acceptance trace, scoped diff summary, verification results, risk or rollback notes, and explicit ownership.
- Open the PR against `main` and treat that artifact as part of the handoff evidence.
- Keep the lane in `active` or `waiting` if the packet is incomplete.

Checklist:

- [ ] Acceptance criteria trace maps each requirement to evidence.
- [ ] Verification results are current and repeatable.
- [ ] Risk and rollback notes are explicit.
- [ ] Reviewer owner, merge owner, and follow-up owner are named.
- [ ] PR targets `main` and is linked in the packet.

## Pause and recovery

### Planned pause

Use a planned pause when a lane needs human review, upstream input, or a deliberate checkpoint.

Steps:

1. Move the lane to `waiting` only if a real external dependency or decision is blocking forward work.
2. Publish a handoff or blocker update with owner, blocker summary, and next evidence needed to resume.
3. Confirm the latest observability snapshot reflects the blocker and heartbeat status.
4. Resume by moving `waiting -> active` only after the dependency, evidence, or human decision arrives.

### Recovery after interruption

Use this flow after a stale session, tool interruption, or operator handoff gap.

Steps:

1. Reconstruct the latest lane state, ownership transition, blocker state, and budget position from the observability snapshot.
2. Re-read the latest review-ready packet or handoff contract before changing code or docs.
3. If ownership is unclear, stop and assign a single current owner before resuming work.
4. If evidence is missing, stay in `waiting` and record the gap instead of inferring completion.

## Incident playbook

### Incident severity and ownership

- Lane operator owns first response: classify the issue, stabilize the lane, and record current state.
- Reviewer or merge owner owns approval decisions once a lane is `review_ready`.
- Human repository owner owns any merge, policy override, or scope increase beyond `v1-safe`.
- Budget escalation requires explicit human review before autonomous execution resumes past `120%`.

### Incident: stuck lane

Signals:

- Lane remains `active` but heartbeat is stale or missing.
- The current owner cannot identify the next evidence or blocker.
- The lane shows no meaningful ownership transition while work is supposedly continuing.

Response:

1. Freeze new lane activity; do not start parallel code-change work to compensate.
2. Inspect the latest observability snapshot for heartbeat health, blocker details, and the most recent ownership handoff.
3. Decide whether the lane is actually blocked; if so, move it to `waiting` and name the blocker owner.
4. If work can resume, assign one active owner, publish a fresh handoff contract, and continue in `active`.
5. If the lane cannot be reconstructed safely, escalate to a human owner with the missing context called out explicitly.

Operator checklist:

- [ ] Heartbeat status checked.
- [ ] Current owner confirmed.
- [ ] Lane state corrected to `waiting` or `active`.
- [ ] Missing evidence or blocker recorded.
- [ ] Human escalation raised if ownership or state remains ambiguous.

### Incident: failed handoff

Signals:

- Next owner is named, but required evidence is absent or incomplete.
- Reviewer cannot validate the lane because packet sections are missing.
- Ownership changed informally without a structured handoff contract.

Response:

1. Reject the handoff as incomplete; do not mark the lane `review_ready`.
2. Return ownership to the last valid current owner or keep the lane in `active` with that owner.
3. Rebuild the handoff packet with delta summary, risks, next required evidence, and attached evidence.
4. Re-run the missing validation or documentation step before attempting another transfer.
5. Record the corrected handoff so the observability history remains auditable.

Operator checklist:

- [ ] Invalid handoff stopped before review-ready transition.
- [ ] Current owner reset to a single accountable role.
- [ ] Missing evidence regenerated or linked.
- [ ] New handoff contract published.
- [ ] Reviewer owner notified only after packet is complete.

### Incident: budget escalation

Signals:

- Budget governance reaches warning thresholds at `80%`, `100%`, or `120%`.
- Status becomes `escalation-required` past `120%`.
- Optional runaway hard-stop fires if a repository explicitly enables it.

Response:

1. At `80%` or `100%`, keep working only with tighter watch: compact context, reduce scope, and reduce active lanes if needed.
2. Past `120%`, pause autonomous execution and open a checkpoint review.
3. Record the required justification, the scope-or-lane reduction decision, and the checkpoint owner.
4. Resume only after the human reviewer accepts the plan to continue.
5. If hard-stop is enabled and triggered, do not continue until a human changes the plan or policy explicitly.

Operator checklist:

- [ ] Current budget status and thresholds captured.
- [ ] Scope reduction or lane reduction decision recorded.
- [ ] Checkpoint review requested.
- [ ] Human approval captured before resuming past `120%`.
- [ ] Hard-stop treated as terminal until explicitly cleared.

## Observability contract in practice

For every active or recovering lane, review these fields together:

- lane state and total state counts
- heartbeat health and stale timeout
- blocker summary, owner, and updated timestamp
- ownership transition history
- recent policy decisions
- budget status, triggered thresholds, and escalation events

If these fields disagree with the narrative in the handoff packet, trust the mismatch as an incident signal and reconcile the lane before more work starts.

## Escalation ownership

Escalate to a human owner when any of the following is true:

- the next action could materially change scope and the runbook does not make the safe choice obvious
- merge or release action would be required
- budget status is `escalation-required` or `hard-stop`
- a lane cannot be safely resumed because ownership, evidence, or blocker state is unclear
- repository policy would need to widen beyond `v1-safe`

Minimum escalation packet:

- lane id and current state
- current owner and requested next owner
- blocker or incident summary
- budget status if relevant
- exact human decision needed
- links to the latest handoff packet, PR, and observability snapshot

## Before / after behavior

Before:

- The repository defined lifecycle, handoff, review-ready, budget, and observability contracts independently, but operators did not have one runbook for day-to-day execution and incident response.
- Common failures such as stale lanes, incomplete handoffs, or budget overruns required reading several docs and inferring operator ownership.

After:

- Operators have a single runbook for normal lane execution, planned pauses, recovery, and incident handling.
- Stuck lanes, failed handoffs, and budget escalation now have explicit response steps, checklists, and human escalation ownership aligned to the existing contracts.

Example:

```text
Before: "The lane is still active, but the heartbeat is stale and review is waiting somewhere."
After: "Treat this as a stuck-lane incident: inspect observability, confirm the active owner, move the lane to waiting if blocked, record the blocker owner, and escalate if the last valid handoff cannot be reconstructed."
```

If a future change only tweaks helper types or implementation details without changing this operating guidance, PR notes should say there is no operator-facing workflow change.
