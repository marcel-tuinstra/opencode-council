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

## Post-merge local refresh

After merging changes to `main`, refresh both runtime and agent files locally:

```bash
cp plugins/orchestration-workflows.ts ~/.opencode/plugins/orchestration-workflows.ts
cp -R plugins/orchestration-workflows ~/.opencode/plugins/orchestration-workflows
cp agents/*.md ~/.opencode/agents/
```

Then restart OpenCode and re-run the verify prompts above.

## Next steps

- Customize roles and providers: [`../guides/customization.md`](../guides/customization.md)
- Run the specialist role sanity script: [`../testing/role-sanity-script.md`](../testing/role-sanity-script.md)
- Review local sync troubleshooting: [`../guides/local-sync-and-agents.md`](../guides/local-sync-and-agents.md)
- Review policy defaults: [`../guides/policy-profiles.md`](../guides/policy-profiles.md)
- Explore the supervisor foundation: [`../supervisor/work-units.md`](../supervisor/work-units.md)
