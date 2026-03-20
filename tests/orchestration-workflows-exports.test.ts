import { describe, expect, expectTypeOf, it } from "vitest";
import * as pluginEntry from "../plugins/orchestration-workflows.js";
import * as packageRoot from "../index.js";
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
} from "../index.js";
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
  it("plugin entry exports ONLY the plugin factory", () => {
    const exports = Object.keys(pluginEntry);
    expect(exports).toEqual(["AgentConversations"]);
    expect(typeof pluginEntry.AgentConversations).toBe("function");
  });

  it("plugin entry contains no non-function exports", () => {
    for (const [, value] of Object.entries(pluginEntry)) {
      expect(typeof value).toBe("function");
    }
  });

  it("package root exports the stable runtime surface", () => {
    expect(Object.keys(packageRoot).sort()).toEqual([
      "AgentConversations",
      "SUPPORTED_ROLES"
    ]);
    expect(packageRoot.AgentConversations).toBe(AgentConversations);
    expect(packageRoot.SUPPORTED_ROLES).toBe(SUPPORTED_ROLES);
  });

  it("package root exports the stable type surface", () => {
    expectTypeOf<Role>().toEqualTypeOf<SourceRole>();
    expectTypeOf<Intent>().toEqualTypeOf<SourceIntent>();
    expectTypeOf<DelegationMode>().toEqualTypeOf<SourceDelegationMode>();
    expectTypeOf<DelegationRequest>().toEqualTypeOf<SourceDelegationRequest>();
    expectTypeOf<DelegationWave>().toEqualTypeOf<SourceDelegationWave>();
    expectTypeOf<DelegationPlan>().toEqualTypeOf<SourceDelegationPlan>();
    expectTypeOf<SessionPolicy>().toEqualTypeOf<SourceSessionPolicy>();
  });

  it("keeps supervisor exports out of the plugin entry and package root", () => {
    expect("createSupervisorDispatchPlan" in pluginEntry).toBe(false);
    expect("createSupervisorDispatchPlan" in packageRoot).toBe(false);
    expect("createFileBackedSupervisorStateStore" in packageRoot).toBe(false);
    expect("DEFAULT_SUPERVISOR_PROFILE" in packageRoot).toBe(false);
    // MCP helper types are intentionally internal-only
    expect("McpProviderConfig" in packageRoot).toBe(false);
    expect("McpBlockResult" in packageRoot).toBe(false);
  });

  it("exports supervisor symbols from the experimental supervisor barrel", () => {
    expect(supervisorRoot.createSupervisorDispatchPlan).toBe(createSupervisorDispatchPlan);
    expect(supervisorRoot.createFileBackedSupervisorStateStore).toBe(createFileBackedSupervisorStateStore);
    expect(supervisorRoot.DEFAULT_SUPERVISOR_PROFILE).toBe(DEFAULT_SUPERVISOR_PROFILE);
  });
});
