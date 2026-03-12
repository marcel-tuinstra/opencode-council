# OpenCode Orchestration Workflows Plugin

[![CI](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

Community plugin for OpenCode to run role-based orchestration workflows.

Note: This is an independent community plugin for OpenCode and is not affiliated with or endorsed by OpenCode.

## Why this plugin

This plugin adds structured multi-agent output to OpenCode using `@` mentions. It is aimed at teams that want role-based discussion, clearer debate format, and controlled MCP tool usage in one workflow.

Vanilla multi-mention prompts often produce uneven role participation and unpredictable tool usage. This plugin enforces a predictable thread format and mention-scoped MCP policy so team discussions remain legible.

## What you get

- Single mention (`@cto`) returns a normal direct answer.
- Single-role conversations can self-delegate to additional roles via `<<DELEGATE:...>>` when confidence is low.
- Multi-mention prompts produce threaded output like `[n] ROLE: message`.
- Relevance-weighted airtime for better role balance.
- Automatic heartbeat discussion phases for 3+ mentioned roles (Frame -> Challenge -> Synthesize).
- Mention-gated MCP behavior for installed providers like `sentry`, `github`, `shortcut`, and `nuxt`.

## How it works

1. Parse mentions and set a per-session role policy.
2. Infer intent and calculate weighted turn targets.
3. Enforce MCP provider access from explicit provider mentions.
4. Normalize the final output into a readable numbered thread.

## Before and after

Prompt:

```text
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan using sentry and github.
```

Without plugin (typical):

```text
We should look at logs, traces, and maybe recent PRs. PM should track risks and CTO should align on architecture.
```

With plugin:

```text
[1] CTO: We need to isolate whether this is compute saturation, query contention, or an external dependency regression; start with p95/p99 breakdown and release correlation.

[2] DEV: I will inspect Sentry trace waterfalls for the hottest endpoint and map spans to the last two deployment windows.

[3] PM: I will prepare a rollback threshold, owner checklist, and a 48-hour mitigation timeline.

[4] CTO: Recommendation: run a short Sentry trace audit plus GitHub change diff first, then commit to either rollback or targeted fix.
```

## MCP gating behavior

- No provider named: MCP calls are blocked.
- One provider named: only that provider can be used.
- Multiple providers named: each named provider must be used at least once before reusing one provider repeatedly.
- Call caps: default is 2 MCP calls, deep investigations can raise that cap.

Examples:

```text
@dev Fix the bug from today.
# MCP blocked unless a provider is named.

@dev investigate with sentry
# Only sentry MCP tools allowed.

@cto @dev compare sentry and github evidence before deciding.
# Both sentry and github must be touched.
```

## Quick example

```text
@ceo @cto @dev @po @pm @marketing @research Launch analytics in 6 weeks; debate tradeoffs and produce a phased plan.
```

## Installation

For setup steps, copy commands, and a quick verification prompt, see [`INSTALL.md`](./INSTALL.md).

## Development and tests

```bash
npm install
npm test
```

CI runs the same test command on Node 22 and 24 via GitHub Actions (`.github/workflows/ci.yml`).

## Repository layout

- Plugin entrypoint: `plugins/orchestration-workflows.ts`
- Plugin modules: `plugins/orchestration-workflows/*.ts`
- Tests: `tests/*.test.ts`
- Agent personas: `agents/*.md`
- Supervisor policy defaults: `POLICY_PROFILES.md`
- Manual verification matrix: `TESTING.md`

## Configuration notes

- Default MCP policy is mention-gated by provider name.
- If no provider is named, MCP calls are blocked.
- If multiple providers are named, each must be touched at least once.
- To add Jira (or another provider), update built-in patterns and tool prefix mapping in `plugins/orchestration-workflows/constants.ts` and `plugins/orchestration-workflows/mcp.ts`.
- For full customization (custom MCP checks, adding roles, and authoring agents), see [`CUSTOMIZATION.md`](./CUSTOMIZATION.md).
- Canonical Supervisor policy defaults and override guidance live in [`POLICY_PROFILES.md`](./POLICY_PROFILES.md).
- Context compaction uses workflow-aware profiles in `plugins/orchestration-workflows/constants.ts` (`COMPACTION_PROFILES`) and preserves goals, constraints, blockers, and open actions.

## Who this is for

- Teams that want deliberate, role-based technical debate in one prompt.
- Users who want MCP calls to be explicit and auditable.

Not ideal for:

- Freeform brainstorming where rigid turn structure is undesirable.
- Workflows that require unconstrained MCP usage.

## Contact

- Website: [`https://marcel.tuinstra.dev`](https://marcel.tuinstra.dev)
- Email: `marcel@tuinstra.dev`

## License

This project is licensed under the MIT License. See `LICENSE` for details.
