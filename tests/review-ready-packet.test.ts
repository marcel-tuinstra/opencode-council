import { describe, expect, it } from "vitest";
import {
  assertReviewReadyTransition,
  createReviewReadyEvidencePacket,
  type ReviewReadyEvidencePacketInput
} from "../plugins/orchestration-workflows/review-ready-packet";

const buildPacket = (): ReviewReadyEvidencePacketInput => ({
  acceptanceCriteriaTrace: [
    {
      requirement: "Lane cannot move to review-ready without the required packet.",
      evidence: "tests/review-ready-packet.test.ts",
      status: "done" as const
    }
  ],
  scopedDiffSummary: [
    "Added a typed helper that validates the minimum review-ready packet before lifecycle transitions."
  ],
  verificationResults: [
    {
      check: "npm test",
      result: "pass" as const,
      notes: "Covers the new packet helper and lifecycle guard cases."
    }
  ],
  riskRollbackNotes: [
    "Rollback by removing the helper export if downstream callers are not ready to adopt the guard yet."
  ],
  handoff: {
    laneId: "lane-7",
    currentOwner: "DEV",
    nextOwner: "REVIEWER",
    transferScope: "review",
    transferTrigger: "Implementation and targeted validation are complete.",
    deltaSummary: "Added typed review-ready packet enforcement and tests.",
    risks: ["Downstream lifecycle callers must supply the packet before moving a lane to review-ready."],
    nextRequiredEvidence: ["Review the packet helper output alongside the new tests."],
    evidenceAttached: ["tests/review-ready-packet.test.ts"]
  },
  laneOutput: {
    runId: "run-440",
    laneId: "lane-7",
    status: "ready" as const,
    handoff: {
      laneId: "lane-7",
      currentOwner: "DEV",
      nextOwner: "REVIEWER",
      transferScope: "review" as const,
      transferTrigger: "Implementation and targeted validation are complete.",
      deltaSummary: "Added typed review-ready packet enforcement and tests.",
      risks: ["Downstream lifecycle callers must supply the packet before moving a lane to review-ready."],
      nextRequiredEvidence: ["Review the packet helper output alongside the new tests."],
      evidenceAttached: ["tests/review-ready-packet.test.ts"]
    },
    artifacts: [
      {
        laneId: "lane-7",
        kind: "branch" as const,
        uri: "refs/heads/marceltuinstra/sc-440-lane-contract",
        label: "Lane branch"
      },
      {
        laneId: "lane-7",
        kind: "review-packet" as const,
        uri: "docs/review-packets/run-440-lane-7.md",
        label: "Review packet"
      }
    ],
    evidence: ["npm test"],
    producedAt: "2026-03-13T13:00:00.000Z"
  },
  ownership: {
    reviewerOwner: "REVIEWER",
    mergeOwner: "Marcel Tuinstra",
    followUpOwner: "DEV"
  }
});

describe("review-ready-packet", () => {
  it("normalizes the minimum five-part review-ready packet", () => {
    // Arrange

    // Act
    const packet = createReviewReadyEvidencePacket(buildPacket());

    // Assert
    expect(packet.acceptanceCriteriaTrace).toHaveLength(1);
    expect(packet.scopedDiffSummary).toEqual([
      "Added a typed helper that validates the minimum review-ready packet before lifecycle transitions."
    ]);
    expect(packet.verificationResults[0]?.result).toBe("pass");
    expect(packet.riskRollbackNotes).toEqual([
      "Rollback by removing the helper export if downstream callers are not ready to adopt the guard yet."
    ]);
    expect(packet.handoff.nextOwner).toBe("REVIEWER");
    expect(packet.laneOutput?.artifacts).toHaveLength(2);
    expect(packet.ownership).toEqual({
      reviewerOwner: "REVIEWER",
      mergeOwner: "Marcel Tuinstra",
      followUpOwner: "DEV"
    });
  });

  it("blocks review-ready transitions when the packet is missing", () => {
    // Arrange

    // Act / Assert
    expect(() => assertReviewReadyTransition("active", "review_ready")).toThrow(
      "Lane transition to review_ready requires a review-ready evidence packet."
    );
  });

  it("blocks review-ready transitions when a required packet section is empty", () => {
    // Arrange

    // Act / Assert
    expect(() => assertReviewReadyTransition("waiting", "review_ready", {
      ...buildPacket(),
      scopedDiffSummary: []
    })).toThrow("Review-ready evidence packet requires at least one scoped diff summary item.");
  });

  it("blocks review-ready packets when the lane output handoff drifts from the packet handoff", () => {
    // Arrange

    // Act / Assert
    expect(() => createReviewReadyEvidencePacket({
      ...buildPacket(),
      laneOutput: {
        ...buildPacket().laneOutput!,
        handoff: {
          ...buildPacket().laneOutput!.handoff,
          nextOwner: "PM"
        }
      }
    })).toThrow("Review-ready evidence packet requires laneOutput.handoff to match the explicit handoff contract.");
  });

  it("allows non-review-ready transitions without a packet", () => {
    // Arrange

    // Act
    const result = assertReviewReadyTransition("review_ready", "complete");

    // Assert
    expect(result).toBeUndefined();
  });
});
