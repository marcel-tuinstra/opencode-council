# Install

## One-command install

With Node.js:

```bash
npx opencode-council init
```

Without Node.js:

```bash
curl -fsSL https://raw.githubusercontent.com/marcel-tuinstra/opencode-council/main/install.sh | bash
```

Restart OpenCode after installing.

## Managing your install

```bash
npx opencode-council refresh     # Update to latest version
npx opencode-council verify      # Check install health
npx opencode-council uninstall   # Clean removal
```

Use `--dry-run` with any command to see what would happen without making changes. Use `--backup` with `refresh` to create `.bak` copies before overwriting.

## Manual install

If you prefer to copy files yourself:

```bash
git clone https://github.com/marcel-tuinstra/opencode-council.git
cd opencode-council

mkdir -p ~/.opencode/plugins ~/.opencode/agents
cp plugins/orchestration-workflows.ts ~/.opencode/plugins/
cp -R plugins/orchestration-workflows ~/.opencode/plugins/
cp agents/*.md ~/.opencode/agents/
```

No `opencode.json` edits required.

## Quick test

```text
@cto @dev @pm Investigate why API latency regressed this week and propose a fix plan.

@fe @ux Review the landing page interaction flow and tighten the responsive layout.
```

## Agent load checklist

If the plugin works but `@fe`, `@be`, or `@ux` do not appear in tag suggestions:

- Confirm plugin files exist in `~/.opencode/plugins/`
- Confirm agent profile files exist in `~/.opencode/agents/`
- Restart OpenCode after syncing both plugin and agent files
- Try a smoke prompt like `@fe @ux Review the landing page interaction flow.`
- If role parsing works but suggestions do not, re-copy agent markdown files and restart

## Troubleshooting

```bash
ORCHESTRATION_WORKFLOWS_DEBUG=1 opencode web
```

This enables plugin debug logging to stderr. Look for lines prefixed with `[orchestration-workflows]`.

If the debug output shows `FE`, `BE`, or `UX` in role parsing but the picker still hides them, the most likely problem is a missing or stale `~/.opencode/agents/*.md` sync. Run `npx opencode-council verify` to check.
