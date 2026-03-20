# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-03-21

### Added

- **Supervisor execution foundation**: child-session lifecycle with 10-state model, 21 valid transitions, failure classification, and retry policy
- **Supervisor event catalog**: 21 structured events (11 MVP) with correlation context and severity levels
- **DelegationPlan→Execution bridge**: reconciles runtime DelegationPlan with supervisor DelegationPlan for execution
- **Automatic retry engine**: failure classification, exponential backoff, retry budget per lane
- **Event emission**: 12 lifecycle event emission points across session lifecycle and execution workflow
- **Child-session records**: persisted in durable state store (schema v2) alongside supervisor session records

### Changed

- **Async migration**: entire supervisor pipeline (state store, session lifecycle, worktree provisioner, scheduler, execution workflow) converted from synchronous to async/await
- **Schema version**: durable state store bumped from v1 to v2 (automatic migration)

## [0.5.0] - Planned

### Added

- Upgrade guidance for the `v0.5.0` barrel reorganization in `docs/guides/upgrading-to-0.5.0.md`
- Explicit documentation for the stable runtime contract versus the experimental supervisor contract
- Compatibility notes covering stable CLI verbs plus additive-only env var and policy-key changes for `v0.5.x`

### Changed

- The package root is now frozen to the minimal stable runtime contract: `AgentConversations`, `SUPPORTED_ROLES`, `Role`, `Intent`, `DelegationMode`, `DelegationRequest`, `DelegationWave`, `DelegationPlan`, and `SessionPolicy`
- Supervisor helpers and other non-runtime root-barrel exports move to the experimental supervisor entry point, `opencode-council/supervisor`
- `v0.5.0` formalizes the contract split so the live runtime can remain stable while supervisor APIs continue iterating toward `v0.6.0`

### Upgrade Notes

- If you import only the live runtime contract from `opencode-council`, no migration is required
- If you import supervisor helpers, move those imports from `opencode-council` to `opencode-council/supervisor`
- Existing CLI commands keep working across `v0.5.x`
- Existing documented env vars and policy keys stay valid across `v0.5.x`; new ones are additive
- See `docs/guides/upgrading-to-0.5.0.md` for import migration examples

## [0.4.0] - 2026-03-19

### Added

- **One-command install**: `npx opencode-council init` installs plugin + all 10 agents in one command
- **Shell installer**: `curl -fsSL .../install.sh | bash` for non-Node users
- **Install management**: `refresh`, `verify`, and `uninstall` commands
- **Config detection**: existing install detection, supervisor-policy.json preservation, dry-run mode, backup support

### Changed

- **Renamed to OpenCode Council**: repo, npm package, and all references updated from `opencode-orchestration-workflows` to `opencode-council`
- Package published to npm as `opencode-council` (no longer `private: true`)
- README rewritten as compact product page with one-command install

## [0.3.0] - 2026-03-18

### Added

- **Delegation mode**: `DelegationPlan` type for modeling explicit agent-led delegation as a first-class runtime object
- **Lead-first orchestration**: system instruction injection when delegation mode is active, telling the lead agent to frame before delegating
- **Wave-based execution**: delegation plans organize work into dependency-ordered waves with max-parallel constraints
- **Provenance rendering**: structured `[Supervisor] delegation.launch` annotations and wave provenance in output
- **Delegation detection**: parse `@cto delegate [prompt]` and similar patterns to activate delegation mode
- **Max-parallel parsing**: extract `max parallel agents N` from user prompts
- **New reason codes**: delegation-specific reason codes for routing and audit

### Changed

- Plugin hooks now route through delegation plan when active (message transform, system transform, text complete)
- Output rewriting converts generic orchestrator narration into structured delegation annotations
- Control leakage stripping now removes `ctrl+x down view subagents` hints from delegated transcripts

## [0.2.0] - 2026-03-14

### Added

- Supervisor foundation: typed contracts and helpers for work units, lane planning, lane lifecycle, durable state store, scheduler/dispatch loop, worktree provisioner, session runtime adapter, turn ownership, review-ready packets, merge policy, budget governance, observability snapshots, ad-hoc run history
- Policy profiles with `v1-safe` defaults and repo-local override support
- Reason-code catalog for routing, turn assignment, budget actions, compaction, approval pauses, and MCP gating
- Governance policy engine with accept/repair/escalate/block routing
- Golden trace scenarios for release-readiness validation
- Alpha end-to-end validation harness against epic-323
- Pilot KPI baseline and epic pilot documentation
- Operations runbook and recovery/repair playbooks

## [0.1.0] - 2026-03-01

### Added

- Initial release: mention-driven role orchestration plugin for OpenCode
- 10 specialized agents: CTO, CEO, PO, PM, DEV, FE, BE, UX, Research, Marketing
- Heartbeat phases (Frame, Challenge, Synthesize) for 3+ role discussions
- Threaded `[n] ROLE: message` output normalization
- MCP gating based on explicit provider mentions
- Budget governance with token tracking and compaction triggers
- Runtime-visible budget checkpoints and handoff reminders
- Intent detection and weighted turn targeting

[0.4.0]: https://github.com/marcel-tuinstra/opencode-council/releases/tag/v0.4.0
[0.5.0]: https://github.com/marcel-tuinstra/opencode-council/releases/tag/v0.5.0
[0.6.0]: https://github.com/marcel-tuinstra/opencode-council/releases/tag/v0.6.0
[0.3.0]: https://github.com/marcel-tuinstra/opencode-council/releases/tag/v0.3.0
[0.2.0]: https://github.com/marcel-tuinstra/opencode-council/releases/tag/v0.2.0
[0.1.0]: https://github.com/marcel-tuinstra/opencode-council/releases/tag/v0.1.0
