import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore } from "../plugins/orchestration-workflows/durable-state-store";
import {
  createSupervisorExecutionWorkflow
} from "../plugins/orchestration-workflows/supervisor-execution-workflow";
import {
  createSupervisorLaneWorktreeProvisioner,
  type GitWorktreeEntry,
  type SupervisorLaneWorktreeSystem
} from "../plugins/orchestration-workflows/lane-worktree-provisioner";
import {
  createSupervisorSessionLifecycle,
  type AttachSupervisorRuntimeSessionInput,
  type LaunchSupervisorRuntimeSessionInput,
  type SupervisorSessionRuntimeAdapter
} from "../plugins/orchestration-workflows/session-runtime-adapter";
import { createSupervisorDispatchLoop } from "../plugins/orchestration-workflows/supervisor-scheduler";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "supervisor-execution-workflow-"));
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

    launchSession: async (input) => {
      launched.push({ ...input });

      return {
        runtimeSessionId: `runtime-${launched.length}`,
        owner: input.owner,
        status: "active",
        attachedAt: input.occurredAt,
        lastHeartbeatAt: input.occurredAt
      };
    },

    attachSession: async (input) => {
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

describe("supervisor-execution-workflow", () => {
  it("executes one delegated run through dispatch, recovery, governance, review, and reconstruction", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });

    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const dispatchLoop = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const workflow = createSupervisorExecutionWorkflow({ store, dispatchLoop });
    const workUnits = [
      {
        id: "workflow-core",
        workUnit: normalizeWorkUnit({
          objective: "Ship the supervisor execution workflow core.",
          acceptanceCriteria: [
            "One delegated run finishes with visible workflow checkpoints",
            "Recovery and approval checkpoints remain resumable"
          ],
          source: {
            kind: "ad-hoc",
            title: "Workflow core"
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "medium" as const,
          coupling: "medium" as const,
          blastRadius: "adjacent" as const,
          unknownCount: 1,
          testIsolation: "partial" as const
        }
      }
    ];

    const bootstrap = await workflow.bootstrapRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:00:00.000Z",
      objective: "Execute one thin delegated supervisor run with durable checkpoints.",
      goal: "Implement the supervisor execution workflow, keep checkpoints explicit, and prepare review evidence.",
      workUnits,
      readyDependencyReferences: [],
      delegation: {
        assignments: [
          {
            laneId: "lane-1",
            role: "DEV",
            agentLabel: "dev-agent",
            worktreePath: "/tmp/run-sc-328/lane-1",
            responsibilities: ["implementation", "repair"]
          }
        ],
        integration: {
          agentLabel: "review-agent",
          worktreePath: "/tmp/run-sc-328/review",
          responsibilities: ["review coordination"]
        }
      }
    });

    // Act
    const initialDispatch = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs,
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const launchDispatch = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs,
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    sessions.detectStalledSession({
      runId: "run-sc-328",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1:stalled",
      observedAt: "2026-03-13T20:09:00.000Z",
      stallTimeoutMs: 5 * 60 * 1000,
      failureReason: "The delegated implementation session stopped heartbeating."
    });
    const recoveryDispatch = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:10:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs,
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const approvalBlocked = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:11:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs.map((lane) => ({
        ...lane,
        approvalGate: {
          request: {
            boundary: "merge",
            requestedAction: "merge lane-1 into origin/main",
            summary: "Pause at the merge checkpoint.",
            rationale: "Mainline workflow keeps merge progression fail-closed."
          }
        }
      })),
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const approvalResumed = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:12:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs.map((lane) => ({
        ...lane,
        approvalGate: {
          request: {
            boundary: "merge",
            requestedAction: "merge lane-1 into origin/main",
            summary: "Pause at the merge checkpoint.",
            rationale: "Mainline workflow keeps merge progression fail-closed."
          },
          signal: {
            status: "approved",
            actor: "reviewer",
            occurredAt: "2026-03-13T20:12:30.000Z",
            note: "Checkpoint approved."
          }
        }
      })),
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const reviewBoundaryBlocked = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:13:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs.map((lane) => ({
        ...lane,
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [],
          scopedDiffSummary: ["Incomplete handoff should fail closed."],
          verificationResults: [],
          riskRollbackNotes: [],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Missing sections should block review progression.",
            deltaSummary: "Incomplete packet",
            risks: [],
            nextRequiredEvidence: [],
            evidenceAttached: []
          },
          ownership: {
            reviewerOwner: "REVIEWER",
            mergeOwner: "supervisor",
            followUpOwner: "DEV"
          }
        }
      })),
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const reviewReady = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:14:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs.map((lane) => ({
        ...lane,
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [
            {
              requirement: "One delegated run finishes with visible workflow checkpoints",
              evidence: "tests/supervisor-execution-workflow.test.ts",
              status: "done"
            }
          ],
          scopedDiffSummary: ["Adds a thin orchestration layer for delegated supervisor runs."],
          verificationResults: [
            {
              check: "vitest supervisor-execution-workflow",
              result: "pass",
              notes: "Exercises bootstrap, recovery, approval, review, and reconstruction."
            }
          ],
          riskRollbackNotes: ["Rollback by removing the orchestration wrapper if main needs to fall back to individual helpers."],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Governance checkpoint cleared and review packet is complete.",
            deltaSummary: "Adds the execution workflow wrapper.",
            risks: ["A missing workflow event would make restart reconstruction harder."],
            nextRequiredEvidence: ["review bundle", "validation output"],
            evidenceAttached: ["tests/supervisor-execution-workflow.test.ts"]
          },
          laneOutput: {
            runId: "run-sc-328",
            laneId: "lane-1",
            status: "ready",
            handoff: {
              laneId: "lane-1",
              currentOwner: "DEV",
              nextOwner: "REVIEWER",
              transferScope: "review",
              transferTrigger: "Governance checkpoint cleared and review packet is complete.",
              deltaSummary: "Adds the execution workflow wrapper.",
              risks: ["A missing workflow event would make restart reconstruction harder."],
              nextRequiredEvidence: ["review bundle", "validation output"],
              evidenceAttached: ["tests/supervisor-execution-workflow.test.ts"]
            },
            artifacts: [
              {
                laneId: "lane-1",
                kind: "branch",
                uri: "branch:marceltuinstra/sc-328-main-core",
                label: "Lane branch"
              },
              {
                laneId: "lane-1",
                kind: "review-packet",
                uri: "tests/supervisor-execution-workflow.test.ts",
                label: "Review packet"
              }
            ],
            evidence: ["tests/supervisor-execution-workflow.test.ts"],
            producedAt: "2026-03-13T20:14:00.000Z"
          },
          ownership: {
            reviewerOwner: "REVIEWER",
            mergeOwner: "supervisor",
            followUpOwner: "DEV"
          }
        }
      })),
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const reviewBundles = await workflow.prepareReviewBundles({
      runId: "run-sc-328",
      bundles: [
        {
          run: reviewReady.state.run,
          lane: reviewReady.state.lanes.find((lane) => lane.laneId === "lane-1")!,
          worktree: reviewReady.state.worktrees.find((worktree) => worktree.laneId === "lane-1"),
          session: reviewReady.state.sessions.find((session) => session.laneId === "lane-1" && session.status === "active"),
          reviewPacket: {
            acceptanceCriteriaTrace: [
              {
                requirement: "One delegated run finishes with visible workflow checkpoints",
                evidence: "tests/supervisor-execution-workflow.test.ts",
                status: "done"
              }
            ],
            scopedDiffSummary: ["Adds a thin orchestration layer for delegated supervisor runs."],
            verificationResults: [
              {
                check: "vitest supervisor-execution-workflow",
                result: "pass",
                notes: "Exercises bootstrap, recovery, approval, review, and reconstruction."
              }
            ],
            riskRollbackNotes: ["Rollback by removing the orchestration wrapper if main needs to fall back to individual helpers."],
            handoff: {
              laneId: "lane-1",
              currentOwner: "DEV",
              nextOwner: "REVIEWER",
              transferScope: "review",
              transferTrigger: "Governance checkpoint cleared and review packet is complete.",
              deltaSummary: "Adds the execution workflow wrapper.",
              risks: ["A missing workflow event would make restart reconstruction harder."],
              nextRequiredEvidence: ["review bundle", "validation output"],
             evidenceAttached: ["tests/supervisor-execution-workflow.test.ts"]
            },
            laneOutput: {
              runId: "run-sc-328",
              laneId: "lane-1",
              status: "ready",
              handoff: {
                laneId: "lane-1",
                currentOwner: "DEV",
                nextOwner: "REVIEWER",
                transferScope: "review",
                transferTrigger: "Governance checkpoint cleared and review packet is complete.",
                deltaSummary: "Adds the execution workflow wrapper.",
                risks: ["A missing workflow event would make restart reconstruction harder."],
                nextRequiredEvidence: ["review bundle", "validation output"],
                evidenceAttached: ["tests/supervisor-execution-workflow.test.ts"]
              },
              artifacts: [
                {
                  laneId: "lane-1",
                  kind: "branch",
                  uri: "branch:marceltuinstra/sc-328-main-core",
                  label: "Lane branch"
                },
                {
                  laneId: "lane-1",
                  kind: "review-packet",
                  uri: "tests/supervisor-execution-workflow.test.ts",
                  label: "Review packet"
                }
              ],
              evidence: ["tests/supervisor-execution-workflow.test.ts"],
              producedAt: "2026-03-13T20:14:00.000Z"
            },
            ownership: {
              reviewerOwner: "REVIEWER",
              mergeOwner: "supervisor",
              followUpOwner: "DEV"
            }
          },
          externalTracker: {
            system: "shortcut",
            reference: "sc-328",
            url: "https://app.shortcut.com/example/story/328"
          },
          originatingRun: {
            href: "state://run-sc-328/lane-1"
          },
          pullRequest: {
            title: "Add supervisor execution workflow v1",
            baseRef: "origin/main",
            headRef: "marceltuinstra/sc-328-main-core",
            summary: ["Adds a thin delegated orchestration layer over the existing supervisor modules."],
            before: "Operators had to stitch together planning, dispatch, recovery, and review helpers manually.",
            after: "Operators can drive one delegated run through explicit checkpoints and durable reconstruction.",
            example: ["One delegated lane pauses for approval, resumes, and reaches review ready with an auditable trace."],
            validation: ["vitest supervisor-execution-workflow"]
          },
          reviewRouting: {
            outcome: "accept",
            reasons: ["Lane produced a validated review-ready handoff."],
            handoffValidationOutcome: "accepted",
            laneOutputStatus: "ready",
            policy: {
              applied: false
            }
          }
        }
      ]
    });
    const completed = await workflow.advanceRun({
      runId: "run-sc-328",
      actor: "supervisor",
      occurredAt: "2026-03-13T20:15:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: bootstrap.dispatchPlan.laneInputs.map((lane) => ({
        ...lane,
        complete: true
      })),
      sessionOwners: ["DEV"],
      baseRef: "origin/main"
    });
    const reconstructed = await workflow.reconstructRun("run-sc-328");
    const summary = await workflow.buildRunSummary({
      runId: "run-sc-328",
      generatedAt: "2026-03-13T20:16:00.000Z"
    });
    const eventFiles = readdirSync(path.join(rootDir, "state", "runs", "run-sc-328", "events"));

    // Assert
    expect(bootstrap.status).toBe("supported");
    expect(bootstrap.nextAction).toBe("dispatch-lanes");
    expect(initialDispatch.dispatch.decisions[0]?.action).toBe("provision-worktree");
    expect(launchDispatch.dispatch.decisions[0]?.action).toBe("launch-session");
    expect(system.createCount).toBe(1);
    expect(recoveryDispatch.stage).toBe("recovery");
    expect(recoveryDispatch.dispatch.decisions[0]?.action).toBe("replace-session");
    expect(approvalBlocked.stage).toBe("approval");
    expect(approvalBlocked.status).toBe("blocked");
    expect(approvalBlocked.nextAction).toBe("await-approval");
    expect(approvalBlocked.remediation).toContain("Await explicit merge approval for merge lane-1 into origin/main.");
    expect(approvalResumed.dispatch.decisions[0]?.action).toBe("resume-session");
    expect(reviewBoundaryBlocked.status).toBe("blocked");
    expect(reviewBoundaryBlocked.nextAction).toBe("remediate-blockers");
    expect(reviewBoundaryBlocked.remediation[0]).toContain("Lane turn handoff requires at least one risk entry.");
    expect(reviewReady.stage).toBe("review");
    expect(reviewReady.nextAction).toBe("prepare-review");
    expect(reviewBundles).toHaveLength(1);
    expect(reviewBundles[0]?.reviewRouting.outcome).toBe("accept");
    expect(completed.stage).toBe("completion");
    expect(completed.status).toBe("completed");
    expect(completed.state.run.status).toBe("completed");
    expect(completed.state.worktrees[0]?.status).toBe("released");
    expect(reconstructed.workflowEvents.map((event) => event.stage)).toEqual([
      "intake",
      "dispatch",
      "dispatch",
      "recovery",
      "approval",
      "recovery",
      "dispatch",
      "review",
      "completion"
    ]);
    expect(reconstructed.laneTransitions.some((transition) => transition.state === "review_ready")).toBe(true);
    expect(reconstructed.currentNextAction).toBe("complete-run");
    expect(summary.dashboard.totals.lanes).toBe(1);
    expect(summary.dashboard.lanes[0]?.runId).toBe("run-sc-328");
    expect(summary.lifecycle.totals.durableRuns).toBe(1);
    expect(summary.lifecycle.durableRuns[0]?.recordId).toBe("run-sc-328");
    expect(eventFiles.length).toBe(reconstructed.state.auditLog.length);
  });

  it("fails closed at bootstrap when delegation governance is unsafe", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const dispatchLoop = {
      run: async () => ({
        policy: { maxActiveLanes: 1 },
        decisions: []
      })
    };
    const workflow = createSupervisorExecutionWorkflow({
      store,
      dispatchLoop: dispatchLoop as never
    });
    const workUnits = [
      {
        id: "workflow-core",
        workUnit: normalizeWorkUnit({
          objective: "Ship the supervisor execution workflow core.",
          source: {
            kind: "ad-hoc",
            title: "Workflow core"
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "low" as const,
          coupling: "low" as const,
          blastRadius: "contained" as const,
          unknownCount: 0,
          testIsolation: "isolated" as const
        }
      }
    ];

    // Act
    const bootstrap = await workflow.bootstrapRun({
      runId: "run-sc-328-blocked",
      actor: "supervisor",
      occurredAt: "2026-03-13T21:00:00.000Z",
      objective: "Block unsafe delegation before execution starts.",
      goal: "Implement the workflow core.",
      workUnits,
      readyDependencyReferences: [],
      delegation: {
        directEditsRequested: true,
        assignments: [
          {
            role: "DEV",
            agentLabel: "shared-agent",
            responsibilities: ["implementation"]
          }
        ],
        integration: {
          agentLabel: "shared-agent",
          responsibilities: ["integration"]
        }
      }
    });
    const reconstructed = await workflow.reconstructRun("run-sc-328-blocked");

    // Assert
    expect(bootstrap.status).toBe("blocked");
    expect(bootstrap.nextAction).toBe("fix-delegation");
    expect(bootstrap.remediation).toContain("Supervisor direct product-code edits are disabled in delegate-only mode.");
    expect(bootstrap.remediation).toContain("Assignment 'shared-agent' is missing a bound worktree path.");
    expect(reconstructed.state.run.status).toBe("paused");
    expect(reconstructed.workflowEvents).toEqual([
      {
        sequence: 1,
        occurredAt: "2026-03-13T21:00:00.000Z",
        stage: "intake",
        status: "blocked",
        nextAction: "fix-delegation",
        summary: "Bootstrap the delegated supervisor run in a blocked fail-closed state.",
        laneIds: []
      }
    ]);
  });

  it("emits stable unknown-run operator errors", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const workflow = createSupervisorExecutionWorkflow({
      store,
      dispatchLoop: { run: async () => ({ policy: { maxActiveLanes: 1 }, decisions: [] }) as never }
    });

    // Act / Assert
    await expect(workflow.reconstructRun("missing-run")).rejects.toThrow("blocked.unknown-run");
    await expect(workflow.buildRunSummary({
      runId: "missing-run",
      generatedAt: "2026-03-13T22:00:00.000Z"
    })).rejects.toThrow("Remediation: verify the run id was bootstrapped and persisted before retrying.");
  });
});
