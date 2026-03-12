# Evidence Packet Template

Use this template when handing a change to reviewers. It is intentionally short, reusable across repos and lane types, and aligned to the default `v1-safe` policy in `POLICY_PROFILES.md`.

## Defaults

- Assume `v1-safe` unless the repo has an explicit committed override.
- Keep the packet review-ready: link evidence, do not paste raw logs or large diffs.
- Keep manual merge as the default and call out any required human decision.

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
