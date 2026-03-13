# Architecture Overview

The repository currently has two layers.

## 1. Live plugin runtime

The active OpenCode plugin lives in `plugins/orchestration-workflows/index.ts` and focuses on conversation orchestration:

- mention parsing
- intent detection and turn targeting
- heartbeat phases
- MCP gating
- output normalization
- budget and compaction handling

## 2. Supervisor foundation

The repo now also ships typed helpers and contracts for a future supervisor/worktree mode:

- `work-unit.ts`
- `lane-plan.ts`
- `lane-lifecycle.ts`
- `durable-state-store.ts`
- `lane-worktree-provisioner.ts`
- `turn-ownership.ts`
- `review-ready-packet.ts`
- `merge-policy.ts`
- `budget-governance.ts`
- `observability-dashboard.ts`
- `ad-hoc-run-history.ts`

These pieces are intentionally shipped as integration-ready building blocks, with docs and tests, before a fully user-invokable supervisor runtime is introduced.
