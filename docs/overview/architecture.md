# Architecture Overview

The plugin has two layers: a live runtime that powers conversation orchestration today, and a supervisor foundation that will enable governed parallel execution in a future release.

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

## 2. Supervisor foundation

The repo also ships typed helpers and contracts for governed parallel execution (targeted for v0.6.0). These are fully tested but not yet wired into a user-invokable runtime:

- Work unit normalization and lane planning
- Lane lifecycle with conservative state machine
- Durable state store for restart-safe execution
- Lane worktree provisioner and reconciler
- Session runtime adapter with stall detection and replacement
- Scheduler and dispatch loop
- Recovery and repair playbooks
- Governance policy engine
- Evidence packet enforcement

The design specs for these components are maintained in Shortcut (linked from sc-527) rather than in the repo, to keep the documentation surface focused on user-facing features.
