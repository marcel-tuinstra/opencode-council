import { describe, expect, expectTypeOf, it } from "vitest";
import * as stableRoot from "../plugins/orchestration-workflows.js";
import * as supervisorRoot from "../plugins/orchestration-workflows-supervisor.js";
import {
  AgentConversations,
  SUPPORTED_ROLES,
  type DelegationMode,
  type DelegationPlan,
  type DelegationRequest,
  type DelegationWave,
  type Intent,
  type Role,
  type SessionPolicy
} from "../plugins/orchestration-workflows.js";
import {
  createFileBackedSupervisorStateStore,
  createSupervisorDispatchPlan,
  DEFAULT_SUPERVISOR_PROFILE
} from "../plugins/orchestration-workflows-supervisor.js";
import type {
  DelegationMode as SourceDelegationMode,
  DelegationPlan as SourceDelegationPlan,
  DelegationRequest as SourceDelegationRequest,
  DelegationWave as SourceDelegationWave,
  Intent as SourceIntent,
  Role as SourceRole,
  SessionPolicy as SourceSessionPolicy
} from "../plugins/orchestration-workflows/types.js";

describe("orchestration workflow package barrels", () => {
  it("exports only the stable root runtime surface", () => {
    expect(Object.keys(stableRoot).sort()).toEqual([
      "AgentConversations",
      "SUPPORTED_ROLES"
    ]);
    expect(stableRoot.AgentConversations).toBe(AgentConversations);
    expect(stableRoot.SUPPORTED_ROLES).toBe(SUPPORTED_ROLES);
  });

  it("exports the stable root type surface", () => {
    expectTypeOf<Role>().toEqualTypeOf<SourceRole>();
    expectTypeOf<Intent>().toEqualTypeOf<SourceIntent>();
    expectTypeOf<DelegationMode>().toEqualTypeOf<SourceDelegationMode>();
    expectTypeOf<DelegationRequest>().toEqualTypeOf<SourceDelegationRequest>();
    expectTypeOf<DelegationWave>().toEqualTypeOf<SourceDelegationWave>();
    expectTypeOf<DelegationPlan>().toEqualTypeOf<SourceDelegationPlan>();
    expectTypeOf<SessionPolicy>().toEqualTypeOf<SourceSessionPolicy>();
  });

  it("keeps supervisor exports out of the stable root", () => {
    expect("createSupervisorDispatchPlan" in stableRoot).toBe(false);
    expect("createFileBackedSupervisorStateStore" in stableRoot).toBe(false);
    expect("DEFAULT_SUPERVISOR_PROFILE" in stableRoot).toBe(false);
    expect("McpProviderConfig" in stableRoot).toBe(false);
    expect("McpBlockResult" in stableRoot).toBe(false);
  });

  it("exports supervisor symbols from the experimental supervisor barrel", () => {
    expect(supervisorRoot.createSupervisorDispatchPlan).toBe(createSupervisorDispatchPlan);
    expect(supervisorRoot.createFileBackedSupervisorStateStore).toBe(createFileBackedSupervisorStateStore);
    expect(supervisorRoot.DEFAULT_SUPERVISOR_PROFILE).toBe(DEFAULT_SUPERVISOR_PROFILE);
  });
});
