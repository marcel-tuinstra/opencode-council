# OpenCode Orchestration Workflows

[![CI](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](https://github.com/marcel-tuinstra/opencode-orchestration-workflows/releases)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-green.svg)](https://github.com/sst/opencode)

**AI agents that debate before they act.**

Multi-agent orchestration for [OpenCode](https://github.com/sst/opencode) where specialized roles deliberate, challenge assumptions, and synthesize recommendations -- instead of blindly executing tasks.

---

## Quick Start

```bash
# Clone the repo
git clone https://github.com/marcel-tuinstra/opencode-orchestration-workflows.git
cd opencode-orchestration-workflows

# Copy plugin and agents into OpenCode
mkdir -p ~/.opencode/plugins ~/.opencode/agents
cp plugins/orchestration-workflows.ts ~/.opencode/plugins/
cp -R plugins/orchestration-workflows ~/.opencode/plugins/
cp agents/*.md ~/.opencode/agents/
```

Restart OpenCode, then try:

```
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan using sentry and github.
```

That's it. Three agents, structured discussion, actionable output.

---

## What You Get

**Deliberative multi-agent discussions** -- not fire-and-forget task delegation. Agents think through problems together using a structured heartbeat model before recommending action.

| Capability | What it does |
|---|---|
| Mention-driven roles | `@cto @dev @pm` activates exactly the agents you need |
| Heartbeat phases | Frame, Challenge, Synthesize -- structured reasoning for every discussion |
| Threaded output | Clean `[n] ROLE: message` format, easy to follow and reference |
| Delegation mode | `@cto delegate [prompt]` -- one lead agent plans and coordinates specialists |
| MCP gating | Tools like Sentry and GitHub only activate when explicitly mentioned |
| Budget governance | Token budgets, reason codes, and policy profiles prevent runaway execution |
| 10 specialized agents | CTO, CEO, PO, PM, DEV, FE, BE, UX, Research, Marketing |
| 197 passing tests | CI on every PR, typed contracts throughout |

---

## Architecture

```
  You: @cto @dev @pm [your prompt]
  |
  v
  +--------------------------+
  | Role detection           |    Parse @mentions, detect intent
  | Intent parsing           |    Calculate weighted turn targets
  +--------------------------+
  |
  v
  +--------------------------+
  | Session policy           |    Roles, MCP gates, budget limits
  +--------------------------+
  |
  v
  +--------------------------+
  | Heartbeat phases         |    Frame --> Challenge --> Synthesize
  |                          |    (for 3+ role discussions)
  +--------------------------+
  |
  v
  +--------------------------+
  | Governance checks        |    Budget enforcement, reason codes
  +--------------------------+
  |
  v
  [1] CTO: ...
  [2] DEV: ...
  [3] PM: ...
  [4] CTO: Recommendation: ...
```

For delegation mode:

```
  You: @cto delegate [your prompt]
  |
  v
  +--------------------------+
  | Lead agent identified    |    CTO takes ownership
  +--------------------------+
  |
  v
  +--------------------------+
  | DelegationPlan built     |    Waves, max-parallel, goals
  +--------------------------+
  |
  v
  +--------------------------+
  | Lead-first instruction   |    CTO frames, then delegates
  +--------------------------+
  |
  v
  +--------------------------+
  | Wave-based execution     |    Specialists execute with provenance
  | Supervisor annotations   |    Every delegation step is auditable
  +--------------------------+
```

---

## Live Example

**Prompt:**

```
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan using sentry and github.
```

**Output:**

```
[1] CTO: We need to isolate whether this is compute saturation, query contention,
    or an external dependency regression; start with p95/p99 breakdown and release
    correlation.

[2] DEV: I will inspect Sentry trace waterfalls for the hottest endpoint and map
    spans to the last two deployment windows.

[3] PM: I will prepare a rollback threshold, owner checklist, and a 48-hour
    mitigation timeline.

[4] CTO: Recommendation: run a short Sentry trace audit plus GitHub change diff
    first, then commit to either rollback or targeted fix.
```

Notice the rhythm: CTO frames the problem, DEV and PM challenge with their expertise, CTO synthesizes a recommendation. That's the heartbeat model in action.

---

## How It Works

Most multi-agent systems use **task delegation**: an orchestrator tells agents what to do. The agents execute, report back, done.

This plugin uses **deliberative discussion**. When you mention multiple roles, they engage in structured reasoning through three heartbeat phases:

| Phase | Purpose | Example |
|---|---|---|
| **Frame** | Set the problem and decision space | CTO defines the investigation scope |
| **Challenge** | Test assumptions, bring contrary evidence, fill gaps | DEV identifies specific traces; PM raises timeline risk |
| **Synthesize** | Close with a lead recommendation or next step | CTO recommends a concrete action plan |

For two-role prompts, agents exchange perspectives naturally. For three or more roles, the heartbeat phases activate automatically to keep the discussion focused and productive.

Single-role prompts (`@cto What's the best approach for...`) produce a direct expert response without threading overhead.

---

## Agent Roster

| Agent | Focus |
|---|---|
| **CTO** | Technical strategy, architecture decisions, system-level tradeoffs |
| **CEO** | High-level strategy, priorities, success metrics |
| **PO** | Product outcomes, requirements, acceptance criteria |
| **PM** | Delivery planning, scope management, risk mitigation |
| **DEV** | Full-stack implementation, debugging, feature delivery |
| **FE** | Frontend UI/UX implementation, components, layout |
| **BE** | Backend services, APIs, data flows, infrastructure |
| **UX** | Interaction design, usability, UI quality review |
| **Research** | Investigation, evidence gathering, options analysis |
| **Marketing** | Messaging, positioning, launch content |

Every agent has a dedicated persona file in `agents/` that shapes its perspective, expertise, and communication style.

---

## Delegation Mode

*New in v0.3.0*

Sometimes you want one agent to lead and pull in specialists as needed. Delegation mode lets a single lead agent build a structured plan and coordinate execution.

```
@cto delegate Refactor the authentication module to support OAuth2 and migrate existing sessions.
```

The CTO takes ownership, breaks the work into waves, and delegates to DEV, BE, FE, or other specialists -- with full provenance tracking on every delegated step.

Key properties:

- **Lead-first planning**: The lead agent frames the approach before any specialist acts
- **Wave-based execution**: Work is organized into dependency-ordered waves
- **Provenance tracking**: Every delegation step is annotated with who delegated what and why
- **Supervisor annotations**: Decision rationale is visible in the output thread

---

## Governance and Safety

This is where the plugin diverges most from other multi-agent approaches.

**Budget governance** -- every session runs under token budget limits. When a discussion approaches its budget ceiling, the plugin compacts output and signals agents to synthesize rather than expand. No surprise cost spikes from runaway agent conversations.

**Reason codes** -- every routing decision, turn assignment, budget action, and MCP gating step produces a machine-readable reason code. Operators and reviewers can trace exactly why an agent was activated, why a tool was gated, or why a budget action was triggered.

**Policy profiles** -- session behavior resolves from a typed policy profile (`v1-safe` by default). Override with a repo-local `.opencode/supervisor-policy.json` to customize role aliases, MCP provider patterns, budget thresholds, and approval gates. Invalid config falls back to safe defaults with diagnostics.

**MCP gating** -- external tools (Sentry, GitHub, Shortcut) only activate when the user explicitly mentions them in the prompt. No ambient tool calls. If you don't mention `sentry`, no Sentry API calls happen.

---

## Roadmap

**Available now (v0.3.0):**
- Multi-role deliberative orchestration with heartbeat phases
- Single-role delegation with wave-based execution and provenance
- MCP gating, budget governance, reason codes, policy profiles
- 10 specialized agent personas

**Coming next:**
- One-command install (`npx` installer for zero-friction setup)
- Governed parallel execution with audit trails (supervisor mode)
- Async delegation with governance-aware background agents
- Contract freeze and backward-compatibility guarantees

The supervisor foundation -- work units, lane planning, durable state store, scheduler, merge policy, and evidence packets -- is already shipped and tested. The next milestone is wiring it into a user-invokable runtime.

---

## Documentation

| Area | Link |
|---|---|
| Getting started | [Install](./docs/getting-started/install.md) / [Quick start](./docs/getting-started/quickstart.md) |
| Configuration | [Customization](./docs/guides/customization.md) / [Policy profiles](./docs/guides/policy-profiles.md) |
| Architecture | [Overview](./docs/overview/architecture.md) / [Product positioning](./docs/overview/product-positioning.md) |
| Troubleshooting | [Local sync and agents](./docs/guides/local-sync-and-agents.md) |
| Testing | [Testing guide](./docs/testing/testing.md) |
| Full docs index | [docs/README.md](./docs/README.md) |

---

## Contributing

Contributions are welcome. The project uses TypeScript with Vitest for testing.

```bash
npm install
npm test
```

197 tests, CI on every PR. See the [testing guide](./docs/testing/testing.md) for details on the test structure and conventions.

## Contact

- Website: [marcel.tuinstra.dev](https://marcel.tuinstra.dev)
- Email: marcel@tuinstra.dev

## License

MIT. See [LICENSE](./LICENSE) for details.

---

<sub>This is an independent community plugin for OpenCode and is not affiliated with or endorsed by the OpenCode project.</sub>
