import { describe, expect, it } from "vitest";
import {
  DEFAULT_HARD_STOP_THRESHOLD_PERCENT,
  evaluateBudgetGovernance,
  resolveBudgetGovernancePolicy
} from "../plugins/orchestration-workflows/budget-governance";

describe("budget-governance", () => {
  it("defaults to soft governance with warning thresholds and no hard stop", () => {
    // Arrange

    // Act
    const policy = resolveBudgetGovernancePolicy();
    const decision = evaluateBudgetGovernance(policy, {
      scope: "run",
      usedTokens: 5120,
      budgetTokens: 6400
    });

    // Assert
    expect(policy.hardStopEnabled).toBe(false);
    expect(policy.defaultHardStopEnabled).toBe(false);
    expect(policy.warningThresholdPercents).toEqual([75, 90, 110]);
    expect(policy.hardStopThresholdPercent).toBe(130);
    expect(policy.overrideSource).toBe("default");
    expect(decision.status).toBe("warning");
    expect(decision.triggeredThresholds).toEqual([
      {
        kind: "warning",
        usagePercent: 75,
        reason: "run usage crossed the early warning threshold and should stay under watch."
      }
    ]);
    expect(decision.reasonDetails).toEqual([
      {
        code: "budget.warning-threshold",
        category: "budget-escalation",
        short: "Budget warning threshold crossed.",
        explanation: "Budget usage reached 80% and stayed in warning mode, so execution can continue under watch."
      }
    ]);
    expect(decision.decisionEvidence).toEqual({
      overrideSource: "default",
      hardStopEnabled: false,
      warningThresholdPercents: [75, 90, 110],
      escalationThresholdPercent: 110,
      hardStopThresholdPercent: 130,
      usedTokens: 5120,
      budgetTokens: 6400,
      usagePercent: 80
    });
    expect(decision.thresholdEvents).toEqual([
      {
        eventId: "budget-governance:run:warning:75:80",
        guardrail: "budget-governance",
        thresholdKey: "run-warning-percent",
        status: "triggered",
        thresholdValue: 75,
        observedValue: 80,
        reasonCode: "budget.warning-threshold",
        summary: "run usage crossed the early warning threshold and should stay under watch.",
        evidence: decision.decisionEvidence
      }
    ]);
    expect(decision.recommendations).toEqual(["continue-with-watch", "compact-context"]);
    expect(decision.shouldPauseAutomation).toBe(false);
  });

  it("requires escalation past 120% when hard stop is disabled", () => {
    // Arrange

    // Act
    const policy = resolveBudgetGovernancePolicy();
    const decision = evaluateBudgetGovernance(policy, {
      scope: "step",
      usedTokens: 3361,
      budgetTokens: 2800
    });

    // Assert
    expect(decision.status).toBe("escalation-required");
    expect(decision.requiredActions).toEqual([
      "justify-budget-overrun",
      "record-scope-or-lane-reduction",
      "schedule-checkpoint-review"
    ]);
    expect(decision.recommendations).toEqual([
      "reduce-scope",
      "reduce-active-lanes",
      "request-checkpoint-review",
      "enable-hard-stop-for-runaway-risk"
    ]);
    expect(decision.reasonDetails).toEqual([
      {
        code: "budget.escalation-required",
        category: "budget-escalation",
        short: "Budget escalation required.",
        explanation: "Budget usage reached 120.04% and now requires checkpoint review before more automation continues."
      }
    ]);
    expect(decision.thresholdEvents.map((event) => event.reasonCode)).toEqual([
      "budget.warning-threshold",
      "budget.warning-threshold",
      "budget.escalation-required"
    ]);
    expect(decision.shouldPauseAutomation).toBe(true);
  });

  it("keeps hard stop as explicit opt-in runaway protection", () => {
    // Arrange
    const policy = resolveBudgetGovernancePolicy({ hardStopEnabled: true });

    // Act
    const decision = evaluateBudgetGovernance(policy, {
      scope: "run",
      usedTokens: 8400,
      budgetTokens: 6400
    });

    // Assert
    expect(policy.overrideSource).toBe("explicit-config");
    expect(decision.status).toBe("hard-stop");
    expect(decision.triggeredThresholds.at(-1)).toEqual({
      kind: "hard-stop",
      usagePercent: 130,
      reason: "run usage reached the explicit hard-stop runaway threshold."
    });
    expect(decision.reasonDetails).toEqual([
      {
        code: "budget.hard-stop",
        category: "budget-escalation",
        short: "Budget hard stop triggered.",
        explanation: "Budget usage reached 131.25% and hit the configured hard stop, so automation pauses here."
      }
    ]);
    expect(decision.thresholdEvents.at(-1)).toEqual({
      eventId: "budget-governance:run:hard-stop:130:131-25",
      guardrail: "budget-governance",
      thresholdKey: "run-hard-stop-percent",
      status: "triggered",
      thresholdValue: 130,
      observedValue: 131.25,
      reasonCode: "budget.hard-stop",
      summary: "run usage reached the explicit hard-stop runaway threshold.",
      evidence: decision.decisionEvidence
    });
    expect(decision.shouldPauseAutomation).toBe(true);
  });

  it("rejects invalid budget inputs and inverted thresholds", () => {
    // Arrange

    // Act / Assert
    expect(() => resolveBudgetGovernancePolicy({
      escalationThresholdPercent: 120,
      hardStopThresholdPercent: 110
    })).toThrow(
      "Hard-stop threshold must be greater than or equal to escalation threshold; received 110 < 120."
    );

    const policy = resolveBudgetGovernancePolicy();
    expect(() => evaluateBudgetGovernance(policy, {
      scope: "run",
      usedTokens: -1,
      budgetTokens: 6400
    })).toThrow("Invalid used token count: -1");
  });
});
