# Product Positioning

**AI agents that debate before they act.**

OpenCode Council brings deliberative multi-agent discussion to [OpenCode](https://github.com/sst/opencode). Instead of task delegation where an orchestrator tells agents what to do, this plugin creates structured discussions where specialized roles frame problems, challenge assumptions, and synthesize recommendations.

## What makes this different

Most multi-agent approaches use a **delegation model**: an orchestrator decides what needs to happen, assigns tasks to specialist agents, and collects results. This works well for straightforward execution but is less suited when the problem requires judgment, trade-off analysis, or cross-functional reasoning.

This plugin uses a **deliberation model**. When you mention multiple roles, they engage in structured discussion through heartbeat phases (Frame, Challenge, Synthesize). The output is not just a task completed -- it's a recommendation with visible reasoning from multiple expert perspectives.

## Available now (v0.5.0)

- One-command install: `npx opencode-council init`
- Mention-driven role orchestration: `@cto @dev @pm [prompt]` activates exactly the agents you need
- Heartbeat phases for structured reasoning in multi-role discussions
- Threaded `[n] ROLE: message` output format
- Delegation mode: `@cto delegate [prompt]` for lead-first wave-based coordination
- MCP gating: tools only activate when explicitly mentioned
- Budget governance with reason codes and policy profiles
- Stable runtime compatibility and deprecation policy for the `v0.5.x` line
- 10 specialized agents: CTO, CEO, PO, PM, DEV, FE, BE, UX, Research, Marketing
- 197 passing tests with CI on every PR

## Coming next

- Governed parallel execution with audit trails (supervisor mode)
- Async delegation with governance-aware background agents
- Continued iteration on the experimental supervisor surface before it is stabilized in a later release

## Target user

The plugin is built for developers and tech leads working on code that matters -- where AI agents should think before they act, where process quality matters as much as output speed, and where audit trails and governance provide accountability rather than just friction.
