import { describe, expect, it } from "vitest";
import {
  evaluateSupervisorApprovalGate,
  resolveSupervisorApprovalId
} from "../plugins/orchestration-workflows/approval-gates";

describe("approval-gates", () => {
  it("creates a pending approval record and pauses at governance boundaries", () => {
    // Arrange
    const request = {
      boundary: "merge" as const,
      requestedAction: "merge pull request #14",
      summary: "Pause before merging the lane PR into the alpha base branch.",
      rationale: "Merges widen the shipped automation surface and need an explicit human checkpoint.",
      context: {
        changedPaths: ["plugins/orchestration-workflows/supervisor-scheduler.ts"],
        targetRef: "epic/supervisor-alpha"
      }
    };

    // Act
    const decision = evaluateSupervisorApprovalGate({
      laneId: "lane-1",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:00:00.000Z",
      request
    });

    // Assert
    expect(decision.approvalId).toBe(resolveSupervisorApprovalId("lane-1", request));
    expect(decision.status).toBe("pending");
    expect(decision.nextAction).toBe("pause");
    expect(decision.approval).toMatchObject({
      laneId: "lane-1",
      boundary: "merge",
      requestedAction: "merge pull request #14",
      status: "pending",
      requestedBy: "supervisor",
      requestedAt: "2026-03-13T16:00:00.000Z"
    });
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual([
      "approval.protected-path-review",
      "approval.governance-boundary"
    ]);
    expect(decision.decisionEvidence).toEqual({
      boundary: "merge",
      policyRequiresApproval: true,
      requestOverrideApplied: false,
      effectiveRequiresApproval: true,
      changedPaths: ["plugins/orchestration-workflows/supervisor-scheduler.ts"],
      protectedPathOutcome: "requires-human",
      protectedPaths: ["plugins/orchestration-workflows/supervisor-scheduler.ts"],
      deniedPaths: [],
      protectedPathAuditExpectations: [
        "Attach the changed paths, the approving human, and the reason for the exception before continuing."
      ],
      targetRef: "epic/supervisor-alpha",
      budgetUsagePercent: undefined,
      budgetThresholdPercent: undefined
    });
    expect(decision.thresholdEvents).toEqual([
      {
        eventId: "approval-gates:lane-1:merge:true:merge-pull-request-14",
        guardrail: "approval-gates",
        thresholdKey: "merge-boundary",
        status: "triggered",
        thresholdValue: true,
        observedValue: true,
        reasonCode: "approval.protected-path-review",
        summary: "Approval is required at the merge governance boundary for merge pull request #14.",
        evidence: decision.decisionEvidence
      }
    ]);
  });

  it("resumes only after an explicit approval signal arrives", () => {
    // Arrange
    const existingApproval = {
      approvalId: "lane-1:merge:merge-pull-request-14",
      laneId: "lane-1",
      status: "pending" as const,
      boundary: "merge" as const,
      requestedAction: "merge pull request #14",
      summary: "Pause before merging the lane PR into the alpha base branch.",
      rationale: "Merges widen the shipped automation surface and need an explicit human checkpoint.",
      requestedBy: "supervisor",
      requestedAt: "2026-03-13T16:00:00.000Z",
      updatedAt: "2026-03-13T16:00:00.000Z",
      context: {
        changedPaths: ["plugins/orchestration-workflows/supervisor-scheduler.ts"],
        targetRef: "epic/supervisor-alpha"
      }
    };

    // Act
    const decision = evaluateSupervisorApprovalGate({
      laneId: "lane-1",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:05:00.000Z",
      request: {
        approvalId: existingApproval.approvalId,
        boundary: "merge",
        requestedAction: "merge pull request #14",
        summary: existingApproval.summary,
        rationale: existingApproval.rationale,
        context: existingApproval.context
      },
      existingApproval,
      signal: {
        status: "approved",
        actor: "marceltuinstra",
        occurredAt: "2026-03-13T16:06:00.000Z",
        note: "Validated and approved for merge."
      }
    });

    // Assert
    expect(decision.status).toBe("approved");
    expect(decision.nextAction).toBe("resume");
    expect(decision.approval).toMatchObject({
      status: "approved",
      decidedBy: "marceltuinstra",
      decidedAt: "2026-03-13T16:06:00.000Z",
      decisionNote: "Validated and approved for merge."
    });
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual(["approval.resume-approved"]);
    expect(decision.thresholdEvents[0]?.reasonCode).toBe("approval.protected-path-review");
  });

  it("records when a request stays inside the static autonomy boundary", () => {
    // Arrange

    // Act
    const decision = evaluateSupervisorApprovalGate({
      laneId: "lane-2",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:10:00.000Z",
      request: {
        boundary: "automation-widening",
        requestedAction: "keep the current automation surface",
        summary: "No widening is requested.",
        rationale: "This step stays within the existing beta guardrails.",
        requiresApproval: false
      }
    });

    // Assert
    expect(decision.status).toBe("not-required");
    expect(decision.nextAction).toBe("continue");
    expect(decision.thresholdEvents).toEqual([
      {
        eventId: "approval-gates:lane-2:automation-widening:false:keep-the-current-automation-surface",
        guardrail: "approval-gates",
        thresholdKey: "automation-widening-boundary",
        status: "within-threshold",
        thresholdValue: true,
        observedValue: false,
        reasonCode: undefined,
        summary: "Approval is not required at the automation-widening governance boundary for keep the current automation surface.",
        evidence: decision.decisionEvidence
      }
    ]);
  });

  it("records protected-path evidence for autonomous write requests", () => {
    // Arrange

    // Act
    const decision = evaluateSupervisorApprovalGate({
      laneId: "lane-3",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:15:00.000Z",
      request: {
        boundary: "write",
        requestedAction: "write generated config",
        summary: "Write a generated file inside the guarded orchestration surface.",
        rationale: "This write needs protected-path evidence before the supervisor can continue.",
        context: {
          changedPaths: ["plugins/orchestration-workflows/governance-policy.ts"]
        }
      }
    });

    // Assert
    expect(decision.requiresApproval).toBe(true);
    expect(decision.decisionEvidence).toEqual({
      boundary: "write",
      policyRequiresApproval: false,
      requestOverrideApplied: false,
      effectiveRequiresApproval: true,
      changedPaths: ["plugins/orchestration-workflows/governance-policy.ts"],
      protectedPathOutcome: "requires-human",
      protectedPaths: ["plugins/orchestration-workflows/governance-policy.ts"],
      deniedPaths: [],
      protectedPathAuditExpectations: [
        "Attach the changed paths, the approving human, and the reason for the exception before continuing."
      ],
      targetRef: undefined,
      budgetUsagePercent: undefined,
      budgetThresholdPercent: undefined
    });
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual([
      "approval.protected-path-review",
      "approval.governance-boundary"
    ]);
    expect(decision.thresholdEvents[0]?.reasonCode).toBe("approval.protected-path-review");
  });
});
