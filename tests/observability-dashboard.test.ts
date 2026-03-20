import { describe, expect, it } from "vitest";
import {
  evaluateBudgetGovernance,
  resolveBudgetGovernancePolicy
} from "../plugins/orchestration-workflows/budget-governance";
import {
  evaluateSupervisorApprovalGate,
} from "../plugins/orchestration-workflows/approval-gates";
import {
  createSupervisorObservabilityDashboard,
  resolveHeartbeatHealth
} from "../plugins/orchestration-workflows/observability-dashboard";
import { routeSupervisorWorkUnit } from "../plugins/orchestration-workflows/supervisor-routing";
import { createLaneTurnHandoffContract } from "../plugins/orchestration-workflows/turn-ownership";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("observability-dashboard", () => {
  it("aggregates lane, heartbeat, blocker, budget, policy, and ownership signals into one snapshot", () => {
    // Arrange
    const budgetPolicy = resolveBudgetGovernancePolicy();
    const laneOneHandoff = createLaneTurnHandoffContract({
      laneId: "lane-1",
      currentOwner: "DEV",
      nextOwner: "TESTER",
      transferScope: "test",
      transferTrigger: "Implementation finished.",
      deltaSummary: "Lane 1 is ready for validation.",
      risks: ["Tester still needs to confirm one integration path."],
      nextRequiredEvidence: ["Attach targeted validation notes."],
      evidenceAttached: ["tests/observability-dashboard.test.ts"]
    });
    const laneTwoHandoffOne = createLaneTurnHandoffContract({
      laneId: "lane-2",
      currentOwner: "DEV",
      nextOwner: "TESTER",
      transferScope: "test",
      transferTrigger: "Initial implementation finished.",
      deltaSummary: "Lane 2 is ready for tester review.",
      risks: ["Budget is running hot."],
      nextRequiredEvidence: ["Confirm the blocker cause."],
      evidenceAttached: ["tests/observability-dashboard.test.ts"]
    });
    const laneTwoHandoffTwo = createLaneTurnHandoffContract({
      laneId: "lane-2",
      currentOwner: "TESTER",
      nextOwner: "DEV",
      transferScope: "implementation",
      transferTrigger: "Tester found a follow-up fix.",
      deltaSummary: "Lane 2 returned to development for blocker cleanup.",
      risks: ["The blocker could delay pilot review."],
      nextRequiredEvidence: ["Add the blocker resolution note."],
      evidenceAttached: ["tests/observability-dashboard.test.ts"]
    });
    const withinBudgetDecision = evaluateBudgetGovernance(budgetPolicy, {
      scope: "run",
      usedTokens: 3200,
      budgetTokens: 6400
    });
    const escalationDecision = evaluateBudgetGovernance(budgetPolicy, {
      scope: "step",
      usedTokens: 3400,
      budgetTokens: 2800
    });
    const approvalDecision = evaluateSupervisorApprovalGate({
      laneId: "lane-2",
      actor: "supervisor",
      occurredAt: "2026-03-12T11:59:35.000Z",
      request: {
        boundary: "budget-exception",
        requestedAction: "continue the lane despite the overrun",
        summary: "Budget crossed the escalation threshold.",
        rationale: "The lane needs an explicit human checkpoint before it keeps spending.",
        context: {
          budgetUsagePercent: escalationDecision.usagePercent,
          budgetThresholdPercent: escalationDecision.decisionEvidence.escalationThresholdPercent
        }
      }
    });
    const routingDecision = routeSupervisorWorkUnit({
      workUnitId: "wu-low-confidence",
      workUnit: normalizeWorkUnit({
        objective: "General follow-up",
        source: {
          kind: "ad-hoc",
          title: "General follow-up"
        }
      })
    });

    // Act
    const snapshot = createSupervisorObservabilityDashboard({
      runId: "run-obs-1",
      generatedAt: "2026-03-12T12:00:00.000Z",
      lanes: [
        {
          laneId: "lane-1",
          state: "active",
          session: {
            sessionId: "session-1",
            lastHeartbeatAt: "2026-03-12T11:59:10.000Z",
            staleAfterMs: 120000
          },
          blocker: {
            status: "clear",
            summary: "No active blocker.",
            updatedAt: "2026-03-12T11:58:00.000Z"
          },
          budget: withinBudgetDecision,
          budgetEvaluatedAt: "2026-03-12T11:59:30.000Z",
          ownershipTransitions: [laneOneHandoff],
          policyDecisions: [
            {
              category: "review-ready-packet",
              laneId: "lane-1",
              summary: "Evidence packet fields are complete.",
              outcome: "ready-for-review-when-tests-pass",
              occurredAt: "2026-03-12T11:57:00.000Z"
            }
          ]
        },
        {
          laneId: "lane-2",
          state: "waiting",
          session: {
            sessionId: "session-2",
            staleAfterMs: 120000
          },
          blocker: {
            status: "blocked",
            summary: "Waiting on a supervisor decision for budget overrun.",
            owner: "PM",
            updatedAt: "2026-03-12T11:59:50.000Z"
          },
          budget: escalationDecision,
          budgetEvaluatedAt: "2026-03-12T11:59:55.000Z",
          ownershipTransitions: [laneTwoHandoffOne, laneTwoHandoffTwo],
          policyDecisions: [
            {
              category: "budget-governance",
              laneId: "lane-2",
              summary: "Budget escalated beyond the soft threshold.",
              outcome: "checkpoint-review-required",
              occurredAt: "2026-03-12T11:59:40.000Z"
            },
            {
              category: "turn-ownership",
              laneId: "lane-2",
              summary: "Ownership returned to DEV for follow-up work.",
              outcome: "dev-reentry-approved",
              occurredAt: "2026-03-12T11:58:40.000Z"
            }
          ],
          thresholdEvents: [
            {
              occurredAt: "2026-03-12T11:59:35.000Z",
              event: approvalDecision.thresholdEvents[0]!
            },
            {
              occurredAt: "2026-03-12T11:58:20.000Z",
              event: routingDecision.thresholdEvents[0]!
            }
          ]
        },
        {
          laneId: "lane-3",
          state: "review_ready",
          session: {
            sessionId: "session-3",
            lastHeartbeatAt: "2026-03-12T11:54:00.000Z",
            staleAfterMs: 120000
          },
          blocker: {
            status: "clear",
            summary: "Awaiting reviewer pickup.",
            updatedAt: "2026-03-12T11:55:00.000Z"
          },
          policyDecisions: [
            {
              category: "lane-lifecycle",
              laneId: "lane-3",
              summary: "Lane advanced into review_ready with a complete packet.",
              outcome: "review-ready",
              occurredAt: "2026-03-12T11:56:30.000Z"
            }
          ]
        }
      ]
    });

    // Assert
    expect(snapshot.totals).toEqual({
      lanes: 3,
      byState: {
        planned: 0,
        active: 1,
        waiting: 1,
        review_ready: 1,
        complete: 0
      },
      healthySessions: 1,
      staleSessions: 1,
      missingSessions: 1,
      blockedLanes: 1,
      lanesWithinBudget: 1,
      warningLanes: 0,
      escalationLanes: 1,
      hardStopLanes: 0
    });
    expect(snapshot.escalationEvents).toEqual([
      {
        runId: "run-obs-1",
        laneId: "lane-2",
        sessionId: "session-2",
        status: "escalation-required",
        usagePercent: 121.43,
        occurredAt: "2026-03-12T11:59:55.000Z",
        summary: "step budget reached 121.43% and is escalation-required; next actions: reduce-scope, reduce-active-lanes, request-checkpoint-review, enable-hard-stop-for-runaway-risk."
      }
    ]);
    expect(snapshot.recentPolicyDecisions.map((decision) => decision.runId)).toEqual([
      "run-obs-1",
      "run-obs-1",
      "run-obs-1",
      "run-obs-1"
    ]);
    expect(snapshot.recentPolicyDecisions.map((decision) => decision.category)).toEqual([
      "budget-governance",
      "turn-ownership",
      "review-ready-packet",
      "lane-lifecycle"
    ]);
    expect(snapshot.recentThresholdEvents.map((event) => ({
      runId: event.runId,
      laneId: event.laneId,
      thresholdKey: event.thresholdKey,
      reasonCode: event.reasonCode,
      occurredAt: event.occurredAt
    }))).toEqual([
      {
        runId: "run-obs-1",
        laneId: "lane-2",
        thresholdKey: "step-warning-percent",
        reasonCode: "budget.warning-threshold",
        occurredAt: "2026-03-12T11:59:55.000Z"
      },
      {
        runId: "run-obs-1",
        laneId: "lane-2",
        thresholdKey: "step-warning-percent",
        reasonCode: "budget.warning-threshold",
        occurredAt: "2026-03-12T11:59:55.000Z"
      },
      {
        runId: "run-obs-1",
        laneId: "lane-2",
        thresholdKey: "step-escalation-percent",
        reasonCode: "budget.escalation-required",
        occurredAt: "2026-03-12T11:59:55.000Z"
      },
      {
        runId: "run-obs-1",
        laneId: "lane-2",
        thresholdKey: "budget-exception-boundary",
        reasonCode: "approval.governance-boundary",
        occurredAt: "2026-03-12T11:59:35.000Z"
      },
      {
        runId: "run-obs-1",
        laneId: "lane-2",
        thresholdKey: "minimum-signal-score",
        reasonCode: "fallback.low-confidence",
        occurredAt: "2026-03-12T11:58:20.000Z"
      }
    ]);
    expect(snapshot.recentOwnershipTransitions.map((handoff) => handoff.deltaSummary)).toEqual([
      "Lane 2 returned to development for blocker cleanup.",
      "Lane 2 is ready for tester review.",
      "Lane 1 is ready for validation."
    ]);
  });

  it("classifies heartbeat health for healthy, stale, and missing sessions", () => {
    // Arrange
    const generatedAt = "2026-03-12T12:00:00.000Z";

    // Act
    const healthy = resolveHeartbeatHealth(generatedAt, {
      sessionId: "session-healthy",
      lastHeartbeatAt: "2026-03-12T11:59:30.000Z",
      staleAfterMs: 120000
    });
    const stale = resolveHeartbeatHealth(generatedAt, {
      sessionId: "session-stale",
      lastHeartbeatAt: "2026-03-12T11:55:00.000Z",
      staleAfterMs: 120000
    });
    const missing = resolveHeartbeatHealth(generatedAt, {
      sessionId: "session-missing",
      staleAfterMs: 120000
    });

    // Assert
    expect(healthy).toEqual({
      sessionId: "session-healthy",
      health: "healthy",
      lastHeartbeatAt: "2026-03-12T11:59:30.000Z",
      staleAfterMs: 120000
    });
    expect(stale?.health).toBe("stale");
    expect(missing).toEqual({
      sessionId: "session-missing",
      health: "missing",
      staleAfterMs: 120000
    });
  });

  it("rejects invalid dashboard identifiers and timestamps", () => {
    // Arrange

    // Act / Assert
    expect(() => createSupervisorObservabilityDashboard({
      generatedAt: "not-a-date",
      lanes: []
    })).toThrow("Supervisor observability dashboard requires a valid generated timestamp.");
    expect(() => createSupervisorObservabilityDashboard({
      generatedAt: "2026-03-12T12:00:00.000Z",
      lanes: [
        {
          laneId: "   ",
          state: "active"
        }
      ]
    })).toThrow("Supervisor observability dashboard requires a non-empty lane id.");
  });
});
