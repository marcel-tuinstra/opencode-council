import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateSupervisorApprovalGate } from "../plugins/orchestration-workflows/approval-gates";
import { createFileBackedSupervisorStateStore } from "../plugins/orchestration-workflows/durable-state-store";
import {
  createSupervisorLaneWorktreeProvisioner,
  type GitWorktreeEntry,
  type SupervisorLaneWorktreeSystem
} from "../plugins/orchestration-workflows/lane-worktree-provisioner";
import { planWorkUnitLanes } from "../plugins/orchestration-workflows/lane-plan";
import { classifySupervisorRecoveryPlaybook } from "../plugins/orchestration-workflows/recovery-repair-playbooks";
import {
  createReviewCoordinationBundle,
  renderReviewCoordinationPullRequestBody
} from "../plugins/orchestration-workflows/review-coordination";
import { assertReviewReadyTransition } from "../plugins/orchestration-workflows/review-ready-packet";
import {
  createSupervisorSessionLifecycle,
  type AttachSupervisorRuntimeSessionInput,
  type LaunchSupervisorRuntimeSessionInput,
  type SupervisorSessionRuntimeAdapter
} from "../plugins/orchestration-workflows/session-runtime-adapter";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";
import { supervisorAlphaEndToEndFixture } from "./fixtures/supervisor-alpha-end-to-end-fixture";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "supervisor-alpha-validation-"));
  tempDirs.push(rootDir);
  return rootDir;
};

const createFakeSystem = (): SupervisorLaneWorktreeSystem & { createCount: number } => {
  const gitWorktrees = new Map<string, GitWorktreeEntry>();
  const localBranches = new Set<string>();
  let createCount = 0;

  return {
    get createCount(): number {
      return createCount;
    },

    listGitWorktrees: (): readonly GitWorktreeEntry[] => Object.freeze(
      Array.from(gitWorktrees.values()).map((entry) => Object.freeze({ ...entry }))
    ),

    pathExists: (filePath: string): boolean => existsSync(filePath),

    branchExists: (branch: string): boolean => localBranches.has(branch),

    createWorktree: ({ path: worktreePath, branch, createBranch }): void => {
      mkdirSync(worktreePath, { recursive: true });
      gitWorktrees.set(path.resolve(worktreePath), {
        path: path.resolve(worktreePath),
        branch,
        head: "abc123",
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      });
      if (createBranch) {
        localBranches.add(branch);
      }
      createCount += 1;
    },

    removeWorktree: (worktreePath: string): void => {
      gitWorktrees.delete(path.resolve(worktreePath));
      rmSync(worktreePath, { force: true, recursive: true });
    },

    listManagedLanePaths: (runWorktreeRoot: string): readonly string[] => {
      if (!existsSync(runWorktreeRoot)) {
        return [];
      }

      return Object.freeze(readdirSync(runWorktreeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.resolve(path.join(runWorktreeRoot, entry.name))));
    }
  };
};

