# Local Sync And Agent Visibility

Use this guide when merged plugin changes are present on `main` but local behavior still looks stale.

## Source of truth

- Runtime plugin files live in `~/.opencode/plugins/`
- Agent profile files live in `~/.opencode/agents/`
- Mention parsing can work before tag suggestions update, so sync both locations

## Standard refresh flow

```bash
mkdir -p ~/.opencode/plugins ~/.opencode/agents
cp plugins/orchestration-workflows.ts ~/.opencode/plugins/orchestration-workflows.ts
cp -R plugins/orchestration-workflows ~/.opencode/plugins/orchestration-workflows
cp agents/*.md ~/.opencode/agents/
```

Then restart OpenCode.

## Smoke prompts

Run these after restart:

```text
@dev Implement a small full-stack fix and explain the next verification step.
```

```text
@be Investigate an API latency regression and propose a backend fix plan.
```

```text
@fe @ux Review the onboarding flow and tighten the responsive layout.
```

Expected results:

- `@dev` remains the default full-stack implementation role
- `@be` appears as a specialist backend role
- `@fe` and `@ux` both appear and produce threaded specialist behavior

## Diagnosis matrix

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `@fe` works in prompts but not in suggestions | agent files missing or stale | re-copy `agents/*.md`, restart |
| `@fe` and `@be` are absent everywhere | plugin files not refreshed | re-copy plugin runtime and restart |
| `@dev` works but `@fe/@be/@ux` do not | runtime updated but agent profiles missing | sync `~/.opencode/agents/` |
| prompts thread but old routing behavior remains | stale plugin process | restart OpenCode after sync |

## Practical note

Keep `DEV` as the generalist default. Use `FE`, `BE`, and `UX` only when you want specialist routing or a stronger boundary test.
