# Product Positioning

OpenCode Orchestration Workflows brings structured multi-agent execution to OpenCode, with a live conversation plugin today and a supervisor/worktree foundation for staged parallel execution.

## Live today

- Mention-driven role orchestration in OpenCode chats
- Threaded `[n] ROLE: message` output for multi-role discussions
- Relevance-weighted participation and heartbeat phases
- Mention-gated MCP usage and runtime budget/compaction controls
- Runtime-visible budget checkpoints, handoff reminders, and review-ready reminders where wired into the plugin

## Foundation shipped

- Typed contracts and helpers for work units, lane planning, lane lifecycle, turn ownership, review-ready packets, merge policy, budget governance, observability, and ad-hoc run history
- Operator and pilot docs for safe staged adoption
- Test coverage around the policy layer and supporting helpers

## Coming next

- Deeper runtime wiring of supervisor helpers into normal plugin flows
- Dedicated supervisor/worktree execution mode
- A real epic pilot using the shipped safe-route operational package
