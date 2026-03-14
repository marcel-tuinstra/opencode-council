import { describe, expect, it } from "vitest";
import type { LaneContractViolation } from "../plugins/orchestration-workflows/lane-contract";
import { evaluateGovernancePolicy } from "../plugins/orchestration-workflows/governance-policy";
import { resolveSupervisorPolicy } from "../plugins/orchestration-workflows/supervisor-config";

describe("governance-policy", () => {
  it("fails closed when an explicit review-ready rule escalates a checkpoint", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.governance;
    const violations: LaneContractViolation[] = [{
      code: "review-owner-mismatch",
      field: "ownership.reviewerOwner",
      message: "Review checkpoint owner must match the handoff owner."
    }];

    // Act
    const decision = evaluateGovernancePolicy({
      checkpoint: "review-ready",
      violations,
      policy
    });

    // Assert
    expect(decision).toMatchObject({
      checkpoint: "review-ready",
      outcome: "escalate",
      route: "escalate-review",
      source: "explicit-policy",
      policyConfigured: true,
      matchedRules: [{ ruleId: "review-owner-mismatch-escalate", outcome: "escalate" }]
    });
    expect(decision.reasons[0]).toContain("explicit governance policy");
  });

  it("fails open with a warning when the checkpoint has no configured policy", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.governance;

    // Act
    const decision = evaluateGovernancePolicy({
      checkpoint: "unknown-checkpoint",
      policy
    });

    // Assert
    expect(decision).toMatchObject({
      checkpoint: "unknown-checkpoint",
      outcome: "accept",
      route: "continue",
      source: "missing-policy",
      policyConfigured: false
    });
    expect(decision.warnings).toEqual([
      "No governance policy is configured for checkpoint 'unknown-checkpoint', so the evaluator recorded a warning and failed open."
    ]);
  });

  it("uses the configured checkpoint default when no explicit rule matches", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.governance;
    const violations: LaneContractViolation[] = [{
      code: "some-unmapped-violation",
      field: "artifacts",
      message: "This violation is intentionally left unmapped."
    }];

    // Act
    const decision = evaluateGovernancePolicy({
      checkpoint: "review-ready",
      violations,
      policy
    });

    // Assert
    expect(decision).toMatchObject({
      checkpoint: "review-ready",
      outcome: "accept",
      route: "continue",
      source: "policy-default",
      policyConfigured: true,
      policyDefaultOutcome: "accept",
      matchedRules: []
    });
    expect(decision.reasons[0]).toContain("configured default routed the checkpoint to accept");
  });

  it("resolves custom governance checkpoint rules from supervisor config", () => {
    // Arrange
    const policy = resolveSupervisorPolicy({
      governance: {
        checkpoints: [{
          checkpoint: "review-ready",
          defaultOutcome: "repair",
          rules: [{
            ruleId: "field-block",
            description: "Block this field mismatch.",
            match: {
              violationFields: ["ownership.reviewerOwner"]
            },
            outcome: "block"
          }]
        }]
      }
    }).config.governance;
    const violations: LaneContractViolation[] = [{
      code: "review-owner-mismatch",
      field: "ownership.reviewerOwner",
      message: "Review checkpoint owner must match the handoff owner."
    }];

    // Act
    const decision = evaluateGovernancePolicy({
      checkpoint: "review-ready",
      violations,
      policy
    });

    // Assert
    expect(decision).toMatchObject({
      checkpoint: "review-ready",
      outcome: "block",
      route: "block-checkpoint",
      source: "explicit-policy",
      policyDefaultOutcome: "repair",
      matchedRules: [{
        ruleId: "field-block",
        outcome: "block",
        matchedViolationFields: ["ownership.reviewerOwner"]
      }]
    });
  });

  it("routes protected-path violations through the default governance policy", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.governance;
    const violations: LaneContractViolation[] = [{
      code: "protected-path-denied",
      field: "changedPaths",
      message: "Protected-path policy denied the requested path."
    }];

    // Act
    const decision = evaluateGovernancePolicy({
      checkpoint: "review-ready",
      violations,
      policy
    });

    // Assert
    expect(decision).toMatchObject({
      checkpoint: "review-ready",
      outcome: "block",
      route: "block-checkpoint",
      source: "explicit-policy",
      matchedRules: [{ ruleId: "protected-path-deny-block", outcome: "block" }]
    });
  });
});
