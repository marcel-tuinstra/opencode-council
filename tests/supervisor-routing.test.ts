import { describe, expect, it } from "vitest";
import type { SupervisorRunState } from "../plugins/orchestration-workflows/durable-state-store";
import type { SupervisorLaneDefinition } from "../plugins/orchestration-workflows/supervisor-scheduler";
import { routeSupervisorWorkUnit } from "../plugins/orchestration-workflows/supervisor-routing";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

const createRunState = (): SupervisorRunState => ({
  schemaVersion: 1,
  run: {
    runId: "run-alpha",
    status: "active",
    objective: "Route supervisor work deterministically.",
    sourceOfTruth: "control-plane-state",
    createdAt: "2026-03-13T10:00:00.000Z",
    updatedAt: "2026-03-13T10:00:00.000Z"
  },
  lanes: [
    {
      laneId: "lane-1",
      state: "active",
      branch: "supervisor/lane-01",
      worktreeId: "run-alpha:lane-1",
      sessionId: "session-1",
      updatedAt: "2026-03-13T10:00:00.000Z"
    }
  ],
  worktrees: [
    {
      worktreeId: "run-alpha:lane-1",
      laneId: "lane-1",
      path: "/tmp/run-alpha/lane-1",
      branch: "supervisor/lane-01",
      status: "active",
      updatedAt: "2026-03-13T10:00:00.000Z"
    }
  ],
  sessions: [
    {
      sessionId: "session-1",
      laneId: "lane-1",
      worktreeId: "run-alpha:lane-1",
      status: "active",
      owner: "alice",
      updatedAt: "2026-03-13T10:00:00.000Z"
    }
  ],
  approvals: [],
  artifacts: [],
  appliedMutations: [],
  auditLog: []
});

