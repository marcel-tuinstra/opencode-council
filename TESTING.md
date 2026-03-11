# Testing Matrix

This project is primarily behavior-driven. The fastest way to validate changes is to run targeted prompts and confirm parser, policy, and output behavior.

## Automated tests

```bash
npm install
npm test
```

The GitHub Actions workflow in `.github/workflows/ci.yml` runs these tests on Node 22 and 24 for every push and pull request.

## Role Parsing

- `@cto @dev` should detect both roles and produce thread mode.
- Mentions inside code (inline or fenced) should be ignored.
- File references like `@INSTALL.md` should be ignored.
- Marker payload (`<<AGENT_CONVERSATIONS:CTO,DEV>>`) should restore roles.

## Intent and Turn Planning

- Backend prompts should favor `CTO` and `DEV` airtime.
- Marketing prompts should favor `MARKETING` and `CEO` airtime.
- Single-role prompts should remain direct prose.
- Multi-role prompts should start and end with the lead role.

## MCP Policy

- No provider mention -> MCP blocked with a clear warning.
- Mentioned provider allowed if installed.
- Unmentioned provider blocked.
- Multi-provider fairness enforced (all named providers touched).
- Call cap blocks extra MCP calls unless deep mode phrase is present.

## Output Normalization

- Thread lines normalized to `[n] ROLE: message`.
- Non-role lines are ignored for thread reconstruction.
- Over-quota role lines are trimmed to target count.
- Missing-provider notice appears only when fairness still unmet.

## Manual Prompt Set

Use these prompts after restarting OpenCode:

```text
@cto @dev @pm Investigate API latency regressions from this week and produce a fix plan.
```

```text
@dev This week we saw fresh production incidents; investigate with sentry and github and propose a mitigation.
```

```text
@ceo @marketing @pm Plan a launch narrative and timeline for a six-week release.
```

```text
@research Compare approaches and list evidence with confidence and open questions.
```
