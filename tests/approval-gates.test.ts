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
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual(["approval.governance-boundary"]);
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
  });
});
