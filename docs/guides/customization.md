# Customization Guide

This guide shows how to tweak supervisor policy config, MCP checks, and agent personas.

## 0) Use a repo-local supervisor policy file

Preferred file: `.opencode/supervisor-policy.json`

The runtime now resolves a typed `v1-safe` profile first, then applies repo-local overrides from this file when present.

Example:

```json
{
  "profile": "v1-safe",
  "roleAliases": {
    "engineer": "DEV"
  },
  "providers": {
    "patterns": [
      {
        "key": "github",
        "pattern": "\\b(github|github\\.com|gh)\\b",
        "hint": "GitHub MCP (PRs, commits, code context)",
        "toolPrefix": "github_"
      }
    ]
  },
  "limits": {
    "lanes": {
      "activeCapsByTier": {
        "small-high-risk": 2,
        "medium-moderate-risk": 3,
        "large-mature": 4
      },
      "maxConcurrentCodeChanges": 1,
      "maxOpenPullRequests": 1
    },
    "worktrees": {
      "maxActive": 1
    },
    "sessions": {
      "maxPerWorktree": 1
    },
    "mcp": {
      "defaultCallCap": 2,
      "deepCallCap": 6
    }
  },
  "approvalGates": {
    "escalationMode": "ask-first",
    "mergeMode": "manual",
    "allowServiceCriticalAutoMerge": false
  },
  "budget": {
    "runtime": {
      "softRunTokens": 6400,
      "hardRunTokens": 8400,
      "softStepTokens": 2800,
      "hardStepTokens": 4000,
      "truncateAtTokens": 1400,
      "costPer1kTokensUsd": 0.002,
      "stepExecutionTokenCost": 120
    },
    "governance": {
      "warningThresholdPercents": [80, 100, 120],
      "escalationThresholdPercent": 120,
      "hardStopEnabled": false,
      "hardStopThresholdPercent": 131.25
    }
  },
  "compaction": {
    "backend": {
      "triggerTokens": 700,
      "targetTokens": 420
    }
  }
}
```

If the file is missing, the plugin keeps the built-in profile. If a field is invalid, the loader records diagnostics and falls back safely for that field.

## 1) Customize MCP provider checks

Files: `plugins/orchestration-workflows/supervisor-config.ts` and `plugins/orchestration-workflows/mcp.ts`

Main places to edit:

- `providers.patterns` in `.opencode/supervisor-policy.json` (detect provider names from user text)
- `providerFromToolName()` (map MCP tool name prefix to provider key)

Example for Jira:

```json
{
  "providers": {
    "patterns": [
      {
        "key": "jira",
        "pattern": "\\b(jira|atlassian)\\b",
        "hint": "Jira MCP (issues, boards, sprints)",
        "toolPrefix": "jira_"
      }
    ]
  }
}
```

```ts
const providerFromToolName = (tool: string): string | null => {
  // existing mappings...
  if (tool.startsWith("jira_")) {
    return "jira";
  }
  return null;
};
```

## 2) Tune MCP strictness and call limits

Files: `.opencode/supervisor-policy.json`, `plugins/orchestration-workflows/mcp.ts`, and `plugins/orchestration-workflows/index.ts`

Useful knobs:

- Per-turn call caps via `limits.mcp.defaultCallCap` and `limits.mcp.deepCallCap`
- Deep-investigation trigger in `DEEP_MCP_REGEX`
- "all named providers must be touched" flow in `tool.execute.before` and `getMissingProviders()`

If you want a softer policy, you can remove the temporary block that forces checking each named provider before reusing one provider.

## 3) Add or rename discussion roles

Files: `plugins/orchestration-workflows/types.ts`, `.opencode/supervisor-policy.json`, `plugins/orchestration-workflows/roles.ts`, `plugins/orchestration-workflows/intent.ts`, and `plugins/orchestration-workflows/output.ts`

When introducing a new role, update all of the following:

- `SUPPORTED_ROLES`
- `type Role`
- `roleAliases`
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
- Prefer adding aliases in `roleAliases` so users can mention natural names.
- Supervisor policy defaults now live in `POLICY_PROFILES.md`; keep repo-specific overrides aligned with that contract.
- Budget environment variables in `plugins/orchestration-workflows/budget.ts` still override the repo policy file at runtime.
- After changes, run a quick prompt with multi-mentions and provider names to verify behavior.
