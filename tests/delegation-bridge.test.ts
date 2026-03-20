import { describe, expect, it } from "vitest";
import {
  bridgeDelegationPlan,
  detectDelegationPlanSource,
  MANAGER_ROLES,
  IMPLEMENTATION_ROLES,
  type DelegationBridgeInput
} from "../plugins/orchestration-workflows/delegation-bridge.ts";
import type { DelegationPlan, Role } from "../plugins/orchestration-workflows/types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makePlan = (overrides: Partial<DelegationPlan> = {}): DelegationPlan => ({
  leadRole: "CTO",
  requestedByUser: ["DEV", "FE"],
  waves: [
    { wave: 1, roles: ["DEV", "FE"], goal: "Implement frontend feature", dependsOn: [] },
    { wave: 2, roles: ["BE"], goal: "Wire backend API", dependsOn: [1] }
  ],
  maxParallelAgents: 3,
  provenance: {
    delegatedBy: "CTO",
    delegatedRoles: ["DEV", "FE", "BE"],
    addedByOrchestrator: []
  },
  ...overrides
});

// ---------------------------------------------------------------------------
// bridgeDelegationPlan
// ---------------------------------------------------------------------------

describe("bridgeDelegationPlan", () => {
  it("transforms a 2-wave plan into the correct number of supervisor assignments", () => {
    // Arrange
    const plan = makePlan();
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert — wave 1 has 2 roles, wave 2 has 1 role → 3 assignments
    expect(result.supervisorPlan.assignments).toHaveLength(3);
  });

  it("maps leadRole to supervisorLabel", () => {
    // Arrange
    const plan = makePlan({ leadRole: "PM" });
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.supervisorPlan.supervisorLabel).toBe("PM");
  });

  it("maps wave goals to assignment responsibilities", () => {
    // Arrange
    const plan = makePlan();
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    const [devAssignment, feAssignment, beAssignment] = result.supervisorPlan.assignments;
    expect(devAssignment.responsibilities).toEqual(["Implement frontend feature"]);
    expect(feAssignment.responsibilities).toEqual(["Implement frontend feature"]);
    expect(beAssignment.responsibilities).toEqual(["Wire backend API"]);
  });

  it("produces warnings when manager roles appear in implementation waves", () => {
    // Arrange
    const plan = makePlan({
      waves: [
        { wave: 1, roles: ["CEO", "DEV"], goal: "Build feature", dependsOn: [] }
      ]
    });
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.provenanceLog.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.provenanceLog.warnings[0]).toContain("CEO");
    expect(result.provenanceLog.warnings[0]).toContain("wave 1");
  });

  it("falls back to first role in first wave when leadRole is not set", () => {
    // Arrange — force leadRole to be absent by casting
    const plan = makePlan();
    (plan as Record<string, unknown>).leadRole = undefined;
    const input: DelegationBridgeInput = { plan: plan as DelegationPlan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert — first role in first wave is "DEV"
    expect(result.supervisorPlan.supervisorLabel).toBe("DEV");
  });

  it("throws on empty waves array", () => {
    // Arrange
    const plan = makePlan({ waves: [] });
    const input: DelegationBridgeInput = { plan };

    // Act & Assert
    expect(() => bridgeDelegationPlan(input)).toThrow("at least one wave");
  });

  it("transforms a single-wave single-role plan correctly", () => {
    // Arrange
    const plan = makePlan({
      leadRole: "FE",
      requestedByUser: ["FE"],
      waves: [
        { wave: 1, roles: ["FE"], goal: "Build landing page", dependsOn: [] }
      ],
      maxParallelAgents: 1
    });
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.supervisorPlan.assignments).toHaveLength(1);
    expect(result.supervisorPlan.assignments[0].role).toBe("FE");
    expect(result.supervisorPlan.assignments[0].responsibilities).toEqual(["Build landing page"]);
    expect(result.supervisorPlan.supervisorLabel).toBe("FE");
  });

  it("generates branch paths in expected format", () => {
    // Arrange
    const plan = makePlan({
      waves: [
        { wave: 3, roles: ["BE"], goal: "Provision API", dependsOn: [] }
      ]
    });
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.supervisorPlan.assignments[0].branch).toBe("work/supervisor/wave-3/role-be");
  });

  it("generates worktree paths in expected format", () => {
    // Arrange
    const plan = makePlan({
      waves: [
        { wave: 2, roles: ["UX"], goal: "Design wireframes", dependsOn: [] }
      ]
    });
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.supervisorPlan.assignments[0].worktreePath).toBe(".opencode/supervisor/worktrees/wave-2-ux");
  });

  it("sets default execution policy to delegate-only with manual merge", () => {
    // Arrange
    const plan = makePlan();
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.supervisorPlan.policy).toBeDefined();
    expect(result.supervisorPlan.policy!.mode).toBe("delegate-only");
    expect(result.supervisorPlan.policy!.allowSupervisorDirectEdits).toBe(false);
  });

  it("records correct wave and role counts in provenance log", () => {
    // Arrange
    const plan = makePlan(); // 2 waves, 3 total roles (DEV, FE, BE)
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.provenanceLog.sourceWaveCount).toBe(2);
    expect(result.provenanceLog.sourceLaneCount).toBe(3);
    expect(result.provenanceLog.roleMapping).toHaveLength(3);
  });

  it("detects unmapped roles when availableRoles filters them out", () => {
    // Arrange
    const plan = makePlan({
      waves: [
        { wave: 1, roles: ["DEV", "RESEARCH"], goal: "Investigate", dependsOn: [] }
      ]
    });
    const input: DelegationBridgeInput = { plan, availableRoles: ["DEV"] };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert — RESEARCH is not available, so only DEV is assigned
    expect(result.supervisorPlan.assignments).toHaveLength(1);
    expect(result.provenanceLog.unmappedRoles).toContain("RESEARCH");
  });

  it("returns sourceType as user-delegation", () => {
    // Arrange
    const plan = makePlan();
    const input: DelegationBridgeInput = { plan };

    // Act
    const result = bridgeDelegationPlan(input);

    // Assert
    expect(result.sourceType).toBe("user-delegation");
  });
});

