# Compatibility and Deprecations

This document is the single source of truth for compatibility promises, deprecation timing, and removal rules in `opencode-council` for `0.5.x`.

Use it when deciding whether a change is safe for a patch or minor release in the `0.5` line.

## Stability classes

### Stable root

The package root export, `opencode-council`, is frozen for `0.5.x`.

Runtime exports:

- `AgentConversations`
- `SUPPORTED_ROLES`

Documented root types:

- `Role`
- `Intent`
- `DelegationMode`
- `DelegationRequest`
- `DelegationWave`
- `DelegationPlan`
- `SessionPolicy`

Rules for `0.5.x`:

- Do not add new runtime exports to the root barrel.
- Do not remove or rename the documented root exports.
- Do not move supervisor helpers onto the root barrel.
- Type-only fixes that preserve existing meaning are acceptable; breaking type reshapes are not.

### Experimental supervisor

The `opencode-council/supervisor` entry point remains explicitly experimental through at least all `0.5.x` releases.

Rules for `0.5.x`:

- Supervisor helpers may grow and evolve behind the experimental entry point.
- Supervisor exports must stay off the stable root barrel.
- Breaking supervisor API changes should still be called out in release notes, even though they are not covered by the stable root guarantee.

### Internal

Anything not exported from the package entry points or not documented here is internal.

Internal code may change at any time, including:

- module layout under `plugins/orchestration-workflows/`
- implementation details behind CLI commands
- internal helper types and private config normalization details

## Semver expectations for `0.5.x`

Treat `0.5.x` as a compatibility line with a frozen public operator contract.

- Patch releases may fix bugs, improve docs, tighten tests, and add internal refactors.
- Patch releases must preserve the stable root exports, stable CLI command names, and documented budget/policy contract.
- Minor or patch releases in `0.5.x` may add supervisor capabilities under `opencode-council/supervisor` because that surface is experimental.
- Any change that would break the stable root, CLI contract, or documented config contract must wait for a new minor line after `0.5.x` and must be deprecated first when possible.

## Deprecation rules

For surfaces marked stable in this document:

- Announce the deprecation in this document and in release notes before removal.
- Document the recommended replacement and the first release where the old name or behavior is considered deprecated.
- Keep the existing behavior working for the rest of the `0.5.x` line.
- Prefer additive replacements over silent behavior changes.
- Do not reuse a deprecated name for a different meaning within `0.5.x`.

Support window for deprecated stable surfaces:

- The minimum support window is the rest of the current `0.5.x` line after the deprecation lands.
- In practice, that means any stable surface deprecated in `0.5.x` remains supported until the next minor line at the earliest.
- If a safe additive replacement exists, ship it before or alongside the deprecation notice.

Removal timing:

- Stable root exports: no removals during `0.5.x`.
- Stable CLI command names/intents: no removals or renames during `0.5.x`.
- Documented budget env vars and documented policy keys: no removals or renames during `0.5.x`.
- Experimental supervisor APIs: may change during `0.5.x`, but changes should be documented.

Removal process:

1. Mark the surface deprecated in this document and in release notes.
2. Point operators to the supported replacement and migration path.
3. Keep the deprecated surface working for the full support window above.
4. Remove it only in a new minor line after `0.5.x`, and call out the removal in upgrade notes.

## CLI compatibility guarantees

The `opencode-council` CLI command name is stable for `0.5.x`.

The following command names and high-level intents are stable for `0.5.x`:

- `init` - install plugin and agent files into `~/.opencode`
- `refresh` - reinstall from source and prune stale managed files
- `verify` - compare installed files against the package source
- `uninstall` - remove installed plugin and agent files from `~/.opencode`
- `help` - show CLI help and usage

Compatibility rules:

- Keep these command names available for all `0.5.x` releases.
- Do not silently swap the user-facing intent of a stable command.
- Additive flags or extra output are acceptable if existing workflows still work.

## Budget env var guarantees

The following documented environment variables are stable for `0.5.x`:

- `ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_RUN_TOKENS`
- `ORCHESTRATION_WORKFLOWS_BUDGET_HARD_RUN_TOKENS`
- `ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_STEP_TOKENS`
- `ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS`
- `ORCHESTRATION_WORKFLOWS_BUDGET_TRUNCATE_TOKENS`
- `ORCHESTRATION_WORKFLOWS_BUDGET_COST_PER_1K_USD`
- `ORCHESTRATION_WORKFLOWS_EXECUTE_STEP_TOKEN_COST`

Precedence for live runtime budget values is stable for `0.5.x`:

1. environment variables
2. `.opencode/supervisor-policy.json`
3. built-in defaults

Invalid environment values fail safe by falling back to the repo policy value for that field.

## Supervisor policy file guarantees

The standard repo-local policy file path is stable for `0.5.x`:

- `.opencode/supervisor-policy.json`

The documented top-level policy sections are stable for `0.5.x`:

- `profile`
- `roleAliases`
- `providers.patterns`
- `limits`
- `approvalGates`
- `budget.runtime`
- `budget.governance`
- `routing`
- `execution`
- `protectedPaths`
- `governance.checkpoints`
- `compaction`

Schema rules for `0.5.x`:

- Existing documented keys keep their meaning.
- Existing documented keys are not renamed or removed.
- Unknown keys must be ignored rather than crashing policy load.
- Invalid values must fail safe to defaults for the affected field and produce diagnostics.
- Additive keys are acceptable if they do not break older policy files or the fail-safe loader behavior.

## Operator guidance

When reviewing a `0.5.x` change, ask:

- Does this change alter the stable root export list?
- Does this change move a supervisor helper onto the root barrel?
- Does this change rename or remove a stable CLI command?
- Does this change rename or remove a documented budget env var or policy key?
- If config is invalid, does the runtime still fall back safely?

If any answer is yes, the change is outside the `0.5.x` compatibility policy unless it stays behind the experimental supervisor entry point.
