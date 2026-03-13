import { describe, expect, it } from "vitest";
import {
  assertValidLaneCompletionContract,
  createLaneCompletionContract,
  evaluateLaneCompletionContract,
  validateLaneCompletionContract
} from "../plugins/orchestration-workflows/lane-contract";

const buildContract = () => createLaneCompletionContract({
  runId: "run-440",
  laneId: "lane-1",
  status: "ready",
  handoff: {
    laneId: "lane-1",
    currentOwner: "DEV",
    nextOwner: "REVIEWER",
    transferScope: "review",
    transferTrigger: "Implementation and validation are complete.",
    deltaSummary: "Added typed lane output handoff validation.",
    risks: ["Review tooling depends on the new typed contract."],
    nextRequiredEvidence: ["PR body", "targeted tests"],
    evidenceAttached: ["tests/lane-contract.test.ts"]
  },
  artifacts: [
    {
      laneId: "lane-1",
      kind: "branch",
      uri: "refs/heads/marceltuinstra/sc-440-lane-contract",
      label: "Lane branch"
    },
    {
      laneId: "lane-1",
      kind: "review-packet",
      uri: "docs/review-packets/run-440-lane-1.md",
      label: "Review packet"
    }
  ],
  evidence: ["npm test", "npm run typecheck"],
  producedAt: "2026-03-13T13:00:00.000Z"
});

describe("lane-contract", () => {
  it("creates and validates a ready lane completion contract", () => {
    // Arrange

    // Act
    const contract = buildContract();
    const validation = validateLaneCompletionContract(contract);

    // Assert
    expect(contract.contractVersion).toBe("v1");
    expect(contract.artifacts).toHaveLength(2);
    expect(validation).toEqual({
      valid: true,
      violations: []
    });
  });

  it("rejects mismatched lane ids and missing required artifacts", () => {
    // Arrange
    const contract = createLaneCompletionContract({
      ...buildContract(),
      artifacts: [
        {
          laneId: "lane-other",
          kind: "validation",
          uri: "artifacts/run-440/validation.txt",
          label: "Validation"
        }
      ]
    });

    // Act
    const validation = validateLaneCompletionContract(contract);

    // Assert
    expect(validation.valid).toBe(false);
    expect(validation.violations.map((violation) => violation.code)).toEqual([
      "artifact-lane-mismatch",
      "missing-branch-artifact",
      "missing-review-packet-artifact"
    ]);
  });

  it("fails closed for blocked contracts without blocking issues", () => {
    // Arrange / Act / Assert
    expect(() => assertValidLaneCompletionContract({
      ...buildContract(),
      status: "blocked"
    })).toThrow("Blocked lane completion contracts require at least one blocking issue.");
  });

  it("classifies unexpected blocking issues on ready contracts as escalation", () => {
    // Arrange
    const contract = createLaneCompletionContract({
      ...buildContract(),
      blockingIssues: ["Human decision still required."]
    });

    // Act
    const evaluation = evaluateLaneCompletionContract(contract);

    // Assert
    expect(evaluation.valid).toBe(false);
    expect(evaluation.outcome).toBe("escalate");
    expect(evaluation.violations.map((violation) => violation.code)).toEqual(["unexpected-blocking-issues"]);
  });
});
