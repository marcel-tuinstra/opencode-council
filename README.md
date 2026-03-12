# OpenCode Orchestration Workflows

[![CI](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Structured multi-agent orchestration for OpenCode, with a supervisor/worktree foundation for staged parallel execution.

Note: this is an independent community plugin for OpenCode and is not affiliated with or endorsed by OpenCode.

## Why This Exists

Vanilla multi-mention prompts often produce uneven participation, unclear ownership, and ad-hoc tool usage. This project makes those flows more deliberate:

- role-based discussion stays readable
- MCP usage stays explicit and auditable
- coordination rules become predictable instead of implicit
- the repo now also lays the groundwork for safer supervisor/worktree execution later

## Live Today

- Mention-driven role orchestration in OpenCode chats
- Numbered threaded output like `[n] ROLE: message`
- Relevance-weighted participation and heartbeat phases for 3+ roles (`Frame -> Challenge -> Synthesize`)
- Mention-gated MCP behavior for installed providers
- Runtime compaction and budget controls
- Initial runtime-visible budget, handoff, and review-ready reminders where the plugin is wired locally

## Foundation Shipped

The repository also ships typed Supervisor helpers, docs, and tests for staged adoption:

- work units
- lane planning
- lane lifecycle
- turn ownership and handoff contracts
- review-ready evidence packet enforcement
- merge policy
- budget governance
- observability snapshots
- ad-hoc run history
- runbook, KPI baseline, and epic pilot packaging

These are real repo assets, but they are not the same thing as a fully user-invokable supervisor/runtime mode yet.

## How The Orchestration Model Works

1. Parse mentions and create a per-session role policy.
2. Infer intent and calculate weighted turn targets.
3. For 3+ roles, guide discussion through heartbeat phases: Frame -> Challenge -> Synthesize.
4. Gate MCP access based on explicit provider mentions.
5. Normalize the final output into a predictable thread.
6. Apply budget, compaction, and governance signals where relevant.

## What You Can Do Today

Prompt:

```text
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan using sentry and github.
```

Typical result with the plugin:

```text
[1] CTO: We need to isolate whether this is compute saturation, query contention, or an external dependency regression; start with p95/p99 breakdown and release correlation.

[2] DEV: I will inspect Sentry trace waterfalls for the hottest endpoint and map spans to the last two deployment windows.

[3] PM: I will prepare a rollback threshold, owner checklist, and a 48-hour mitigation timeline.

[4] CTO: Recommendation: run a short Sentry trace audit plus GitHub change diff first, then commit to either rollback or targeted fix.
```

In multi-role mode, this usually follows a heartbeat rhythm:

- `Frame`: set the problem and decision space
- `Challenge`: react, test assumptions, or bring contrary evidence
- `Synthesize`: close with a lead recommendation or next step

## Installation And Quick Start

- Install: [`docs/getting-started/install.md`](./docs/getting-started/install.md)
- Quick start: [`docs/getting-started/quickstart.md`](./docs/getting-started/quickstart.md)
- Customization: [`docs/guides/customization.md`](./docs/guides/customization.md)

## Docs For Operators And Contributors

- Docs index: [`docs/README.md`](./docs/README.md)
- Product positioning: [`docs/overview/product-positioning.md`](./docs/overview/product-positioning.md)
- Architecture overview: [`docs/overview/architecture.md`](./docs/overview/architecture.md)
- Status and roadmap: [`docs/overview/status-and-roadmap.md`](./docs/overview/status-and-roadmap.md)
- Policy profiles: [`docs/guides/policy-profiles.md`](./docs/guides/policy-profiles.md)
- Supervisor work units: [`docs/supervisor/work-units.md`](./docs/supervisor/work-units.md)
- Operations runbook: [`docs/supervisor/operations-runbook.md`](./docs/supervisor/operations-runbook.md)
- Pilot KPI baseline: [`docs/supervisor/pilot-kpi-baseline.md`](./docs/supervisor/pilot-kpi-baseline.md)
- Epic pilot package: [`docs/supervisor/epic-pilot.md`](./docs/supervisor/epic-pilot.md)
- Evidence packet template: [`docs/reference/evidence-packet-template.md`](./docs/reference/evidence-packet-template.md)
- Testing guide: [`docs/testing/testing.md`](./docs/testing/testing.md)

## Roadmap And Current Limits

Live now:

- conversation-first orchestration plugin
- MCP gating, heartbeat phases, thread normalization, and compaction behavior
- shipped policy/governance/runtime helper foundation

Coming next:

- deeper runtime wiring of the Supervisor helpers
- dedicated supervisor/worktree execution mode
- real pilot execution evidence and follow-up hardening

Current limit:

- the repo already contains substantial Supervisor contracts and operating docs, but that does not yet mean a full supervisor mode is available as a normal end-user runtime flow

## Repository Layout

- Plugin entrypoint: `plugins/orchestration-workflows.ts`
- Plugin modules: `plugins/orchestration-workflows/*.ts`
- Tests: `tests/*.test.ts`
- Agent personas: `agents/*.md`
- Docs: `docs/**`

## Contact

- Website: [`https://marcel.tuinstra.dev`](https://marcel.tuinstra.dev)
- Email: `marcel@tuinstra.dev`

## License

This project is licensed under the MIT License. See `LICENSE` for details.