describe("supervisor-routing", () => {
  it("routes a tracked backend work unit onto its planned lane and keeps the sticky owner", () => {
    // Arrange
    const laneDefinitions: SupervisorLaneDefinition[] = [
      {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["sc-325"],
        dependsOnLaneIds: [],
        branch: "supervisor/lane-01"
      }
    ];
    const workUnit = normalizeWorkUnit({
      objective: "Fix the runtime API routing path and assign the next implementation action",
      acceptanceCriteria: ["Supervisor chooses a deterministic execution path"],
      riskTags: ["runtime"],
      source: {
        kind: "tracker",
        tracker: "shortcut",
        entityType: "story",
        id: 325,
        title: "Supervisor Routing + Assignment MVP",
        reference: "sc-325"
      }
    });

    // Act
    const result = routeSupervisorWorkUnit({
      workUnitId: "sc-325",
      workUnit,
      laneDefinitions,
      runState: createRunState(),
      sessionOwners: ["alice", "bob"]
    });

    // Assert
    expect(result).toMatchObject({
      workUnitId: "sc-325",
      intent: "backend",
      executionPath: "execute",
      leadRole: "DEV",
      confidence: "high",
      laneId: "lane-1",
      assignedOwner: "alice",
      nextAction: "none"
    });
    expect(result.decisionEvidence).toEqual({
      signalScore: 4,
      minimumSignalScore: 2,
      matchedSignals: ["intent-profile", "tracked-source", "acceptance-criteria", "planned-lane"],
      fallbackTriggered: false,
      fallbackReason: "none"
    });
    expect(result.thresholdEvents).toEqual([
      {
        eventId: "routing:sc-325:2:4",
        guardrail: "routing",
        thresholdKey: "minimum-signal-score",
        status: "within-threshold",
        thresholdValue: 2,
        observedValue: 4,
        reasonCode: undefined,
        summary: "Routing signal score 4 met the minimum score 2.",
        evidence: result.decisionEvidence
      }
    ]);
    expect(result.reasonDetails.map((detail) => detail.code)).toEqual([
      "route.intent-profile",
      "route.lane-match",
      "assignment.sticky-session-owner"
    ]);
  });

  it("chooses a deterministic owner and launches the lane session when worktree is ready", () => {
    // Arrange
    const laneDefinitions: SupervisorLaneDefinition[] = [
      {
        laneId: "lane-2",
        sequence: 2,
        workUnitIds: ["wu-2"],
        dependsOnLaneIds: [],
        branch: "supervisor/lane-02"
      }
    ];
    const runState: SupervisorRunState = {
      ...createRunState(),
      lanes: [
        {
          laneId: "lane-2",
          state: "active",
          branch: "supervisor/lane-02",
          worktreeId: "run-alpha:lane-2",
          updatedAt: "2026-03-13T10:00:00.000Z"
        }
      ],
      worktrees: [
        {
          worktreeId: "run-alpha:lane-2",
          laneId: "lane-2",
          path: "/tmp/run-alpha/lane-2",
          branch: "supervisor/lane-02",
          status: "active",
          updatedAt: "2026-03-13T10:00:00.000Z"
        }
      ],
      sessions: []
    };
    const workUnit = normalizeWorkUnit({
      objective: "Investigate the API regression and ship the runtime fix",
      acceptanceCriteria: ["Runtime fix is ready for the next supervisor turn"],
      source: {
        kind: "tracker",
        tracker: "jira",
        entityType: "issue",
        id: "OPS-12",
        title: "Runtime regression"
      }
    });

    // Act
    const result = routeSupervisorWorkUnit({
      workUnitId: "wu-2",
      workUnit,
      laneDefinitions,
      runState,
      sessionOwners: ["bob", "carol"]
    });

    // Assert
    expect(result.executionPath).toBe("execute");
    expect(result.assignedOwner).toBe("bob");
    expect(result.nextAction).toBe("launch-session");
    expect(result.reasonDetails.map((detail) => detail.code)).toContain("assignment.deterministic-owner");
  });

  it("falls back safely when prerequisite references are still missing", () => {
    // Arrange
    const workUnit = normalizeWorkUnit({
      objective: "Land the routing helper after the scheduler primitives are ready",
      dependencies: [
        {
          description: "Scheduler dispatch loop",
          kind: "story",
          reference: "sc-399"
        }
      ],
      acceptanceCriteria: ["Fallback must stay explainable"],
      source: {
        kind: "tracker",
        tracker: "shortcut",
        entityType: "story",
        id: 325,
        title: "Supervisor Routing + Assignment MVP",
        reference: "sc-325"
      }
    });

    // Act
    const result = routeSupervisorWorkUnit({
      workUnitId: "sc-325",
      workUnit,
      readyDependencyReferences: []
    });

    // Assert
    expect(result.executionPath).toBe("safe-hold");
    expect(result.nextAction).toBe("wait-for-prerequisites");
    expect(result.missingPrerequisites).toEqual(["sc-399"]);
    expect(result.decisionEvidence.fallbackReason).toBe("missing-prerequisites");
    expect(result.reasonDetails.map((detail) => detail.code)).toEqual(["fallback.missing-prerequisites"]);
  });

  it("falls back to manual triage when routing confidence is too low", () => {
    // Arrange
    const workUnit = normalizeWorkUnit({
      objective: "General follow-up",
      source: {
        kind: "ad-hoc",
        title: "General follow-up"
      }
    });

    // Act
    const result = routeSupervisorWorkUnit({
      workUnitId: "wu-low-confidence",
      workUnit
    });

    // Assert
    expect(result.intent).toBe("mixed");
    expect(result.confidence).toBe("low");
    expect(result.executionPath).toBe("safe-hold");
    expect(result.leadRole).toBe("PM");
    expect(result.nextAction).toBe("manual-triage");
    expect(result.thresholdEvents).toEqual([
      {
        eventId: "routing:wu-low-confidence:2:0",
        guardrail: "routing",
        thresholdKey: "minimum-signal-score",
        status: "triggered",
        thresholdValue: 2,
        observedValue: 0,
        reasonCode: "fallback.low-confidence",
        summary: "Routing signal score 0 stayed below the minimum score 2.",
        evidence: result.decisionEvidence
      }
    ]);
    expect(result.reasonDetails.map((detail) => detail.code)).toEqual(["fallback.low-confidence"]);
  });
});
