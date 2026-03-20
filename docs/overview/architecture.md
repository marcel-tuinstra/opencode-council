# Architecture Overview

The package now has two intentionally different public contracts: a small stable runtime contract for the live orchestration system, and an experimental supervisor contract for governed parallel execution that is still evolving toward `v0.6.0`.

## 1. Live plugin runtime

The active OpenCode plugin lives in `plugins/orchestration-workflows/index.ts` and hooks into four experimental plugin extension points:

```
  User prompt with @mentions
  |
  v
  tui.prompt.append          Inject agent persona context
  |
  v
  chat.messages.transform    Parse roles, detect intent, build session policy,
                             detect delegation requests, build DelegationPlan
  |
  v
  chat.system.transform      Inject system instructions (heartbeat phases,
                             role contracts, delegation lead instructions)
  |
  v
  text.complete              Normalize threaded output, apply governance,
                             parse delegation markers, append supervisor
                             decision notes, enforce budget/compaction
```

Key modules:

- **roles.ts** -- mention parsing, role detection, delegation plan construction
- **contracts.ts** -- system prompt generation, heartbeat phase injection
- **output.ts** -- thread normalization, delegation marker extraction, provenance rendering
- **intent.ts** -- intent detection and weighted turn targeting
- **budget.ts** -- token budget tracking and compaction triggers
- **mcp.ts** -- mention-gated MCP provider access
- **session.ts** -- per-session policy state management

### Stable runtime contract

Starting in `v0.5.0`, the package root is reserved for the minimal stable runtime surface:

- `AgentConversations`
- `SUPPORTED_ROLES`
- `Role`
- `Intent`
- `DelegationMode`
- `DelegationRequest`
- `DelegationWave`
- `DelegationPlan`
- `SessionPolicy`

This is the contract consumers can build against with `v0.5.x` stability expectations. The canonical compatibility and deprecation policy lives in [`../guides/compatibility-and-deprecations.md`](../guides/compatibility-and-deprecations.md). The goal is to freeze the runtime-facing types that describe live conversation orchestration without also freezing supervisor internals too early.

## 2. Supervisor foundation

The repo also ships typed helpers and contracts for governed parallel execution (targeted for `v0.6.0`). These are fully tested but not yet wired into a user-invokable runtime:

- Work unit normalization and lane planning
- Lane lifecycle with conservative state machine
- Durable state store for restart-safe execution
- Lane worktree provisioner and reconciler
- Session runtime adapter with stall detection and replacement
- Scheduler and dispatch loop
- Recovery and repair playbooks
- Governance policy engine
- Evidence packet enforcement

### Experimental supervisor contract

In `v0.5.0`, these supervisor APIs move behind an experimental supervisor entry point instead of remaining in the root barrel. That split communicates two things clearly:

- The live orchestration runtime contract is stable and intentionally small.
- Supervisor planning and execution helpers are still experimental, even though they are typed and tested.

Consumers that adopt supervisor helpers should import them from `opencode-council/supervisor` and should plan for additional API iteration before the supervisor surface is stabilized in `v0.6.0`.

The design specs for these components are maintained in Shortcut (linked from sc-527) rather than in the repo, to keep the documentation surface focused on user-facing features.
