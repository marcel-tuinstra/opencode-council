# OpenCode Council

[![CI](https://github.com/marcel-tuinstra/opencode-council/actions/workflows/ci.yml/badge.svg)](https://github.com/marcel-tuinstra/opencode-council/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)](https://github.com/marcel-tuinstra/opencode-council/releases)
[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-green.svg)](https://github.com/sst/opencode)

**AI agents that debate before they act.**

Multi-agent orchestration for [OpenCode](https://github.com/sst/opencode) where specialized roles deliberate, challenge assumptions, and synthesize recommendations -- instead of blindly executing tasks.

## Quick Start

```bash
npx opencode-council init
```

Or without Node.js:

```bash
curl -fsSL https://raw.githubusercontent.com/marcel-tuinstra/opencode-council/main/install.sh | bash
```

Restart OpenCode, then try:

```
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan using sentry and github.
```

## What You Get

| Capability | What it does |
|---|---|
| Mention-driven roles | `@cto @dev @pm` activates the agents you need |
| Heartbeat phases | Frame, Challenge, Synthesize -- structured reasoning for 3+ roles |
| Delegation mode | `@cto delegate [prompt]` -- lead agent plans and coordinates specialists |
| MCP gating | Sentry, GitHub, Shortcut only activate when explicitly mentioned |
| Governance | Budget limits, reason codes, and [policy profiles](./docs/guides/policy-profiles.md) |
| 10 agents | CTO, CEO, PO, PM, DEV, FE, BE, UX, Research, Marketing ([personas](./agents/)) |

## Stable Contract

Starting in `v0.5.0`, the package root intentionally exposes a small stable runtime contract for consumers that build on the live orchestration plugin:

- `AgentConversations`
- `SUPPORTED_ROLES`
- `Role`
- `Intent`
- `DelegationMode`
- `DelegationRequest`
- `DelegationWave`
- `DelegationPlan`
- `SessionPolicy`

Supervisor helpers and other pre-`v0.6.0` orchestration internals remain available under an experimental supervisor entry point instead of the root barrel. This keeps the runtime contract stable while supervisor APIs continue to evolve.

## Example

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

CTO frames the problem, DEV and PM challenge with their expertise, CTO synthesizes. That's the heartbeat model.

## Manage Your Install

```bash
npx opencode-council refresh     # Update to latest version
npx opencode-council verify      # Check install health
npx opencode-council uninstall   # Clean removal
```

## Roadmap

**Now (v0.4.0):** Deliberative orchestration, delegation mode, MCP gating, budget governance, 10 agent personas, one-command install.

**Next:** Governed parallel execution (supervisor mode), async delegation with governance, contract freeze.

## Documentation

| | |
|---|---|
| Getting started | [Install](./docs/getting-started/install.md) / [Quick start](./docs/getting-started/quickstart.md) |
| Upgrading | [Upgrade to v0.5.0](./docs/guides/upgrading-to-0.5.0.md) |
| Configuration | [Customization](./docs/guides/customization.md) / [Policy profiles](./docs/guides/policy-profiles.md) |
| Architecture | [Overview](./docs/overview/architecture.md) / [Positioning](./docs/overview/product-positioning.md) |
| Troubleshooting | [Local sync and agents](./docs/guides/local-sync-and-agents.md) |
| Testing | [Guide](./docs/testing/testing.md) / [Role sanity](./docs/testing/role-sanity-script.md) |

## Contributing

```bash
npm install && npm test
```

197 tests, CI on every PR. See the [testing guide](./docs/testing/testing.md) for conventions.

## Contact

[marcel.tuinstra.dev](https://marcel.tuinstra.dev) / marcel@tuinstra.dev

## License

MIT. See [LICENSE](./LICENSE).

---

<sub>Independent community plugin for OpenCode. Not affiliated with or endorsed by the OpenCode project.</sub>
