import { describe, expect, it } from "vitest";
import { createAdHocRunHistoryRecord } from "../plugins/orchestration-workflows/ad-hoc-run-history";
import { createSupervisorDataLifecycleReport } from "../plugins/orchestration-workflows/data-lifecycle";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("data-lifecycle", () => {
  it("fails closed for durable runs with active governance and evidence signals", () => {
    // Arrange
    const runState = {
      schemaVersion: 2 as const,
      run: {
        runId: "run-retain",
        status: "review_ready" as const,
        objective: "Keep review-ready runs retained until human checkpoints close.",
        sourceOfTruth: "control-plane-state" as const,
        createdAt: "2026-02-01T10:00:00.000Z",
        updatedAt: "2026-02-10T10:00:00.000Z"
      },
      lanes: [
        {
          laneId: "lane-1",
          state: "review_ready" as const,
          branch: "marceltuinstra/sc-353/lane-01",
          worktreeId: "wt-1",
          sessionId: "session-1",
          updatedAt: "2026-02-10T10:00:00.000Z"
        }
      ],
      worktrees: [
        {
          worktreeId: "wt-1",
          laneId: "lane-1",
          path: "/tmp/run-retain/lane-1",
          branch: "marceltuinstra/sc-353/lane-01",
          status: "active" as const,
          updatedAt: "2026-02-10T10:00:00.000Z"
        }
      ],
      sessions: [
        {
          sessionId: "session-1",
          laneId: "lane-1",
          worktreeId: "wt-1",
          status: "completed" as const,
          updatedAt: "2026-02-10T10:00:00.000Z"
        }
      ],
      childSessions: [],
      approvals: [
        {
          approvalId: "approval-1",
          laneId: "lane-1",
          status: "pending" as const,
          boundary: "merge" as const,
          requestedAction: "merge lane branch",
          summary: "Waiting for human merge approval.",
          rationale: "The lane is not allowed to merge autonomously.",
          requestedBy: "supervisor",
          requestedAt: "2026-02-10T10:00:00.000Z",
          updatedAt: "2026-02-10T10:00:00.000Z"
        }
      ],
      artifacts: [],
      appliedMutations: ["mutation-1"],
      auditLog: []
    };

    // Act
    const report = createSupervisorDataLifecycleReport({
      generatedAt: "2026-03-13T12:00:00.000Z",
      durableRuns: [
        {
          runState,
          unresolvedGovernance: true,
          reviewRouting: [
            {
              outcome: "escalate",
              reasons: ["Human governance checkpoint still needs a decider."],
              handoffValidationOutcome: "accepted",
              laneOutputStatus: "ready",
              policy: {
                applied: true,
                evaluator: "governance-policy:explicit-policy"
              }
            }
          ],
          thresholdEvents: [
            {
              laneId: "lane-1",
              occurredAt: "2026-02-10T10:00:00.000Z",
              eventId: "threshold-1",
              guardrail: "routing",
              thresholdKey: "minimum-signal-score",
              status: "triggered",
              thresholdValue: 0.75,
              observedValue: 0.41,
              reasonCode: "fallback.low-confidence",
              summary: "Routing confidence dropped below the minimum score.",
              evidence: {
                confidence: 0.41
              }
            }
          ]
        }
      ]
    });

    // Assert
    expect(report.totals).toEqual({
      durableRuns: 1,
      adHocRuns: 0,
      retain: 1,
      archiveReview: 0,
      deleteReview: 0
    });
    expect(report.durableRuns[0]).toMatchObject({
      recordType: "durable-run",
      recordId: "run-retain",
      currentStage: "active",
      nextStage: "archived",
      recommendation: "retain",
      blockers: [
        "run-status:review_ready",
        "pending-approvals",
        "unreleased-worktrees",
        "sessions-present",
        "unresolved-governance",
        "review-routing:escalate",
        "threshold:minimum-signal-score"
      ],
      inventory: {
        worktrees: 1,
        unreleasedWorktrees: 1,
        sessions: 1,
        retentionBlockingSessions: 1,
        pendingApprovals: 1,
        thresholdEvents: 1
      }
    });
  });

  it("marks quiet durable runs for archive or delete review by age window", () => {
    // Arrange
    const baseRunState = {
      schemaVersion: 2 as const,
      lanes: [],
      worktrees: [],
      sessions: [],
      childSessions: [],
      approvals: [],
      artifacts: [],
      appliedMutations: [],
      auditLog: []
    };

    // Act
    const report = createSupervisorDataLifecycleReport({
      generatedAt: "2026-03-13T12:00:00.000Z",
      durableRuns: [
        {
          runState: {
            ...baseRunState,
            run: {
              runId: "run-archive-review",
              status: "completed" as const,
              objective: "Archive older completed run state.",
              sourceOfTruth: "control-plane-state" as const,
              createdAt: "2026-01-01T12:00:00.000Z",
              updatedAt: "2026-02-01T12:00:00.000Z"
            }
          }
        },
        {
          runState: {
            ...baseRunState,
            run: {
              runId: "run-delete-review",
              status: "failed" as const,
              objective: "Delete very old failed run state after review.",
              sourceOfTruth: "control-plane-state" as const,
              createdAt: "2025-08-01T12:00:00.000Z",
              updatedAt: "2025-08-15T12:00:00.000Z"
            }
          }
        }
      ]
    });

    // Assert
    expect(report.durableRuns.map((run) => ({
      recordId: run.recordId,
      recommendation: run.recommendation,
      currentStage: run.currentStage,
      nextStage: run.nextStage
    }))).toEqual([
      {
        recordId: "run-archive-review",
        recommendation: "archive-review",
        currentStage: "archived",
        nextStage: "deleted"
      },
      {
        recordId: "run-delete-review",
        recommendation: "delete-review",
        currentStage: "archived",
        nextStage: "deleted"
      }
    ]);
  });

  it("reports ad-hoc run history inventory and delete-review candidates separately", () => {
    // Arrange
    const record = createAdHocRunHistoryRecord({
      workUnitId: "wu-1",
      workUnit: normalizeWorkUnit({
        objective: "Capture a one-off operator fix.",
        evidenceLinks: [
          {
            label: "Runbook",
            href: "https://example.com/runbook",
            kind: "runbook"
          }
        ],
        source: {
          kind: "ad-hoc",
          title: "Operator request",
          metadata: {}
        }
      }),
      repo: "github.com/example/platform",
      branch: "main",
      commitSet: ["abc123"],
      operator: "operator@example.com",
      createdAt: "2025-11-01T10:00:00.000Z",
      relatedArtifacts: [
        {
          label: "Follow-up notes",
          href: "https://example.com/notes",
          kind: "document"
        }
      ]
    });

    // Act
    const report = createSupervisorDataLifecycleReport({
      generatedAt: "2026-03-13T12:00:00.000Z",
      adHocRuns: [{ record }]
    });

    // Assert
    expect(report.policy.adHocRuns).toEqual({
      archiveReviewAfterDays: 14,
      deleteReviewAfterDays: 90
    });
    expect(report.adHocRuns[0]).toMatchObject({
      recordType: "ad-hoc-run",
      recordId: record.runId,
      currentStage: "archived",
      nextStage: "deleted",
      recommendation: "delete-review",
      blockers: [],
      inventory: {
        evidenceLinks: 1,
        relatedArtifacts: 1,
        thresholdEvents: 0
      }
    });
  });
});
