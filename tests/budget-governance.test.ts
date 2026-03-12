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
    expect(policy.warningThresholdPercents).toEqual([80, 100, 120]);
    expect(policy.hardStopThresholdPercent).toBe(DEFAULT_HARD_STOP_THRESHOLD_PERCENT);
    expect(policy.overrideSource).toBe("default");
    expect(decision.status).toBe("warning");
    expect(decision.triggeredThresholds).toEqual([
      {
        kind: "warning",
        usagePercent: 80,
        reason: "run usage crossed the early warning threshold and should stay under watch."
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
      usagePercent: DEFAULT_HARD_STOP_THRESHOLD_PERCENT,
      reason: "run usage reached the explicit hard-stop runaway threshold."
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
