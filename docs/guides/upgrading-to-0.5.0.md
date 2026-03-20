# Upgrading to v0.5.0

`v0.5.0` freezes the minimal stable runtime contract at the package root and moves supervisor-oriented helpers behind an experimental entry point.

## What changed

- The package root now exposes only the stable runtime contract:
  - `AgentConversations`
  - `SUPPORTED_ROLES`
  - `Role`
  - `Intent`
  - `DelegationMode`
  - `DelegationRequest`
  - `DelegationWave`
  - `DelegationPlan`
  - `SessionPolicy`
- Supervisor planning, routing, lifecycle, state-store, review, and other helper exports move off the root barrel.
- Those supervisor APIs now live under the experimental supervisor entry point: `opencode-council/supervisor`.
- Compatibility, deprecation, and removal rules now live in the canonical policy doc: [`compatibility-and-deprecations.md`](./compatibility-and-deprecations.md).

## Compatibility policy for `v0.5.x`

See the canonical compatibility and deprecation policy: [`compatibility-and-deprecations.md`](./compatibility-and-deprecations.md).

## If you only use the live runtime

No import changes are required if you only consume the stable root contract.

```ts
import {
  AgentConversations,
  SUPPORTED_ROLES,
  type DelegationPlan,
  type Intent,
  type Role,
  type SessionPolicy
} from "opencode-council";
```

## If you import supervisor helpers from the root barrel

Move those imports to `opencode-council/supervisor`.

Before:

```ts
import {
  createSupervisorDispatchLoop,
  createSupervisorExecutionWorkflow,
  loadSupervisorPolicy,
  type SupervisorRunRecord,
  type SupervisorWorkflowStage
} from "opencode-council";
```

After:

```ts
import {
  createSupervisorDispatchLoop,
  createSupervisorExecutionWorkflow,
  loadSupervisorPolicy,
  type SupervisorRunRecord,
  type SupervisorWorkflowStage
} from "opencode-council/supervisor";
```

Another common migration:

Before:

```ts
import {
  normalizeWorkUnit,
  routeSupervisorWorkUnit,
  type WorkUnit,
  type RouteSupervisorWorkUnitResult
} from "opencode-council";
```

After:

```ts
import {
  normalizeWorkUnit,
  routeSupervisorWorkUnit,
  type WorkUnit,
  type RouteSupervisorWorkUnitResult
} from "opencode-council/supervisor";
```

## Migration checklist

1. Keep root imports only for the frozen stable contract.
2. Move all supervisor-specific value exports to `opencode-council/supervisor`.
3. Move all supervisor-specific type imports to `opencode-council/supervisor`.
4. Treat the supervisor entry point as experimental; expect further iteration there.
5. Keep existing CLI automation as-is.
6. Check the canonical policy doc before depending on compatibility or deprecation behavior.

## Expected compatibility

- Root-barrel users of the stable runtime contract should see no API churn in `v0.5.x`.
- CLI-driven installs and upgrades should not require command changes in `v0.5.x`.
- Existing documented env vars and policy keys remain valid in `v0.5.x` per the canonical policy doc.
- Supervisor consumers should update imports now so future stable-contract work does not require more root-barrel changes.
