import { describe, expect, it } from "vitest";
import type { SupervisorRunState } from "../plugins/orchestration-workflows/durable-state-store";
import { classifySupervisorRecoveryPlaybook, getSupervisorLaneRecoveryContext } from "../plugins/orchestration-workflows/recovery-repair-playbooks";
import type { SupervisorLaneWorktreeReconciliationReport } from "../plugins/orchestration-workflows/lane-worktree-provisioner";

const createRunState = (): SupervisorRunState => ({
  schemaVersion: 2,
  run: {
    runId: "run-recovery",
    status: "active",
    objective: "Recover supervisor lanes safely.",
    sourceOfTruth: "control-plane-state",
    createdAt: "2026-03-13T16:00:00.000Z",
    updatedAt: "2026-03-13T16:00:00.000Z"
  },
  lanes: [
    {
      laneId: "lane-1",
      state: "active",
      branch: "marceltuinstra/sc-404/lane-01",
      worktreeId: "run-recovery:lane-1",
      sessionId: "run-recovery:lane-1:session-01",
      updatedAt: "2026-03-13T16:01:00.000Z"
    },
    {
      laneId: "lane-2",
      state: "review_ready",
      branch: "marceltuinstra/sc-404/lane-02",
      worktreeId: "run-recovery:lane-2",
      sessionId: "run-recovery:lane-2:session-01",
      updatedAt: "2026-03-13T16:01:00.000Z"
    }
  ],
  worktrees: [
    {
      worktreeId: "run-recovery:lane-1",
      laneId: "lane-1",
      path: "/tmp/run-recovery/lane-1",
      branch: "marceltuinstra/sc-404/lane-01",
      status: "active",
      updatedAt: "2026-03-13T16:01:00.000Z"
    },
    {
      worktreeId: "run-recovery:lane-2",
      laneId: "lane-2",
      path: "/tmp/run-recovery/lane-2",
      branch: "marceltuinstra/sc-404/lane-02",
      status: "active",
      updatedAt: "2026-03-13T16:01:00.000Z"
    }
  ],
  sessions: [
    {
      sessionId: "run-recovery:lane-1:session-01",
      laneId: "lane-1",
      worktreeId: "run-recovery:lane-1",
      status: "active",
      runtime: "opencode",
      owner: "developer-a",
      startedAt: "2026-03-13T16:01:00.000Z",
      attachedAt: "2026-03-13T16:01:00.000Z",
      lastHeartbeatAt: "2026-03-13T16:02:00.000Z",
      updatedAt: "2026-03-13T16:02:00.000Z"
    },
    {
      sessionId: "run-recovery:lane-2:session-01",
      laneId: "lane-2",
      worktreeId: "run-recovery:lane-2",
      status: "active",
      runtime: "opencode",
      owner: "developer-b",
      startedAt: "2026-03-13T16:01:00.000Z",
      attachedAt: "2026-03-13T16:01:00.000Z",
      lastHeartbeatAt: "2026-03-13T16:02:00.000Z",
      updatedAt: "2026-03-13T16:02:00.000Z"
    }
  ],
  approvals: [],
  artifacts: [
    {
      artifactId: "lane-2-branch",
      laneId: "lane-2",
      kind: "branch",
      status: "ready",
      uri: "git:marceltuinstra/sc-404/lane-02",
      updatedAt: "2026-03-13T16:03:00.000Z"
    }
  ],
  childSessions: [],
  appliedMutations: [],
  auditLog: []
});

const createReconciliationReport = (): SupervisorLaneWorktreeReconciliationReport => ({
  runId: "run-recovery",
  worktreeRootDir: "/tmp/run-recovery",
  isClean: false,
  healthy: [],
  drift: [],
  collisions: [],
  orphans: []
});