// ---------------------------------------------------------------------------
// detectDelegationPlanSource
// ---------------------------------------------------------------------------

describe("detectDelegationPlanSource", () => {
  it("identifies a user delegation plan with waves", () => {
    const source = detectDelegationPlanSource({
      waves: [{ wave: 1, roles: ["DEV"], goal: "Test", dependsOn: [] }]
    });
    expect(source).toBe("user-delegation");
  });

  it("identifies a supervisor delegation plan with assignments", () => {
    const source = detectDelegationPlanSource({
      assignments: [{ role: "DEV", agentLabel: "DEV-A", responsibilities: ["Test"] }]
    });
    expect(source).toBe("supervisor-delegation");
  });

  it("throws when input is null", () => {
    expect(() => detectDelegationPlanSource(null)).toThrow("not an object");
  });

  it("throws when input has neither waves nor assignments", () => {
    expect(() => detectDelegationPlanSource({ leadRole: "CTO" })).toThrow(
      "neither 'waves' nor 'assignments'"
    );
  });

  it("throws when input is a primitive", () => {
    expect(() => detectDelegationPlanSource("not-a-plan")).toThrow("not an object");
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("delegation-bridge constants", () => {
  it("MANAGER_ROLES contains the expected roles", () => {
    expect(MANAGER_ROLES).toEqual(expect.arrayContaining(["CEO", "CTO", "PM", "PO", "MARKETING", "RESEARCH"]));
    expect(MANAGER_ROLES).toHaveLength(6);
  });

  it("IMPLEMENTATION_ROLES contains the expected roles", () => {
    expect(IMPLEMENTATION_ROLES).toEqual(expect.arrayContaining(["DEV", "FE", "BE", "UX"]));
    expect(IMPLEMENTATION_ROLES).toHaveLength(4);
  });
});
