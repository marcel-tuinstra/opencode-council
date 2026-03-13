import { describe, expect, it } from "vitest";
import { createSupervisorDispatchPlan } from "../plugins/orchestration-workflows/supervisor-dispatch-planning";
import type { LanePlanningWorkUnit } from "../plugins/orchestration-workflows/lane-plan";
import { planSupervisorGoal } from "../plugins/orchestration-workflows/supervisor-goal-plan";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("supervisor-dispatch-planning", () => {
  it("builds scheduler-ready lane inputs from goal planning and explicit work units", () => {
    // Arrange
    const goalPlan = planSupervisorGoal({
      goal: "CTO, implement backend supervisor planning, validate it, and prepare review evidence."
    });
    const workUnits: LanePlanningWorkUnit[] = [
      {
        id: "implementation",
        workUnit: normalizeWorkUnit({
          objective: "Implement the supervisor planning helper",
          source: {
            kind: "ad-hoc",
            title: "Implementation"
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
          objective: "Validate implementation coverage",
          dependencies: [{ description: "Implementation first", reference: "implementation" }],
          acceptanceCriteria: ["Targeted tests pass"],
          source: {
            kind: "ad-hoc",
            title: "Validation"
          }
        }),
        dependsOn: ["implementation"],
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
    const result = createSupervisorDispatchPlan({
      goalPlan,
      workUnits,
      scheduler: { branchPrefix: "beta/sc-437" },
      readyDependencyReferences: []
    });

    // Assert
    expect(result.status).toBe("supported");
    expect(result.laneInputs).toEqual([
      {
        definition: {
          laneId: "lane-1",
          sequence: 1,
          workUnitIds: ["implementation"],
          dependsOnLaneIds: [],
          branch: "beta/sc-437/lane-01"
        },
        waitingOn: []
      },
      {
        definition: {
          laneId: "lane-2",
          sequence: 2,
          workUnitIds: ["validation"],
          dependsOnLaneIds: ["lane-1"],
          branch: "beta/sc-437/lane-02"
        },
        waitingOn: ["implementation"]
      }
    ]);
    expect(result.routeResults.map((route) => route.nextAction)).toEqual(["dispatch-lane", "wait-for-prerequisites"]);
  });

  it("fails closed when goal planning is unsupported", () => {
    // Arrange
    const goalPlan = planSupervisorGoal({ goal: "Help?" });

    // Act
    const result = createSupervisorDispatchPlan({
      goalPlan,
      workUnits: []
    });

    // Assert
    expect(result.status).toBe("unsupported");
    expect(result.laneInputs).toEqual([]);
    expect(result.routeResults).toEqual([]);
    expect(result.remediation.length).toBeGreaterThan(0);
  });
});
