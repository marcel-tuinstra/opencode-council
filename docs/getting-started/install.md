# Quick Install

```bash
mkdir -p ~/.opencode/plugins ~/.opencode/agents
cp plugins/orchestration-workflows.ts ~/.opencode/plugins/orchestration-workflows.ts
cp -R plugins/orchestration-workflows ~/.opencode/plugins/orchestration-workflows
cp agents/*.md ~/.opencode/agents/
```

Restart OpenCode.

Quick test:

```text
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan.

@fe @ux Review the landing page interaction flow and tighten the responsive layout.
```

No `opencode.json` edits required.

## Agent load checklist

Use this checklist if the plugin works but `@fe`, `@be`, or `@ux` do not appear in tag suggestions.

- Confirm plugin files exist in `~/.opencode/plugins/`.
- Confirm agent profile files exist in `~/.opencode/agents/`.
- Restart OpenCode after syncing both plugin and agent files.
- Try a smoke prompt like `@fe @ux Review the landing page interaction flow.`
- If role parsing works but suggestions do not, re-copy the agent markdown files and restart again.

Notes:

- Single mention (`@cto`) -> normal prose answer.
- Multi mention -> numbered thread (`[n] ROLE: message`).
- MCP calls are mention-gated (`sentry`, `github`, `shortcut`, `nuxt`).
- File references like `@INSTALL.md` are ignored and do not trigger agent mode.

Troubleshooting:

```bash
ORCHESTRATION_WORKFLOWS_DEBUG=1 opencode web
```

This enables plugin debug logging to stderr. Look for lines prefixed with `[orchestration-workflows]`.

If the debug output shows `FE`, `BE`, or `UX` in role parsing but the picker still hides them, the most likely problem is a missing or stale `~/.opencode/agents/*.md` sync.
