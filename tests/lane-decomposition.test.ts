import { describe, expect, it } from "vitest";
import { decomposeSupervisorGoalIntoLanes } from "../plugins/orchestration-workflows/lane-decomposition";
import type { LanePlanningWorkUnit } from "../plugins/orchestration-workflows/lane-plan";
import { planSupervisorGoal } from "../plugins/orchestration-workflows/supervisor-goal-plan";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("lane-decomposition", () => {
  it("combines supported goal planning with dependency-safe lane previews", () => {
    // Arrange
    const goalPlan = planSupervisorGoal({
      goal: "CTO, implement backend supervisor planning, validate the result, and prepare review evidence."
    });
    const workUnits: LanePlanningWorkUnit[] = [
      {
        id: "core-implementation",
        workUnit: normalizeWorkUnit({
          objective: "Implement the backend supervisor planning helper",
          source: {
            kind: "ad-hoc",
            title: "Core implementation"
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "medium",
          coupling: "medium",
          blastRadius: "adjacent",
          unknownCount: 1,
          testIsolation: "partial"
        }
      },
      {
        id: "validation",
        workUnit: normalizeWorkUnit({
          objective: "Validate the implementation with targeted tests",
          dependencies: [{ description: "Implementation must land first", reference: "core-implementation" }],
          source: {
            kind: "ad-hoc",
            title: "Validation"
          }
        }),
        dependsOn: ["core-implementation"],
        signals: {
          fileOverlap: "low",
          coupling: "low",
          blastRadius: "contained",
          unknownCount: 0,
          testIsolation: "isolated"
        }
      }
    ];

    // Act
    const result = decomposeSupervisorGoalIntoLanes({
      goalPlan,
      workUnits,
      scheduler: { branchPrefix: "work/sc-436" }
    });

    // Assert
    expect(result.status).toBe("supported");
    expect(result.lanePlan?.dependencyGraph).toEqual([
      {
        id: "core-implementation",
        blockedBy: [],
        unblocks: ["validation"],
        parallelizableWith: [],
        lane: 1,
        structuralScore: 8
      },
      {
        id: "validation",
        blockedBy: ["core-implementation"],
        unblocks: [],
        parallelizableWith: [],
        lane: 2,
        structuralScore: 3
      }
    ]);
    expect(result.laneDefinitionsPreview).toEqual([
      {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["core-implementation"],
        dependsOnLaneIds: [],
        branch: "work/sc-436/lane-01"
      },
      {
        laneId: "lane-2",
        sequence: 2,
        workUnitIds: ["validation"],
        dependsOnLaneIds: ["lane-1"],
        branch: "work/sc-436/lane-02"
      }
    ]);
  });

  it("warns when advisory lane count diverges from dependency-safe lane count", () => {
    // Arrange
    const goalPlan = planSupervisorGoal({
      goal: "CTO, implement backend supervisor planning and validate it with tests."
    });
    const workUnits: LanePlanningWorkUnit[] = [
      {
        id: "single-unit",
        workUnit: normalizeWorkUnit({
          objective: "Ship a single bounded implementation task",
          source: {
            kind: "ad-hoc",
            title: "Single lane"
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "low",
          coupling: "low",
          blastRadius: "contained",
          unknownCount: 0,
          testIsolation: "isolated"
        }
      }
    ];

    // Act
    const result = decomposeSupervisorGoalIntoLanes({ goalPlan, workUnits });

    // Assert
    expect(result.status).toBe("supported");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Goal planning suggested");
  });

  it("fails closed when goal planning is unsupported", () => {
    // Arrange
    const goalPlan = planSupervisorGoal({ goal: "Help?" });

    // Act
    const result = decomposeSupervisorGoalIntoLanes({ goalPlan, workUnits: [] });

    // Assert
    expect(result.status).toBe("unsupported");
    expect(result.lanePlan).toBeUndefined();
    expect(result.laneDefinitionsPreview).toBeUndefined();
    expect(result.remediation.length).toBeGreaterThan(0);
  });
});
