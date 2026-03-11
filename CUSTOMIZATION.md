# Customization Guide

This guide shows how to tweak MCP checks and create or adapt agent personas.

## 1) Customize MCP provider checks

Files: `plugins/agent-conversations/constants.ts` and `plugins/agent-conversations/mcp.ts`

Main places to edit:

- `BUILTIN_PROVIDER_PATTERNS` (detect provider names from user text)
- `providerFromToolName()` (map MCP tool name prefix to provider key)

Example for Jira:

```ts
const BUILTIN_PROVIDER_PATTERNS = [
  // existing providers...
  {
    key: "jira",
    regex: /\b(jira|atlassian)\b/i,
    hint: "Jira MCP (issues, boards, sprints)",
    toolPrefix: "jira_"
  }
];

const providerFromToolName = (tool: string): string | null => {
  // existing mappings...
  if (tool.startsWith("jira_")) {
    return "jira";
  }
  return null;
};
```

## 2) Tune MCP strictness and call limits

Files: `plugins/agent-conversations/constants.ts`, `plugins/agent-conversations/mcp.ts`, and `plugins/agent-conversations/index.ts`

Useful knobs:

- Per-turn call cap in `tool.execute.before` via `const cap = policy.allowDeepMcp ? 6 : 2;`
- Deep-investigation trigger in `DEEP_MCP_REGEX`
- "all named providers must be touched" flow in `tool.execute.before` and `getMissingProviders()`

If you want a softer policy, you can remove the temporary block that forces checking each named provider before reusing one provider.

## 3) Add or rename discussion roles

Files: `plugins/agent-conversations/types.ts`, `plugins/agent-conversations/constants.ts`, `plugins/agent-conversations/roles.ts`, `plugins/agent-conversations/intent.ts`, and `plugins/agent-conversations/output.ts`

When introducing a new role, update all of the following:

- `SUPPORTED_ROLES`
- `type Role`
- `ROLE_ALIASES`
- `INTENT_ROLE_WEIGHTS` entries
- Target/count objects in `buildTurnTargets()` and `normalizeThreadOutput()`

This keeps role parsing, weighting, and output normalization in sync.

## 4) Create your own agent personas

Agent files are plain markdown with optional frontmatter.

Where agents live:

- Global: `~/.config/opencode/agents/`
- Project-local: `.opencode/agents/`

Filename defines mention handle:

- `cto.md` -> `@cto`
- `security-auditor.md` -> `@security-auditor`

Starter template:

```md
---
description: Reliability engineer focused on incidents and SLOs
mode: subagent
tools:
  write: false
  edit: false
  bash: false
---
You focus on incident triage, risk reduction, and concrete follow-up actions.
Prefer short diagnostics, explicit tradeoffs, and practical next steps.
```

## 5) Practical tips

- Keep provider policy in plugin code, not in each agent prompt.
- Keep agent prompts role-specific and concise.
- Prefer adding aliases in `ROLE_ALIASES` so users can mention natural names.
- After changes, run a quick prompt with multi-mentions and provider names to verify behavior.
