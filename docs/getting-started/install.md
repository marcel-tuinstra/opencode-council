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

## Compatibility notes for `v0.5.x`

- The canonical compatibility and deprecation policy lives in [`../guides/compatibility-and-deprecations.md`](../guides/compatibility-and-deprecations.md).
- Root package exports and CLI verbs are covered there for `v0.5.x`.
- The supervisor entry point, `opencode-council/supervisor`, remains experimental.

## Managing your install

```bash
npx opencode-council refresh     # Update to latest version
npx opencode-council verify      # Check install health
npx opencode-council uninstall   # Clean removal
```

Use `--dry-run` with any command to see what would happen without making changes. Use `--backup` with `refresh` to create `.bak` copies before overwriting.

If you already use `init`, `refresh`, `verify`, or `uninstall`, you do not need new command names for `v0.5.x`.

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

### Debug mode

```bash
ORCHESTRATION_WORKFLOWS_DEBUG=1 opencode web
```

This enables plugin debug logging to stderr. `1`, `true`, `yes`, and `on` all enable it. Look for lines prefixed with `[orchestration-workflows]`.

For debug env var and policy compatibility expectations, use the canonical policy doc: [`../guides/compatibility-and-deprecations.md`](../guides/compatibility-and-deprecations.md).

Useful events include:

- `supervisor.policy.invalid` or `supervisor.policy.load_failed` when `.opencode/supervisor-policy.json` is invalid or unreadable
- `budget.recorded` and `budget.baseline` when budget behavior needs review
- prompt and message transform events when role parsing or delegation looks wrong

### Supervisor notes in output

When the runtime adds operator-facing notes, it uses a stable human-readable format:

- `[Supervisor] route.*` for route selection
- `[Supervisor] assignment.*` for turn ownership or assignment decisions
- `[Supervisor] delegation.launch` and `[Supervisor] provenance.*` when delegation expanded the thread
- `[Supervisor] budget.*`, `approval.*`, or `blocked.*` when a guardrail changed or paused behavior

Treat the explanation text as the primary signal. The reason code is a short audit label that helps operators scan logs and transcripts.

Common provenance lines:

- `provenance.requested-by-user` means the user explicitly asked for those roles
- `provenance.delegated-wave` means a lead role delegated downstream work
- `provenance.orchestrator-additions` means the orchestrator added supporting roles
- `provenance.max-parallel` records the applied parallelism cap

### Common scenarios

| Symptom | Likely cause | What to check |
| --- | --- | --- |
| `@fe`, `@be`, or `@ux` parse in debug logs but do not appear in suggestions | stale or missing agent markdown sync | re-copy `agents/*.md`, restart OpenCode, then run `npx opencode-council verify` |
| policy changes in `.opencode/supervisor-policy.json` do not seem to apply | file is invalid or unreadable, so the runtime failed safe | run with `ORCHESTRATION_WORKFLOWS_DEBUG=1` and look for `supervisor.policy.invalid` or `supervisor.policy.load_failed` |
| budget thresholds do not match the repo policy file | shell environment overrides are winning | check for `ORCHESTRATION_WORKFLOWS_BUDGET_*` or `ORCHESTRATION_WORKFLOWS_EXECUTE_STEP_TOKEN_COST` in the current shell |
| response ends with `blocked.missing-mcp-provider` or `blocked.mcp-access` | required MCP coverage or access is missing | mention the needed provider explicitly and verify the current policy allows that MCP action |
| response ends with `budget.output-compact`, `budget.output-truncate`, or `budget.output-halt` | budget governance intervened | retry with a narrower scope, fewer roles, or an explicit budget override when policy allows it |

If the debug output shows `FE`, `BE`, or `UX` in role parsing but the picker still hides them, the most likely problem is a missing or stale `~/.opencode/agents/*.md` sync. Run `npx opencode-council verify` to check.
