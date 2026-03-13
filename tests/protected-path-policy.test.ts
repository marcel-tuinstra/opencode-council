import { describe, expect, it } from "vitest";
import { evaluateProtectedPathPolicy } from "../plugins/orchestration-workflows/protected-path-policy";
import { resolveSupervisorPolicy } from "../plugins/orchestration-workflows/supervisor-config";

describe("protected-path-policy", () => {
  it("allows low-risk paths by default while keeping the policy fail-closed", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.protectedPaths;

    // Act
    const decision = evaluateProtectedPathPolicy([
      "docs/runbooks/merge-policy.md",
      "tests/merge-policy.test.ts"
    ], policy);

    // Assert
    expect(decision).toMatchObject({
      outcome: "allow",
      allowedPaths: [
        "docs/runbooks/merge-policy.md",
        "tests/merge-policy.test.ts"
      ],
      requiresHumanPaths: [],
      deniedPaths: [],
      violationCodes: []
    });
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual(["approval.protected-path-allowed"]);
  });

  it("requires a human exception for supervisor governance files and records audit expectations", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.protectedPaths;

    // Act
    const decision = evaluateProtectedPathPolicy([
      "plugins/orchestration-workflows/merge-policy.ts"
    ], policy);

    // Assert
    expect(decision).toMatchObject({
      outcome: "requires-human",
      requiresHumanPaths: ["plugins/orchestration-workflows/merge-policy.ts"],
      deniedPaths: [],
      violationCodes: ["protected-path-requires-human"]
    });
    expect(decision.auditExpectations).toEqual([
      "Attach the changed paths, the approving human, and the reason for the exception before continuing."
    ]);
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual(["approval.protected-path-review"]);
  });

  it("denies secret-bearing paths even when a broader allow rule matches", () => {
    // Arrange
    const policy = resolveSupervisorPolicy(undefined).config.protectedPaths;

    // Act
    const decision = evaluateProtectedPathPolicy([
      "secrets/production.env",
      "docs/runbooks/merge-policy.md"
    ], policy);

    // Assert
    expect(decision).toMatchObject({
      outcome: "deny",
      allowedPaths: ["docs/runbooks/merge-policy.md"],
      deniedPaths: ["secrets/production.env"],
      violationCodes: ["protected-path-denied"]
    });
    expect(decision.reasonDetails.map((detail) => detail.code)).toEqual(["approval.protected-path-denied"]);
  });
});
