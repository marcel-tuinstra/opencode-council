import { describe, expect, it } from "vitest";
import type { LanePlanningWorkUnit } from "../plugins/orchestration-workflows/lane-plan";
import { createSupervisorBootstrapPreview } from "../plugins/orchestration-workflows/supervisor-bootstrap";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("supervisor-bootstrap", () => {
  it("builds a fail-closed bootstrap preview from planning, lane decomposition, and routing guidance", () => {
    // Arrange
    const workUnits: LanePlanningWorkUnit[] = [
      {
        id: "implementation",
        workUnit: normalizeWorkUnit({
          objective: "Implement the beta supervisor bootstrap helper",
          acceptanceCriteria: ["Helper returns a deterministic preview"],
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
        id: "verification",
        workUnit: normalizeWorkUnit({
          objective: "Verify the bootstrap preview output",
          acceptanceCriteria: ["Targeted supervisor bootstrap tests pass"],
          dependencies: [{ description: "Implementation first", reference: "implementation" }],
          source: {
            kind: "ad-hoc",
            title: "Verification"
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
    const result = createSupervisorBootstrapPreview({
      target: {
        organization: "Acme Platform",
        repository: "Supervisor Beta",
        baseBranch: "beta"
      },
      goal: "CTO, implement beta bootstrap planning, verify it with tests, and prepare review guidance.",
      workUnits,
      prerequisites: {
        repoConnected: true,
        trackerConnected: true,
        verificationCommand: "npm test -- supervisor-bootstrap",
        recoveryOwner: "ops-oncall"
      },
      readyDependencyReferences: []
    });

    // Assert
    expect(result.status).toBe("supported");
    expect(result.target.branchPrefix).toBe("beta/acme-platform/supervisor-beta");
    expect(result.steps.map((step) => step.key)).toEqual([
      "check-prerequisites",
      "plan-goal",
      "decompose-lanes",
      "preview-dispatch",
      "verify-manually",
      "prepare-recovery"
    ]);
    expect(result.laneDecomposition.status).toBe("supported");
    expect(result.dispatchPlan.status).toBe("supported");
    expect(result.dispatchPlan.routeResults.map((route) => route.nextAction)).toEqual([
      "dispatch-lane",
      "wait-for-prerequisites"
    ]);
    expect(result.verificationGuidance).toContain("Run 'npm test -- supervisor-bootstrap' after the planned code changes land in the target repository.");
    expect(result.recoveryGuidance).toContain("Escalate blocked or stalled bootstrap steps to ops-oncall before changing policy or lane definitions.");
  });

  it("fails closed with actionable prerequisite remediation when bootstrap requirements are missing", () => {
    // Arrange
    const workUnits: LanePlanningWorkUnit[] = [
      {
        id: "implementation",
        workUnit: normalizeWorkUnit({
          objective: "Implement the beta supervisor bootstrap helper",
          source: {
            kind: "ad-hoc",
            title: "Implementation"
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
    const result = createSupervisorBootstrapPreview({
      target: {
        organization: "",
        repository: "Supervisor Beta",
        baseBranch: "beta"
      },
      goal: "Help?",
      workUnits,
      prerequisites: {
        repoConnected: false,
        trackerConnected: false
      }
    });

    // Assert
    expect(result.status).toBe("unsupported");
    expect(result.checks.filter((check) => check.status === "blocked").map((check) => check.key)).toEqual([
      "target",
      "repo-access",
      "tracker-access",
      "verification",
      "recovery"
    ]);
    expect(result.goalPlan.status).toBe("unsupported");
    expect(result.steps.find((step) => step.key === "check-prerequisites")?.status).toBe("blocked");
    expect(result.remediation).toContain("Provide target.organization, target.repository, and target.baseBranch before creating a preview.");
    expect(result.remediation).toContain("Provide prerequisites.verificationCommand so the preview includes an explicit validation step.");
    expect(result.recoveryGuidance).toContain("Assign a recovery owner before using this preview for onboarding decisions.");
  });
});
