import { describe, expect, it } from "vitest";
import {
  createReviewCoordinationBundle,
  renderReviewCoordinationPullRequestBody,
  type ReviewCoordinationBundleInput
} from "../plugins/orchestration-workflows/review-coordination";

describe("review-coordination", () => {
  it("builds a review bundle that stays linked to the external tracker and originating run", () => {
    // Arrange
    const bundleInput: ReviewCoordinationBundleInput = {
      run: {
        runId: "run-400",
        status: "review_ready" as const,
        objective: "Prepare review coordination and PR metadata for alpha.",
        sourceOfTruth: "control-plane-state" as const,
        createdAt: "2026-03-13T12:00:00.000Z",
        updatedAt: "2026-03-13T12:10:00.000Z"
      },
      lane: {
        laneId: "lane-review",
        state: "review_ready" as const,
        branch: "marceltuinstra/sc-400-review-coordination-pr-prep",
        worktreeId: "wt-400",
        sessionId: "session-400",
        updatedAt: "2026-03-13T12:10:00.000Z"
      },
      worktree: {
        worktreeId: "wt-400",
        laneId: "lane-review",
        path: "/tmp/run-400/lane-review",
        branch: "marceltuinstra/sc-400-review-coordination-pr-prep",
        status: "active" as const,
        updatedAt: "2026-03-13T12:05:00.000Z"
      },
      session: {
        sessionId: "session-400",
        laneId: "lane-review",
        worktreeId: "wt-400",
        status: "active" as const,
        runtime: "opencode",
        owner: "marcel@tuinstra.dev",
        startedAt: "2026-03-13T12:03:00.000Z",
        lastHeartbeatAt: "2026-03-13T12:09:00.000Z",
        updatedAt: "2026-03-13T12:09:00.000Z"
      },
      approvals: [
        {
          approvalId: "approval-400",
          laneId: "lane-review",
          status: "pending" as const,
          boundary: "merge" as const,
          requestedAction: "merge review coordination PR",
          summary: "Pause before merging the PR into epic/supervisor-alpha.",
          rationale: "Alpha keeps merge approval human-controlled.",
          requestedBy: "supervisor",
          requestedAt: "2026-03-13T12:11:00.000Z",
          updatedAt: "2026-03-13T12:11:00.000Z"
        },
        {
          approvalId: "approval-other-lane",
          laneId: "lane-other",
          status: "pending" as const,
          boundary: "merge" as const,
          requestedAction: "ignore",
          summary: "Ignore",
          rationale: "Ignore",
          requestedBy: "supervisor",
          requestedAt: "2026-03-13T12:11:00.000Z",
          updatedAt: "2026-03-13T12:11:00.000Z"
        }
      ],
      artifacts: [
        {
          artifactId: "artifact-review-packet",
          laneId: "lane-review",
          kind: "review-packet" as const,
          status: "ready" as const,
          uri: "docs/review-packets/run-400-lane-review.md",
          updatedAt: "2026-03-13T12:08:00.000Z"
        },
        {
          artifactId: "artifact-validation",
          laneId: "lane-review",
          kind: "other" as const,
          status: "ready" as const,
          uri: "artifacts/run-400/validation.txt",
          updatedAt: "2026-03-13T12:09:00.000Z"
        }
      ],
      reviewPacket: {
        acceptanceCriteriaTrace: [
          {
            requirement: "Alpha can prepare a review bundle without becoming the backlog source of truth.",
            evidence: "tests/review-coordination.test.ts",
            status: "done" as const
          }
        ],
        scopedDiffSummary: [
          "Adds a typed review coordination helper that bundles review packet evidence, durable state links, and PR-ready metadata."
        ],
        verificationResults: [
          {
            check: "npm test",
            result: "pass" as const,
            notes: "Covers the new review coordination helper and existing packet contracts."
          }
        ],
        riskRollbackNotes: [
          "Rollback by removing the review coordination helper exports if Alpha wants to revert to manual PR assembly."
        ],
        handoff: {
          laneId: "lane-review",
          currentOwner: "DEV",
          nextOwner: "REVIEWER",
          transferScope: "review",
          transferTrigger: "Review bundle, PR metadata, and validation are ready.",
          deltaSummary: "Adds Alpha review coordination and PR prep helpers.",
          risks: ["PR prep could drift if run artifacts are not linked back into the bundle."],
          nextRequiredEvidence: ["PR body", "validation commands"],
          evidenceAttached: ["tests/review-coordination.test.ts"]
        },
        ownership: {
          reviewerOwner: "REVIEWER",
          mergeOwner: "Marcel Tuinstra",
          followUpOwner: "DEV"
        }
      },
      laneOutput: {
        runId: "run-400",
        laneId: "lane-review",
        status: "ready" as const,
        handoff: {
          laneId: "lane-review",
          currentOwner: "DEV",
          nextOwner: "REVIEWER",
          transferScope: "review" as const,
          transferTrigger: "Review bundle, PR metadata, and validation are ready.",
          deltaSummary: "Adds Alpha review coordination and PR prep helpers.",
          risks: ["PR prep could drift if run artifacts are not linked back into the bundle."],
          nextRequiredEvidence: ["PR body", "validation commands"],
          evidenceAttached: ["tests/review-coordination.test.ts"],
          openQuestions: []
        },
        artifacts: [
          {
            laneId: "lane-review",
            kind: "branch" as const,
            uri: "refs/heads/marceltuinstra/sc-400-review-coordination-pr-prep",
            label: "Lane branch"
          },
          {
            laneId: "lane-review",
            kind: "review-packet" as const,
            uri: "docs/review-packets/run-400-lane-review.md",
            label: "Lane review packet"
          }
        ],
        evidence: ["npm test", "npm run typecheck"],
        producedAt: "2026-03-13T12:10:00.000Z"
      },
      externalTracker: {
        system: "shortcut" as const,
        reference: "sc-400",
        url: "https://app.shortcut.com/tuinstradev/story/400"
      },
      originatingRun: {
        href: "state://run-400/lane-review"
      },
      pullRequest: {
        title: "Add alpha review coordination helper",
        baseRef: "epic/supervisor-alpha",
        headRef: "marceltuinstra/sc-400-review-coordination-pr-prep",
        summary: [
          "Adds a typed helper to assemble Alpha review bundles from durable state, review packet evidence, and external tracker links.",
          "Prepares stable PR metadata and review request fields without duplicating ticket ownership inside the plugin."
        ],
        before: "No user-facing prompting, messaging, or behavior change in this PR. Review prep had to be assembled manually from review packets, durable state, and tracker context.",
        after: "No user-facing prompting, messaging, or behavior change in this PR. Alpha now has a typed helper that packages review-ready evidence and PR metadata from existing state.",
        example: [
          "Run run-400 / lane-review links its review packet, validation output, approval record, and Shortcut story in one bundle.",
          "The generated PR body keeps the external tracker as the source of truth while still giving reviewers the exact evidence to inspect."
        ],
        validation: ["npm test", "npm run typecheck"],
        reviewers: ["marceltuinstra", "marceltuinstra"],
        reviewTeams: ["platform", "platform"],
        labels: ["automation", "phase:alpha", "automation"]
      },
      additionalArtifacts: [
        {
          label: "Validation output",
          href: "artifacts/run-400/validation.txt",
          kind: "validation" as const
        },
        {
          label: "Validation output",
          href: "artifacts/run-400/validation.txt",
          kind: "validation" as const
        },
        {
          label: "Diff summary",
          href: "https://github.com/example/repo/compare/base...head",
          kind: "diff" as const
        }
      ]
    };

    // Act
    const bundle = createReviewCoordinationBundle(bundleInput);

    // Assert
    expect(bundle.sourceOfTruth).toBe("external-tracker");
    expect(bundle.externalTracker).toEqual({
      system: "shortcut",
      reference: "sc-400",
      url: "https://app.shortcut.com/tuinstradev/story/400"
    });
    expect(bundle.originatingRun).toEqual({
      href: "state://run-400/lane-review",
      label: "run-400 / lane-review"
    });
    expect(bundle.approvals).toHaveLength(1);
    expect(bundle.approvals[0]?.approvalId).toBe("approval-400");
    expect(bundle.artifacts).toHaveLength(2);
    expect(bundle.reviewArtifacts).toEqual([
      {
        label: "run-400 / lane-review",
        href: "state://run-400/lane-review",
        kind: "originating-run"
      },
      {
        label: "shortcut sc-400",
        href: "https://app.shortcut.com/tuinstradev/story/400",
        kind: "external-tracker"
      },
      {
        label: "review-packet artifact-review-packet",
        href: "docs/review-packets/run-400-lane-review.md",
        kind: "review-packet"
      },
      {
        label: "other artifact-validation",
        href: "artifacts/run-400/validation.txt",
        kind: "other"
      },
      {
        label: "Lane branch",
        href: "refs/heads/marceltuinstra/sc-400-review-coordination-pr-prep",
        kind: "other"
      },
      {
        label: "Lane review packet",
        href: "docs/review-packets/run-400-lane-review.md",
        kind: "review-packet"
      },
      {
        label: "Approval approval-400",
        href: "approval:approval-400",
        kind: "approval"
      },
      {
        label: "Validation output",
        href: "artifacts/run-400/validation.txt",
        kind: "validation"
      },
      {
        label: "Diff summary",
        href: "https://github.com/example/repo/compare/base...head",
        kind: "diff"
      }
    ]);
    expect(bundle.pullRequest.reviewers).toEqual(["marceltuinstra"]);
    expect(bundle.pullRequest.reviewTeams).toEqual(["platform"]);
    expect(bundle.pullRequest.labels).toEqual(["automation", "phase:alpha"]);
    expect(bundle.laneOutput?.laneId).toBe("lane-review");
    expect(bundle.handoffValidation.outcome).toBe("accepted");
    expect(bundle.reviewPacket.handoff.deltaSummary).toBe("Adds Alpha review coordination and PR prep helpers.");
    expect(Object.isFrozen(bundle.reviewArtifacts)).toBe(true);
  });

  it("renders a pull request body with the required review handoff sections", () => {
    // Arrange
    const bundle = createReviewCoordinationBundle({
      run: {
        runId: "run-401",
        status: "review_ready",
        objective: "Prepare a focused review handoff.",
        sourceOfTruth: "control-plane-state",
        createdAt: "2026-03-13T13:00:00.000Z",
        updatedAt: "2026-03-13T13:10:00.000Z"
      },
      lane: {
        laneId: "lane-1",
        state: "review_ready",
        branch: "marceltuinstra/sc-400-review-coordination-pr-prep",
        updatedAt: "2026-03-13T13:10:00.000Z"
      },
      reviewPacket: {
        acceptanceCriteriaTrace: [
          {
            requirement: "PR prep is review-ready.",
            evidence: "tests/review-coordination.test.ts",
            status: "done"
          }
        ],
        scopedDiffSummary: ["Adds review coordination helpers."],
        verificationResults: [
          {
            check: "npm test",
            result: "pass",
            notes: "Review coordination tests pass."
          }
        ],
        riskRollbackNotes: ["Remove the helper if it proves too rigid for Alpha."],
        handoff: {
          laneId: "lane-1",
          currentOwner: "DEV",
          nextOwner: "REVIEWER",
          transferScope: "review",
          transferTrigger: "Bundle is ready.",
          deltaSummary: "Adds review coordination helper.",
          risks: ["Review metadata could drift without shared types."],
          nextRequiredEvidence: ["PR body"],
          evidenceAttached: ["tests/review-coordination.test.ts"]
        },
        ownership: {
          reviewerOwner: "REVIEWER",
          mergeOwner: "Marcel Tuinstra",
          followUpOwner: "DEV"
        }
      },
      externalTracker: {
        system: "shortcut",
        reference: "sc-400",
        url: "https://app.shortcut.com/tuinstradev/story/400"
      },
      originatingRun: {
        href: "state://run-401/lane-1",
        label: "run-401 / lane-1"
      },
      pullRequest: {
        title: "Add alpha review coordination helper",
        baseRef: "epic/supervisor-alpha",
        headRef: "marceltuinstra/sc-400-review-coordination-pr-prep",
        summary: ["Adds a typed Alpha review coordination helper."],
        before: "No user-facing prompting, messaging, or behavior change in this PR.",
        after: "No user-facing prompting, messaging, or behavior change in this PR. Review prep is now packaged through one typed helper.",
        example: ["A run bundle can now point reviewers to the exact tracker, run, and validation artifacts."],
        validation: ["npm test"]
      }
    });

    // Act
    const body = renderReviewCoordinationPullRequestBody(bundle);

    // Assert
    expect(body).toContain("## Summary");
    expect(body).toContain("## Before");
    expect(body).toContain("## After");
    expect(body).toContain("## Example");
    expect(body).toContain("## Validation");
    expect(body).toContain("External tracker remains the source of truth: shortcut sc-400");
    expect(body).toContain("Base / head: epic/supervisor-alpha <- marceltuinstra/sc-400-review-coordination-pr-prep");
    expect(body).toContain("Requested reviewers: none specified");
    expect(body).toContain("Handoff validation: accepted");
  });

  it("rejects pull request prep when required review sections are missing", () => {
    // Arrange
    const bundleInput: ReviewCoordinationBundleInput = {
      run: {
        runId: "run-402",
        status: "review_ready" as const,
        objective: "Validate PR prep guardrails.",
        sourceOfTruth: "control-plane-state" as const,
        createdAt: "2026-03-13T14:00:00.000Z",
        updatedAt: "2026-03-13T14:05:00.000Z"
      },
      lane: {
        laneId: "lane-2",
        state: "review_ready" as const,
        branch: "marceltuinstra/sc-400-review-coordination-pr-prep",
        updatedAt: "2026-03-13T14:05:00.000Z"
      },
      reviewPacket: {
        acceptanceCriteriaTrace: [
          {
            requirement: "PR prep refuses incomplete metadata.",
            evidence: "tests/review-coordination.test.ts",
            status: "done" as const
          }
        ],
        scopedDiffSummary: ["Adds PR prep validation."],
        verificationResults: [
          {
            check: "npm test",
            result: "pass" as const,
            notes: "Guardrail cases are covered."
          }
        ],
        riskRollbackNotes: ["Remove the strict prep guard if Alpha needs looser packaging."],
        handoff: {
          laneId: "lane-2",
          currentOwner: "DEV",
          nextOwner: "REVIEWER",
          transferScope: "review",
          transferTrigger: "Validation complete.",
          deltaSummary: "Adds PR prep validation.",
          risks: ["Incomplete review handoffs could reach reviewers."],
          nextRequiredEvidence: ["PR body"],
          evidenceAttached: ["tests/review-coordination.test.ts"]
        },
        ownership: {
          reviewerOwner: "REVIEWER",
          mergeOwner: "Marcel Tuinstra",
          followUpOwner: "DEV"
        }
      },
      externalTracker: {
        system: "shortcut" as const,
        reference: "sc-400",
        url: "https://app.shortcut.com/tuinstradev/story/400"
      },
      originatingRun: {
        href: "state://run-402/lane-2"
      },
      pullRequest: {
        title: "Add alpha review coordination helper",
        baseRef: "epic/supervisor-alpha",
        headRef: "marceltuinstra/sc-400-review-coordination-pr-prep",
        summary: ["Adds a typed Alpha review coordination helper."],
        before: "No user-facing prompting, messaging, or behavior change in this PR.",
        after: "No user-facing prompting, messaging, or behavior change in this PR.",
        example: [],
        validation: ["npm test"]
      }
    };

    // Act / Assert
    expect(() => createReviewCoordinationBundle(bundleInput)).toThrow(
      "Review coordination requires at least one pull request example item."
    );
  });
});
