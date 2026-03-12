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
    expect(getDefaultActiveLaneCap("small-high-risk")).toBe(2);
    expect(getDefaultActiveLaneCap("medium-moderate-risk")).toBe(3);
    expect(getDefaultActiveLaneCap("large-mature")).toBe(4);
  });

  it("only counts active lanes against the active lane cap", () => {
    expect(countsTowardActiveLaneCap("planned")).toBe(false);
    expect(countsTowardActiveLaneCap("active")).toBe(true);
    expect(countsTowardActiveLaneCap("waiting")).toBe(false);
    expect(countsTowardActiveLaneCap("review_ready")).toBe(false);
    expect(countsTowardActiveLaneCap("complete")).toBe(false);
  });

  it("keeps lane lifecycle transitions deterministic and review-oriented", () => {
    expect(getAllowedLaneTransitions("planned")).toEqual(["active"]);
    expect(canTransitionLaneState("active", "review_ready")).toBe(true);
    expect(canTransitionLaneState("review_ready", "complete")).toBe(true);
    expect(canTransitionLaneState("active", "complete")).toBe(false);
  });

  it("fails invalid lifecycle transitions with an auditable error", () => {
    expect(() => assertLaneStateTransition("planned", "review_ready")).toThrow(
      "Invalid lane state transition: planned -> review_ready"
    );
  });

  it("allows lane cap overrides only through explicit configuration", () => {
    const defaultPolicy = resolveLanePolicy("medium-moderate-risk");
    const overriddenPolicy = resolveLanePolicy("medium-moderate-risk", { maxActiveLanes: 2 });

    expect(defaultPolicy.maxActiveLanes).toBe(3);
    expect(defaultPolicy.overrideSource).toBe("default");
    expect(overriddenPolicy.maxActiveLanes).toBe(2);
    expect(overriddenPolicy.overrideSource).toBe("explicit-config");
  });

  it("blocks unsafe active lane expansion past the resolved policy cap", () => {
    const policy = resolveLanePolicy("small-high-risk");

    expect(() => assertActiveLaneCountWithinPolicy(2, policy)).not.toThrow();
    expect(() => assertActiveLaneCountWithinPolicy(3, policy)).toThrow(
      "Active lane cap exceeded: 3 active lanes exceeds cap 2 for small-high-risk"
    );
  });
});
