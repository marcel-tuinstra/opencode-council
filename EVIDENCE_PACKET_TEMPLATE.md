# Evidence Packet Template

Use this template when handing a change to reviewers or transferring the next turn to another role. It is intentionally short, reusable across repos and lane types, and aligned to the default `v1-safe` policy in `POLICY_PROFILES.md`.

## Defaults

- Assume `v1-safe` unless the repo has an explicit committed override.
- Keep the packet review-ready: link evidence, do not paste raw logs or large diffs.
- Keep manual merge as the default and call out any required human decision.
- Keep one active owner for the current turn; a handoff does not broaden the `1/1/1` lane caps.

## Handoff contract

Use the same contract for DEV, TESTER, reviewer, or mixed-role flows.

- Minimum handoff fields are: current owner, next owner, transfer scope, transfer trigger, evidence, and open questions.
- Ownership transfers only when the outgoing owner has linked the evidence needed for the next turn and named the next owner explicitly.
- Evidence must be reviewable from the packet itself: acceptance trace, verification status, and any risk or rollback note needed for the receiving owner.
- In multi-role heartbeat flows, transfer ownership only at a turn boundary or when the lead role asks for the next turn; do not switch owners mid-turn.
- A handoff changes who owns the next action, but it does not change merge authority; manual merge stays with the named human merge owner.

## Review-Ready Packet

```md
# Evidence Packet

## Change
- Story / ticket: `<ticket id or n/a>`
- Repo: `<repo>`
- Lane / workstream: `<lane or n/a>`
- Branch / PR: `<branch>` / `<pr link>`
- Policy baseline: `v1-safe` (`1/1/1` lane caps, manual merge, ask-first escalation)
- Repo policy override: `none` / `<link>`

## Acceptance Trace
| Requirement | Evidence | Status |
| --- | --- | --- |
| `<acceptance criterion or expected outcome>` | `<doc section, test, screenshot, or PR diff>` | `done` / `follow-up` |

## Diff Summary
- `<what changed and why>`
- `<key file or behavior change>`
- `<anything intentionally deferred>`

## Verification Results
| Check | Result | Notes |
| --- | --- | --- |
| `<command, review step, or manual check>` | `pass` / `fail` / `not run` | `<short outcome>` |

## Risk / Rollback
- Risk level: `<low|medium|high>`
- Key risks: `<known reviewer concerns or n/a>`
- Rollback / revert path: `<revert commit, backout plan, or n/a>`

## Handoff
- Current turn owner: `<name or role>`
- Next turn owner: `<name or role>`
- Transfer scope: `<review|test|implementation|release-readiness|n/a>`
- Transfer trigger: `<what is complete enough to pass the turn>`
- Evidence attached: `<acceptance rows, checks, screenshots, logs, or n/a>`
- Reviewer owner: `<name or team>`
- Merge owner: `<name or team>`
- Follow-up owner: `<name or team>`
- Open questions: `<none>` / `<decision needed>`
```

## Usage notes

- Use the same headings across docs-only, code, and mixed-change lanes so reviewers know where to look.
- If a section is not relevant, mark it `n/a` instead of deleting it; that keeps packets comparable.
- Ticket identifiers may come from Shortcut, Jira, or another tracker; use the repository or team convention instead of assuming one prefix.
- Keep acceptance trace tied to requirements, not a generic task list.
- Keep verification entries specific enough that another reviewer can repeat them quickly.
- If ownership stays with the same person or role, repeat that value in both handoff owner fields instead of deleting them.
- If a transfer is blocked, leave the next owner in place, mark the trigger or evidence gap explicitly, and keep the open question short enough for the Supervisor or reviewer to resolve quickly.