describe("recovery-repair-playbooks", () => {
  it("classifies stale heartbeats as supervised session retries", () => {
    // Arrange
    const runState = createRunState();

    // Act
    const playbook = classifySupervisorRecoveryPlaybook({
      runState,
      laneId: "lane-1",
      observedAt: "2026-03-13T16:10:00.000Z",
      stallTimeoutMs: 60_000
    });

    // Assert
    expect(playbook.classification.failureClass).toBe("stuck-heartbeat");
    expect(playbook.classification.disposition).toBe("supervised-retry");
    expect(playbook.actions.map((action) => action.kind)).toEqual(["pause-lane", "replace-session"]);
  });

  it("classifies failed sessions as supervised retries on the same worktree", () => {
    // Arrange
    const seededRunState = createRunState();
    const runState: SupervisorRunState = {
      ...seededRunState,
      sessions: [
        {
          ...seededRunState.sessions[0]!,
          status: "failed",
          failureReason: "Runtime exited after a tool crash.",
          updatedAt: "2026-03-13T16:05:00.000Z"
        },
        ...seededRunState.sessions.slice(1)
      ]
    };

    // Act
    const playbook = classifySupervisorRecoveryPlaybook({
      runState,
      laneId: "lane-1",
      observedAt: "2026-03-13T16:06:00.000Z"
    });

    // Assert
    expect(playbook.classification.failureClass).toBe("failed-session");
    expect(playbook.classification.disposition).toBe("supervised-retry");
    expect(playbook.classification.reasons).toEqual(["Runtime exited after a tool crash."]);
  });

  it("classifies worktree collisions as quarantine flows with destructive approval", () => {
    // Arrange
    const runState = createRunState();
    const report = createReconciliationReport();
    report.collisions = [
      {
        laneId: "lane-1",
        worktreeId: "run-recovery:lane-1",
        path: "/tmp/run-recovery/lane-1",
        reason: "Path '/tmp/run-recovery/lane-1' is claimed by multiple durable worktree records."
      }
    ];

    // Act
    const playbook = classifySupervisorRecoveryPlaybook({
      runState,
      laneId: "lane-1",
      observedAt: "2026-03-13T16:06:00.000Z",
      worktreeReconciliation: report
    });

    // Assert
    expect(playbook.classification.failureClass).toBe("worktree-drift");
    expect(playbook.classification.disposition).toBe("quarantine");
    expect(playbook.approvalRequest?.boundary).toBe("destructive");
    expect(playbook.actions.map((action) => action.kind)).toEqual([
      "pause-lane",
      "request-approval",
      "rebuild-worktree",
      "escalate-human"
    ]);
  });

  it("classifies merge conflicts as repair playbooks that reopen review prep", () => {
    // Arrange
    const runState = createRunState();

    // Act
    const playbook = classifySupervisorRecoveryPlaybook({
      runState,
      laneId: "lane-2",
      observedAt: "2026-03-13T16:06:00.000Z",
      mergeConflict: {
        files: ["plugins/orchestration-workflows/supervisor-scheduler.ts"],
        detail: "Rebase onto epic/supervisor-alpha produced a content conflict."
      }
    });

    // Assert
    expect(playbook.classification.failureClass).toBe("merge-conflict");
    expect(playbook.classification.disposition).toBe("repair");
    expect(playbook.actions.map((action) => action.kind)).toEqual([
      "pause-lane",
      "replace-session",
      "rebuild-artifacts",
      "reopen-review"
    ]);
  });

  it("classifies retryable tool outages as supervised retries", () => {
    // Arrange
    const runState = createRunState();

    // Act
    const playbook = classifySupervisorRecoveryPlaybook({
      runState,
      laneId: "lane-1",
      observedAt: "2026-03-13T16:06:00.000Z",
      toolOutage: {
        system: "github",
        scope: "network",
        retryable: true,
        detail: "GitHub was temporarily unavailable while preparing the review handoff."
      }
    });

    // Assert
    expect(playbook.classification.failureClass).toBe("tool-outage");
    expect(playbook.classification.disposition).toBe("supervised-retry");
    expect(playbook.actions.map((action) => action.kind)).toEqual(["pause-lane", "retry-tool", "replace-session"]);
  });

  it("detects partial completion gaps from review-ready artifacts", () => {
    // Arrange
    const runState = createRunState();
    const context = getSupervisorLaneRecoveryContext(runState, "lane-2");

    // Act
    const playbook = classifySupervisorRecoveryPlaybook({
      runState,
      laneId: "lane-2",
      observedAt: "2026-03-13T16:06:00.000Z"
    });

    // Assert
    expect(context.artifacts.map((artifact) => artifact.kind)).toEqual(["branch"]);
    expect(playbook.classification.failureClass).toBe("partial-completion");
    expect(playbook.classification.disposition).toBe("repair");
    expect(playbook.classification.reasons).toEqual(["Missing ready artifacts: pull-request, review-packet."]);
    expect(playbook.actions.map((action) => action.kind)).toEqual(["rebuild-artifacts", "reopen-review"]);
  });
});
