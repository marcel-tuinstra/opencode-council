import { describe, expect, it } from "vitest";
import type { LanePlanningWorkUnit } from "../plugins/orchestration-workflows/lane-plan";
import { planWorkUnitLanes, scoreWorkUnitComplexity } from "../plugins/orchestration-workflows/lane-plan";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("lane-plan", () => {
  it("builds tracker-agnostic lanes and a dependency graph from normalized work units", () => {
    // Arrange
    const intake: LanePlanningWorkUnit[] = [
      {
        id: "sc-341-intake",
        workUnit: normalizeWorkUnit({
          objective: "Normalize lane planning inputs",
          constraints: ["safe-route-only"],
          source: {
            kind: "tracker",
            tracker: "shortcut",
            entityType: "story",
            id: 341,
            title: "Complexity-Based Lane Planner",
            reference: "sc-341"
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "low",
          coupling: "medium",
          blastRadius: "contained",
          unknownCount: 1,
          testIsolation: "isolated"
        }
      },
      {
        id: "docs-contract",
        workUnit: normalizeWorkUnit({
          objective: "Document the lane planning contract",
          source: {
            kind: "ad-hoc",
            title: "Lane planning contract doc",
            reference: "doc:lane-plan"
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
      },
      {
        id: "helper-tests",
        workUnit: normalizeWorkUnit({
          objective: "Verify dependency-aware lane planning helper",
          dependencies: [
            {
              description: "Needs normalized work-unit intake",
              reference: "sc-341"
            }
          ],
          source: {
            kind: "ad-hoc",
            title: "Lane helper tests",
            reference: "test:lane-helper"
          }
        }),
        dependsOn: ["sc-341-intake"],
        signals: {
          fileOverlap: "medium",
          coupling: "medium",
          blastRadius: "adjacent",
          unknownCount: 2,
          testIsolation: "partial"
        }
      }
    ];

    // Act
    const plan = planWorkUnitLanes(intake);

    // Assert
    expect(plan.usesExpectedDuration).toBe(false);
    expect(plan.scoringSignals).toEqual([
      "fileOverlap",
      "coupling",
      "blastRadius",
      "unknownCount",
      "testIsolation"
    ]);
    expect(plan.lanes).toEqual([
      {
        lane: 1,
        workUnitIds: ["sc-341-intake", "docs-contract"],
        maxStructuralScore: 5,
        reasons: ["coupling medium", "unknown count 1"]
      },
      {
        lane: 2,
        workUnitIds: ["helper-tests"],
        maxStructuralScore: 9,
        reasons: [
          "file overlap medium",
          "coupling medium",
          "blast radius adjacent",
          "unknown count 2",
          "test isolation partial"
        ]
      }
    ]);
    expect(plan.dependencyGraph).toEqual([
      {
        id: "docs-contract",
        blockedBy: [],
        unblocks: [],
        parallelizableWith: ["sc-341-intake"],
        lane: 1,
        structuralScore: 3
      },
      {
        id: "sc-341-intake",
        blockedBy: [],
        unblocks: ["helper-tests"],
        parallelizableWith: ["docs-contract"],
        lane: 1,
        structuralScore: 5
      },
      {
        id: "helper-tests",
        blockedBy: ["sc-341-intake"],
        unblocks: [],
        parallelizableWith: [],
        lane: 2,
        structuralScore: 9
      }
    ]);
  });

  it("scores structural complexity without any duration input", () => {
    // Arrange

    // Act
    const score = scoreWorkUnitComplexity({
      fileOverlap: "high",
      coupling: "medium",
      blastRadius: "broad",
      unknownCount: 7,
      testIsolation: "shared"
    });

    // Assert
    expect(score).toBe(13);
  });
});
