import { describe, expect, it } from "vitest";
import {
  assertActiveLaneCountWithinPolicy,
  assertLaneStateTransition,
  canTransitionLaneState,
  countsTowardActiveLaneCap,
  getAllowedLaneTransitions,
  getDefaultActiveLaneCap,
  resolveLanePolicy
} from "../plugins/orchestration-workflows/lane-lifecycle";

describe("lane-lifecycle", () => {
  it("uses the conservative default active lane cap for each repo risk tier", () => {
    // Arrange

    // Act
    const smallHighRiskCap = getDefaultActiveLaneCap("small-high-risk");
    const mediumModerateRiskCap = getDefaultActiveLaneCap("medium-moderate-risk");
    const largeMatureCap = getDefaultActiveLaneCap("large-mature");

    // Assert
    expect(smallHighRiskCap).toBe(2);
    expect(mediumModerateRiskCap).toBe(3);
    expect(largeMatureCap).toBe(4);
  });

  it("only counts active lanes against the active lane cap", () => {
    // Arrange

    // Act
    const plannedCounts = countsTowardActiveLaneCap("planned");
    const activeCounts = countsTowardActiveLaneCap("active");
    const waitingCounts = countsTowardActiveLaneCap("waiting");
    const reviewReadyCounts = countsTowardActiveLaneCap("review_ready");
    const completeCounts = countsTowardActiveLaneCap("complete");

    // Assert
    expect(plannedCounts).toBe(false);
    expect(activeCounts).toBe(true);
    expect(waitingCounts).toBe(false);
    expect(reviewReadyCounts).toBe(false);
    expect(completeCounts).toBe(false);
  });

  it("keeps lane lifecycle transitions deterministic and review-oriented", () => {
    // Arrange

    // Act
    const plannedTransitions = getAllowedLaneTransitions("planned");
    const activeToReviewReady = canTransitionLaneState("active", "review_ready");
    const reviewReadyToComplete = canTransitionLaneState("review_ready", "complete");
    const activeToComplete = canTransitionLaneState("active", "complete");

    // Assert
    expect(plannedTransitions).toEqual(["active"]);
    expect(activeToReviewReady).toBe(true);
    expect(reviewReadyToComplete).toBe(true);
    expect(activeToComplete).toBe(false);
  });

  it("fails invalid lifecycle transitions with an auditable error", () => {
    // Arrange

    // Act / Assert
    expect(() => assertLaneStateTransition("planned", "review_ready")).toThrow(
      "Invalid lane state transition: planned -> review_ready"
    );
  });

  it("allows lane cap overrides only through explicit configuration", () => {
    // Arrange

    // Act
    const defaultPolicy = resolveLanePolicy("medium-moderate-risk");
    const overriddenPolicy = resolveLanePolicy("medium-moderate-risk", { maxActiveLanes: 2 });

    // Assert
    expect(defaultPolicy.maxActiveLanes).toBe(3);
    expect(defaultPolicy.overrideSource).toBe("default");
    expect(overriddenPolicy.maxActiveLanes).toBe(2);
    expect(overriddenPolicy.overrideSource).toBe("explicit-config");
  });

  it("blocks unsafe active lane expansion past the resolved policy cap", () => {
    // Arrange
    const policy = resolveLanePolicy("small-high-risk");

    // Act / Assert
    expect(() => assertActiveLaneCountWithinPolicy(2, policy)).not.toThrow();
    expect(() => assertActiveLaneCountWithinPolicy(3, policy)).toThrow(
      "Active lane cap exceeded: 3 active lanes exceeds cap 2 for small-high-risk"
    );
  });
});
