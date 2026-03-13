import { describe, expect, it } from "vitest";
import { planSupervisorGoal } from "../plugins/orchestration-workflows/supervisor-goal-plan";

describe("supervisor-goal-plan", () => {
  it("returns a structured plan for a concrete delegated backend goal", () => {
    // Arrange
    const goal = "CTO, implement branch-aware API routing and backend supervisor planning for main/master/develop repos, then validate with tests and docs.";

    // Act
    const result = planSupervisorGoal({ goal, requestedByRole: "CTO" });

    // Assert
    expect(result.status).toBe("supported");
    expect(result.intent).toBe("backend");
    expect(result.confidence).toBe("high");
    expect(result.budgetClass).toBe("standard");
    expect(result.laneCount).toBeGreaterThanOrEqual(1);
    expect(result.recommendedRoles.map((entry) => entry.role)).toContain("CTO");
    expect(result.recommendedRoles.map((entry) => entry.role)).toContain("DEV");
    expect(result.remediation).toEqual([]);
  });

  it("fails closed with actionable remediation when the goal is ambiguous", () => {
    // Arrange
    const goal = "Could you maybe help?";

    // Act
    const result = planSupervisorGoal({ goal });

    // Assert
    expect(result.status).toBe("unsupported");
    expect(result.confidence).toBe("low");
    expect(result.recommendedRoles).toEqual([]);
    expect(result.laneCount).toBe(0);
    expect(result.remediation.length).toBeGreaterThan(0);
  });

  it("marks approval boundaries when the goal includes merge/release/security risk", () => {
    // Arrange
    const goal = "CTO, merge the production auth fix, rotate credentials, and ship the release.";

    // Act
    const result = planSupervisorGoal({ goal });

    // Assert
    expect(result.status).toBe("supported");
    expect(result.requiresApproval).toBe(true);
    expect(result.approvalBoundaries).toContain("merge");
    expect(result.approvalBoundaries).toContain("release");
    expect(result.approvalBoundaries).toContain("securitySensitive");
  });

  it("respects available roles and max role caps deterministically", () => {
    // Arrange
    const goal = "Plan roadmap sequencing for a multi-team release with validation gates.";

    // Act
    const first = planSupervisorGoal({
      goal,
      availableRoles: ["CTO", "PM", "PO"],
      maxRoles: 2
    });
    const second = planSupervisorGoal({
      goal,
      availableRoles: ["CTO", "PM", "PO"],
      maxRoles: 2
    });

    // Assert
    expect(first.status).toBe("supported");
    expect(first.recommendedRoles.length).toBeLessThanOrEqual(2);
    expect(first.recommendedRoles.every((entry) => ["CTO", "PM", "PO"].includes(entry.role))).toBe(true);
    expect(first).toEqual(second);
  });
});