const createFakeRuntime = (): SupervisorSessionRuntimeAdapter & {
  launched: LaunchSupervisorRuntimeSessionInput[];
  attached: AttachSupervisorRuntimeSessionInput[];
} => {
  const launched: LaunchSupervisorRuntimeSessionInput[] = [];
  const attached: AttachSupervisorRuntimeSessionInput[] = [];

  return {
    runtime: "opencode",
    launched,
    attached,

    launchSession: (input) => {
      launched.push({ ...input });

      return {
        runtimeSessionId: `runtime-${launched.length}`,
        owner: input.owner,
        status: "active",
        attachedAt: input.occurredAt,
        lastHeartbeatAt: input.occurredAt
      };
    },

    attachSession: (input) => {
      attached.push({ ...input });

      return {
        runtimeSessionId: input.sessionId,
        owner: input.owner,
        status: "active",
        attachedAt: input.occurredAt,
        lastHeartbeatAt: input.occurredAt
      };
    }
  };
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("supervisor-alpha-end-to-end-validation", () => {
  it("proves one alpha run can traverse planning, worktrees, sessions, approval, review prep, and recovery", () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });
    const workUnits = supervisorAlphaEndToEndFixture.workUnits.map((unit) => ({
      id: unit.id,
      workUnit: normalizeWorkUnit({
        ...unit.draft,
        constraints: "constraints" in unit.draft ? [...(unit.draft.constraints ?? [])] : undefined,
        acceptanceCriteria: "acceptanceCriteria" in unit.draft ? [...(unit.draft.acceptanceCriteria ?? [])] : undefined,
        dependencies: "dependencies" in unit.draft ? [...(unit.draft.dependencies ?? [])] : undefined,
        riskTags: "riskTags" in unit.draft ? [...(unit.draft.riskTags ?? [])] : undefined
      } as never),
      dependsOn: [...unit.dependsOn],
      signals: unit.signals
    }));
    const lanePlan = planWorkUnitLanes(workUnits);

    store.commitMutation(supervisorAlphaEndToEndFixture.runId, {
      mutationId: `${supervisorAlphaEndToEndFixture.runId}:create`,
      actor: "supervisor",
      summary: "Create the alpha validation run.",
      occurredAt: "2026-03-13T18:00:00.000Z",
      createRun: {
        runId: supervisorAlphaEndToEndFixture.runId,
        status: "active",
        objective: supervisorAlphaEndToEndFixture.objective,
        createdAt: "2026-03-13T18:00:00.000Z"
      },
      laneUpserts: [
        {
          laneId: supervisorAlphaEndToEndFixture.lanes[0].id,
          state: "active",
          branch: supervisorAlphaEndToEndFixture.lanes[0].branch,
          updatedAt: "2026-03-13T18:00:00.000Z"
        },
        {
          laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
          state: "waiting",
          branch: supervisorAlphaEndToEndFixture.lanes[1].branch,
          updatedAt: "2026-03-13T18:00:00.000Z"
        },
        {
          laneId: supervisorAlphaEndToEndFixture.lanes[2].id,
          state: "planned",
          branch: supervisorAlphaEndToEndFixture.lanes[2].branch,
          updatedAt: "2026-03-13T18:00:00.000Z"
        }
      ]
    });

    // Act
    const provisionedLanes = supervisorAlphaEndToEndFixture.lanes.map((lane, index) => provisioner.provisionLaneWorktree({
      runId: supervisorAlphaEndToEndFixture.runId,
      laneId: lane.id,
      branch: lane.branch,
      laneState: index === 0 ? "active" : index === 1 ? "waiting" : "planned",
      actor: "supervisor",
      mutationId: `${lane.id}:provision`,
      occurredAt: `2026-03-13T18:0${index + 1}:00.000Z`,
      baseRef: "epic/supervisor-alpha"
    }));
    const deliverySession = lifecycle.launchSession({
      runId: supervisorAlphaEndToEndFixture.runId,
      laneId: supervisorAlphaEndToEndFixture.lanes[0].id,
      owner: supervisorAlphaEndToEndFixture.lanes[0].owner,
      actor: "supervisor",
      mutationId: "lane-delivery:launch-session",
      occurredAt: "2026-03-13T18:05:00.000Z"
    });
    lifecycle.recordHeartbeat({
      runId: supervisorAlphaEndToEndFixture.runId,
      laneId: supervisorAlphaEndToEndFixture.lanes[0].id,
      actor: "supervisor",
      mutationId: "lane-delivery:heartbeat",
      occurredAt: "2026-03-13T18:06:00.000Z",
      lastHeartbeatAt: "2026-03-13T18:06:00.000Z"
    });
    const reviewSession = lifecycle.launchSession({
      runId: supervisorAlphaEndToEndFixture.runId,
      laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
      owner: supervisorAlphaEndToEndFixture.lanes[1].owner,
      actor: "supervisor",
      mutationId: "lane-review:launch-session",
      occurredAt: "2026-03-13T18:07:00.000Z"
    });
    const stalledReviewSession = lifecycle.detectStalledSession({
      runId: supervisorAlphaEndToEndFixture.runId,
      laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
      actor: "supervisor",
      mutationId: "lane-review:stalled",
      observedAt: "2026-03-13T18:14:00.000Z",
      stallTimeoutMs: 5 * 60 * 1000,
      failureReason: "Lane review heartbeat expired before PR prep completed."
    });
    const recoveryPlaybook = classifySupervisorRecoveryPlaybook({
      runState: store.getRunState(supervisorAlphaEndToEndFixture.runId)!,
      laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
      observedAt: "2026-03-13T18:14:00.000Z",
      stallTimeoutMs: 5 * 60 * 1000
    });
    const replacedReviewSession = lifecycle.replaceSession({
      runId: supervisorAlphaEndToEndFixture.runId,
      laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
      owner: "developer-c",
      actor: "supervisor",
      mutationId: "lane-review:replace-session",
      occurredAt: "2026-03-13T18:15:00.000Z"
    });
    const pendingApprovalDecision = evaluateSupervisorApprovalGate({
      laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
      actor: "supervisor",
      occurredAt: "2026-03-13T18:16:00.000Z",
      request: {
        boundary: "merge",
        requestedAction: "merge the alpha validation pull request into epic/supervisor-alpha",
        summary: "Pause before the pilot merge checkpoint.",
        rationale: "The alpha validation run must prove an explicit merge approval gate.",
        context: {
          changedPaths: [
            "tests/supervisor-alpha-end-to-end-validation.test.ts",
            "docs/supervisor/alpha-end-to-end-validation.md"
          ],
          targetRef: "epic/supervisor-alpha"
        }
      }
    });
    const approvedApprovalDecision = evaluateSupervisorApprovalGate({
      laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
      actor: "supervisor",
      occurredAt: "2026-03-13T18:17:00.000Z",
      request: {
        approvalId: pendingApprovalDecision.approvalId,
        boundary: "merge",
        requestedAction: "merge the alpha validation pull request into epic/supervisor-alpha",
        summary: "Pause before the pilot merge checkpoint.",
        rationale: "The alpha validation run must prove an explicit merge approval gate.",
        context: {
          changedPaths: [
            "tests/supervisor-alpha-end-to-end-validation.test.ts",
            "docs/supervisor/alpha-end-to-end-validation.md"
          ],
          targetRef: "epic/supervisor-alpha"
        }
      },
      existingApproval: pendingApprovalDecision.approval ?? undefined,
      signal: {
        status: "approved",
        actor: "marceltuinstra",
        occurredAt: "2026-03-13T18:17:30.000Z",
        note: "Validation passed; merge may proceed."
      }
    });
    const reviewPacket = assertReviewReadyTransition("active", "review_ready", {
      acceptanceCriteriaTrace: [
        {
          requirement: "One real epic run is reconstructable across multiple lanes, worktrees, sessions, approvals, and recovery checkpoints.",
          evidence: "tests/supervisor-alpha-end-to-end-validation.test.ts",
          status: "done"
        }
      ],
      scopedDiffSummary: [
        "Adds an alpha validation harness and pilot fixture that drive the shipped supervisor helpers through one real epic scenario."
      ],
      verificationResults: [
        {
          check: "npm test",
          result: "pass",
          notes: "Exercises the new end-to-end validation harness with the existing alpha helper suite."
        }
      ],
      riskRollbackNotes: [
        "Rollback by removing the validation harness and pilot doc if alpha wants to revert to helper-level coverage only."
      ],
      handoff: {
        laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
        currentOwner: "DEV",
        nextOwner: "REVIEWER",
        transferScope: "review",
        transferTrigger: "Approval, recovery evidence, and review artifacts are ready.",
        deltaSummary: "Adds an end-to-end alpha validation harness for epic 323.",
        risks: ["Pilot evidence could drift if the run stops linking approvals and recovery outputs back into review prep."],
        nextRequiredEvidence: ["PR body", "validation output"],
        evidenceAttached: [
          "tests/supervisor-alpha-end-to-end-validation.test.ts",
          "docs/supervisor/alpha-end-to-end-validation.md"
        ]
      },
      ownership: {
        reviewerOwner: "REVIEWER",
        mergeOwner: "Marcel Tuinstra",
        followUpOwner: "DEV"
      }
    });

    if (!reviewPacket) {
      throw new Error("Expected the alpha validation review packet to exist.");
    }

    store.commitMutation(supervisorAlphaEndToEndFixture.runId, {
      mutationId: "lane-review:review-ready",
      actor: "supervisor",
      summary: "Persist review-ready artifacts for the alpha validation lane.",
      occurredAt: "2026-03-13T18:18:00.000Z",
      runPatch: {
        status: "review_ready"
      },
      laneUpserts: [
        {
          laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
          state: "review_ready",
          branch: supervisorAlphaEndToEndFixture.lanes[1].branch,
          worktreeId: provisionedLanes[1].worktree.worktreeId,
          sessionId: replacedReviewSession.session.sessionId,
          updatedAt: "2026-03-13T18:18:00.000Z"
        }
      ],
      approvalUpserts: [approvedApprovalDecision.approval!],
      artifactUpserts: [
        {
          artifactId: "artifact-branch",
          laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
          kind: "branch",
          status: "ready",
          uri: `branch:${supervisorAlphaEndToEndFixture.lanes[1].branch}`,
          updatedAt: "2026-03-13T18:18:00.000Z"
        },
        {
          artifactId: "artifact-pr",
          laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
          kind: "pull-request",
          status: "ready",
          uri: "https://github.com/marcel-tuinstra/opencode-council/pull/placeholder",
          updatedAt: "2026-03-13T18:18:00.000Z"
        },
        {
          artifactId: "artifact-review-packet",
          laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
          kind: "review-packet",
          status: "ready",
          uri: "docs/supervisor/alpha-end-to-end-validation.md",
          updatedAt: "2026-03-13T18:18:00.000Z"
        },
        {
          artifactId: "artifact-validation",
          laneId: supervisorAlphaEndToEndFixture.lanes[1].id,
          kind: "other",
          status: "ready",
          uri: "npm test",
          updatedAt: "2026-03-13T18:18:00.000Z"
        }
      ],
      sideEffects: ["prepared-review-bundle"]
    });

    const finalState = store.getRunState(supervisorAlphaEndToEndFixture.runId)!;
    const reviewBundle = createReviewCoordinationBundle({
      run: finalState.run,
      lane: finalState.lanes.find((lane) => lane.laneId === supervisorAlphaEndToEndFixture.lanes[1].id)!,
      worktree: finalState.worktrees.find((worktree) => worktree.laneId === supervisorAlphaEndToEndFixture.lanes[1].id),
      session: finalState.sessions.find((session) => session.sessionId === replacedReviewSession.session.sessionId),
      approvals: finalState.approvals,
      artifacts: finalState.artifacts,
      reviewPacket,
      externalTracker: {
        system: "shortcut",
        reference: supervisorAlphaEndToEndFixture.story.reference,
        url: supervisorAlphaEndToEndFixture.story.url
      },
      originatingRun: {
        href: `state://${supervisorAlphaEndToEndFixture.runId}/${supervisorAlphaEndToEndFixture.lanes[1].id}`
      },
      pullRequest: {
        title: "Validate supervisor alpha end-to-end flow",
        baseRef: "epic/supervisor-alpha",
        headRef: "marceltuinstra/sc-402-supervisor-alpha-end-to-end-validation",
        summary: [
          "Adds a practical alpha validation harness that drives the shipped supervisor components through one real epic 323 run.",
          "Captures approval, recovery, review prep, KPI results, and retrospective gaps in one reviewable artifact trail."
        ],
        before: supervisorAlphaEndToEndFixture.beforeUserImpact,
        after: supervisorAlphaEndToEndFixture.afterUserImpact,
        example: [
          "Lane review stalls, triggers a stuck-heartbeat recovery playbook, replaces the session, then reaches review_ready with approved merge gating.",
          "The review bundle links the Shortcut story, originating run, approval record, validation command, and pilot doc in one PR body."
        ],
        validation: ["npm test", "npm run typecheck"]
      },
      additionalArtifacts: [
        {
          label: "Pilot validation doc",
          href: "docs/supervisor/alpha-end-to-end-validation.md",
          kind: "review-packet"
        },
        {
          label: "Validation command",
          href: "npm test",
          kind: "validation"
        }
      ]
    });
    const pullRequestBody = renderReviewCoordinationPullRequestBody(reviewBundle);
    const kpiSummary = {
      laneCount: finalState.lanes.length,
      activeWorktreeCount: finalState.worktrees.filter((worktree) => worktree.status === "active").length,
      sessionCount: finalState.sessions.length,
      approvalCount: finalState.approvals.length,
      recoveryEventCount: finalState.auditLog.filter((entry) => entry.sideEffects.includes("replaced-session")).length,
      reviewArtifactCount: finalState.artifacts.filter((artifact) => artifact.laneId === supervisorAlphaEndToEndFixture.lanes[1].id).length
    };

    // Assert
    expect(lanePlan.lanes).toEqual([
      {
        lane: 1,
        workUnitIds: ["epic-323-delivery-foundation"],
        maxStructuralScore: 8,
        reasons: ["file overlap medium", "coupling medium", "blast radius adjacent", "unknown count 1", "test isolation partial"]
      },
      {
        lane: 2,
        workUnitIds: ["epic-323-review-prep"],
        maxStructuralScore: 5,
        reasons: ["coupling medium", "unknown count 1"]
      },
      {
        lane: 3,
        workUnitIds: ["epic-323-kpi-retro"],
        maxStructuralScore: 3,
        reasons: []
      }
    ]);
    expect(provisionedLanes.map((result) => result.action)).toEqual(["created", "created", "created"]);
    expect(system.createCount).toBe(supervisorAlphaEndToEndFixture.kpiExpectations.activeWorktreeCount);
    expect(deliverySession.action).toBe("launched");
    expect(reviewSession.action).toBe("launched");
    expect(stalledReviewSession.action).toBe("stalled");
    expect(recoveryPlaybook.classification).toEqual({
      failureClass: "stuck-heartbeat",
      disposition: "supervised-retry",
      summary: "Lane 'lane-review' lost heartbeat continuity and should retry with a fresh session.",
      reasons: ["Latest heartbeat '2026-03-13T18:07:00.000Z' exceeded the 300000ms recovery timeout."]
    });
    expect(recoveryPlaybook.actions.map((action) => action.kind)).toEqual(["pause-lane", "replace-session"]);
    expect(replacedReviewSession.action).toBe("replaced");
    expect(replacedReviewSession.previousSession?.replacedBySessionId).toBe(replacedReviewSession.session.sessionId);
    expect(pendingApprovalDecision.status).toBe("pending");
    expect(approvedApprovalDecision.status).toBe("approved");
    expect(reviewPacket.handoff.nextOwner).toBe("REVIEWER");
    expect(reviewBundle.approvals).toHaveLength(1);
    expect(reviewBundle.reviewArtifacts.some((artifact) => artifact.kind === "approval")).toBe(true);
    expect(reviewBundle.reviewArtifacts.some((artifact) => artifact.kind === "validation")).toBe(true);
    expect(kpiSummary).toEqual(supervisorAlphaEndToEndFixture.kpiExpectations);
    expect(supervisorAlphaEndToEndFixture.retrospectiveGaps).toHaveLength(3);
    expect(pullRequestBody).toContain("## Summary");
    expect(pullRequestBody).toContain("## Before");
    expect(pullRequestBody).toContain("## After");
    expect(pullRequestBody).toContain("## Example");
    expect(pullRequestBody).toContain("## Validation");
    expect(pullRequestBody).toContain("No user-facing prompting, messaging, or behavior change.");
    expect(pullRequestBody).toContain("External tracker remains the source of truth: shortcut sc-402");
  });
});
