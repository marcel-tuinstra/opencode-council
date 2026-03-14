# Quick Start

## Install

Follow [`install.md`](./install.md).

## Verify

Use a prompt like:

```text
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan.

@fe @ux Review the landing page interaction flow and tighten the responsive layout.
```

Expected behavior:

- multi-role prompts produce a numbered thread
- single-role prompts stay direct unless delegation is needed
- MCP usage stays mention-gated by provider name

## Next steps

- Customize roles and providers: [`../guides/customization.md`](../guides/customization.md)
- Review policy defaults: [`../guides/policy-profiles.md`](../guides/policy-profiles.md)
- Explore the supervisor foundation: [`../supervisor/work-units.md`](../supervisor/work-units.md)
