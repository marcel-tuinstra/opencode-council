import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore } from "../plugins/orchestration-workflows/durable-state-store";
import { planWorkUnitLanes, type LanePlanningWorkUnit } from "../plugins/orchestration-workflows/lane-plan";
import {
  buildSupervisorManagedWorktreePath,
  createSupervisorLaneWorktreeProvisioner,
  type GitWorktreeEntry,
  type SupervisorLaneWorktreeSystem
} from "../plugins/orchestration-workflows/lane-worktree-provisioner";
import {
  createSupervisorDispatchLoop,
  createSupervisorLaneDefinitions
} from "../plugins/orchestration-workflows/supervisor-scheduler";
import { createLaneCompletionContract } from "../plugins/orchestration-workflows/lane-contract";
import {
  createSupervisorSessionLifecycle,
  type AttachSupervisorRuntimeSessionInput,
  type LaunchSupervisorRuntimeSessionInput,
  type SupervisorSessionRuntimeAdapter
} from "../plugins/orchestration-workflows/session-runtime-adapter";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "supervisor-scheduler-"));
  tempDirs.push(rootDir);
  return rootDir;
};

const createFakeSystem = (): SupervisorLaneWorktreeSystem => {
  const gitWorktrees = new Map<string, GitWorktreeEntry>();
  const localBranches = new Set<string>();

  return {
    listGitWorktrees: (): readonly GitWorktreeEntry[] => Object.freeze(Array.from(gitWorktrees.values()).map((entry) => Object.freeze({ ...entry }))),

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

const seedRun = (rootDir: string) => {
  const stateRoot = path.join(rootDir, "state");
  const repoRoot = path.join(rootDir, "repo");
  const worktreeRootDir = path.join(rootDir, "worktrees");
  mkdirSync(repoRoot, { recursive: true });
  const store = createFileBackedSupervisorStateStore({ rootDir: stateRoot });
  store.commitMutation("run-alpha", {
    mutationId: "run-alpha-create",
    actor: "supervisor",
    summary: "Create a run for scheduler dispatch tests.",
    occurredAt: "2026-03-13T15:00:00.000Z",
    createRun: {
      runId: "run-alpha",
      status: "active",
      objective: "Dispatch supervisor lanes deterministically.",
      createdAt: "2026-03-13T15:00:00.000Z"
    }
  });

  return { store, repoRoot, worktreeRootDir };
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("supervisor-scheduler", () => {
  it("creates deterministic lane definitions from work-unit dependencies", () => {
    // Arrange
    const intake: LanePlanningWorkUnit[] = [
      {
        id: "wu-foundation",
        workUnit: normalizeWorkUnit({
          objective: "Lay down the runtime foundation",
          source: {
            kind: "ad-hoc",
            title: "Foundation"
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "medium",
          coupling: "medium",
          blastRadius: "adjacent",
          unknownCount: 1,
          testIsolation: "partial"
        }
      },
      {
        id: "wu-docs",
        workUnit: normalizeWorkUnit({
          objective: "Document the dispatch path",
          source: {
            kind: "ad-hoc",
            title: "Docs"
          }
        }),
        dependsOn: ["wu-foundation"],
        signals: {
          fileOverlap: "low",
          coupling: "low",
          blastRadius: "contained",
          unknownCount: 0,
          testIsolation: "isolated"
        }
      }
    ];

    // Act
    const plan = planWorkUnitLanes(intake);
    const definitions = createSupervisorLaneDefinitions(plan, { branchPrefix: "marceltuinstra/sc-399" });

    // Assert
    expect(definitions).toEqual([
      {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["wu-foundation"],
        dependsOnLaneIds: [],
        branch: "marceltuinstra/sc-399/lane-01"
      },
      {
        laneId: "lane-2",
        sequence: 2,
        workUnitIds: ["wu-docs"],
        dependsOnLaneIds: ["lane-1"],
        branch: "marceltuinstra/sc-399/lane-02"
      }
    ]);
  });

  it("activates ready lanes by provisioning worktrees first and then launching sessions", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lanes = [
      {
        definition: {
          laneId: "lane-1",
          sequence: 1,
          workUnitIds: ["sc-399-core"],
          dependsOnLaneIds: [],
          branch: "marceltuinstra/sc-399/lane-01"
        }
      },
      {
        definition: {
          laneId: "lane-2",
          sequence: 2,
          workUnitIds: ["sc-399-docs"],
          dependsOnLaneIds: ["lane-1"],
          branch: "marceltuinstra/sc-399/lane-02"
        }
      }
    ] as const;

    // Act
    const firstPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a", "developer-b"],
      baseRef: "epic/supervisor-alpha"
    });
    const secondPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a", "developer-b"],
      baseRef: "epic/supervisor-alpha"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(firstPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "active",
        targetState: "active",
        action: "provision-worktree",
        assignedOwner: "developer-a"
      },
      {
        laneId: "lane-2",
        status: "blocked",
        action: "none",
        reasons: ["Waiting for dependency lanes: lane-1 is active."]
      }
    ]);
    expect(secondPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "active",
        targetState: "active",
        action: "launch-session",
        assignedOwner: "developer-a"
      },
      {
        laneId: "lane-2",
        status: "blocked",
        action: "none"
      }
    ]);
    expect(runtime.launched).toEqual([
      {
        runId: "run-alpha",
        laneId: "lane-1",
        worktreeId: "run-alpha:lane-1",
        worktreePath: buildSupervisorManagedWorktreePath("run-alpha", "lane-1", worktreeRootDir),
        branch: "marceltuinstra/sc-399/lane-01",
        owner: "developer-a",
        occurredAt: "2026-03-13T15:02:00.000Z"
      }
    ]);
    expect(state?.lanes).toEqual([
      {
        laneId: "lane-1",
        state: "active",
        branch: "marceltuinstra/sc-399/lane-01",
        worktreeId: "run-alpha:lane-1",
        sessionId: "run-alpha:lane-1:session-01",
        updatedAt: "2026-03-13T15:02:00.000Z"
      },
      {
        laneId: "lane-2",
        state: "planned",
        branch: "marceltuinstra/sc-399/lane-02",
        updatedAt: "2026-03-13T15:01:00.000Z"
      }
    ]);
  });

  it("moves lanes through waiting, review ready, and complete states without human babysitting", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lanes = [
      {
        definition: {
          laneId: "lane-1",
          sequence: 1,
          workUnitIds: ["sc-399-core"],
          dependsOnLaneIds: [],
          branch: "marceltuinstra/sc-399/lane-01"
        }
      }
    ] as const;

    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });

    // Act
    const waitingPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:03:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{ ...lanes[0], waitingOn: ["upstream API contract"] }],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    const reviewPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:04:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lanes[0],
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [
            {
              requirement: "Lane completion includes validated review artifacts.",
              evidence: "tests/supervisor-scheduler.test.ts",
              status: "done"
            }
          ],
          scopedDiffSummary: [
            "Produces a validated review-ready handoff before the scheduler marks the lane review ready."
          ],
          verificationResults: [
            {
              check: "npm test",
              result: "pass",
              notes: "Scheduler review-ready flow stays covered."
            }
          ],
          riskRollbackNotes: [
            "Rollback by removing the review-ready packet requirement if downstream callers are not ready."
          ],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Implementation and verification are complete.",
            deltaSummary: "Adds scheduler review-ready handoff validation.",
            risks: ["Review-ready now requires a typed packet and lane contract."],
            nextRequiredEvidence: ["Review packet", "branch ref"],
            evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
          },
          laneOutput: createLaneCompletionContract({
            runId: "run-alpha",
            laneId: "lane-1",
            status: "ready",
            handoff: {
              laneId: "lane-1",
              currentOwner: "DEV",
              nextOwner: "REVIEWER",
              transferScope: "review",
              transferTrigger: "Implementation and verification are complete.",
              deltaSummary: "Adds scheduler review-ready handoff validation.",
              risks: ["Review-ready now requires a typed packet and lane contract."],
              nextRequiredEvidence: ["Review packet", "branch ref"],
              evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
            },
            artifacts: [
              {
                laneId: "lane-1",
                kind: "branch",
                uri: "branch:marceltuinstra/sc-399/lane-01",
                label: "Lane branch"
              },
              {
                laneId: "lane-1",
                kind: "review-packet",
                uri: "docs/review-packets/run-alpha-lane-1.md",
                label: "Review packet"
              }
            ],
            evidence: ["npm test"],
            producedAt: "2026-03-13T15:04:00.000Z"
          }),
          ownership: {
            reviewerOwner: "REVIEWER",
            mergeOwner: "Marcel Tuinstra",
            followUpOwner: "DEV"
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    const completePass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:05:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{ ...lanes[0], complete: true }],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(waitingPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "blocked",
        targetState: "waiting",
        action: "none",
        reasons: ["Lane is waiting on: upstream API contract."]
      }
    ]);
    expect(reviewPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "review_ready",
        targetState: "review_ready",
        action: "none",
        reviewRouting: {
          outcome: "accept",
          policy: {
            applied: true,
            evaluator: "governance-policy:policy-default"
          }
        }
      }
    ]);
    expect(completePass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "complete",
        targetState: "complete",
        action: "release-worktree"
      }
    ]);
    expect(state?.lanes).toEqual([
      {
        laneId: "lane-1",
        state: "complete",
        branch: "marceltuinstra/sc-399/lane-01",
        sessionId: "run-alpha:lane-1:session-01",
        worktreeId: undefined,
        updatedAt: "2026-03-13T15:05:00.000Z"
      }
    ]);
    expect(state?.worktrees).toEqual([
      {
        worktreeId: "run-alpha:lane-1",
        laneId: "lane-1",
        path: buildSupervisorManagedWorktreePath("run-alpha", "lane-1", worktreeRootDir),
        branch: "marceltuinstra/sc-399/lane-01",
        status: "released",
        updatedAt: "2026-03-13T15:05:00.000Z"
      }
    ]);
    expect(state?.artifacts.map((artifact) => artifact.kind)).toEqual(["branch", "review-packet"]);
  });

  it("blocks review-ready transitions when the lane output contract is missing", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lanes = [{
      definition: {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["sc-437-core"],
        dependsOnLaneIds: [],
        branch: "marceltuinstra/sc-437/lane-01"
      }
    }] as const;

    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });

    // Act
    const reviewPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T16:03:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lanes[0],
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [{ requirement: "Review gate", evidence: "tests/supervisor-scheduler.test.ts", status: "done" }],
          scopedDiffSummary: ["Attempt review-ready without lane output."],
          verificationResults: [{ check: "npm test", result: "pass", notes: "Intentional invalid packet." }],
          riskRollbackNotes: ["None."],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Attempted review-ready transition.",
            deltaSummary: "Intentionally missing lane output.",
            risks: ["Should fail closed."],
            nextRequiredEvidence: ["Lane output contract"],
            evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
          },
          ownership: {
            reviewerOwner: "REVIEWER",
            mergeOwner: "Marcel Tuinstra",
            followUpOwner: "DEV"
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });

    // Assert
    expect(reviewPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "blocked",
        action: "none",
        nextAction: "pause"
      }
    ]);
    expect(reviewPass.decisions[0]?.reasons[0]).toContain("validated lane output contract");
    expect(store.getRunState("run-alpha")?.lanes[0]?.state).toBe("active");
  });

  it("escalates review-ready checkpoints when ownership requires human resolution", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lanes = [{
      definition: {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["sc-438-core"],
        dependsOnLaneIds: [],
        branch: "marceltuinstra/sc-438/lane-01"
      }
    }] as const;

    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T17:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T17:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });

    // Act
    const reviewPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T17:03:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lanes[0],
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [{ requirement: "Escalated review handoff", evidence: "tests/supervisor-scheduler.test.ts", status: "done" }],
          scopedDiffSummary: ["Escalate review-ready because the reviewer owner mismatches the handoff owner."],
          verificationResults: [{ check: "npm test", result: "pass", notes: "Intentional escalation packet." }],
          riskRollbackNotes: ["None."],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Attempted review-ready transition.",
            deltaSummary: "Trigger checkpoint escalation.",
            risks: ["Human review owner mismatch should escalate."],
            nextRequiredEvidence: ["Approval resolution"],
            evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
          },
          laneOutput: createLaneCompletionContract({
            runId: "run-alpha",
            laneId: "lane-1",
            status: "ready",
            handoff: {
              laneId: "lane-1",
              currentOwner: "DEV",
              nextOwner: "REVIEWER",
              transferScope: "review",
              transferTrigger: "Attempted review-ready transition.",
              deltaSummary: "Trigger checkpoint escalation.",
              risks: ["Human review owner mismatch should escalate."],
              nextRequiredEvidence: ["Approval resolution"],
              evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
            },
            artifacts: [
              {
                laneId: "lane-1",
                kind: "branch",
                uri: "branch:marceltuinstra/sc-438/lane-01",
                label: "Lane branch"
              },
              {
                laneId: "lane-1",
                kind: "review-packet",
                uri: "docs/review-packets/run-alpha-lane-1.md",
                label: "Review packet"
              }
            ],
            evidence: ["npm test"],
            producedAt: "2026-03-13T17:03:00.000Z"
          }),
          ownership: {
            reviewerOwner: "PM",
            mergeOwner: "Marcel Tuinstra",
            followUpOwner: "DEV"
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(reviewPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "blocked",
        action: "pause-session",
        nextAction: "pause",
        reviewRouting: {
          outcome: "escalate",
          policy: {
            applied: true,
            evaluator: "governance-policy:explicit-policy"
          }
        }
      }
    ]);
    expect(reviewPass.decisions[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("review-owner-mismatch-escalate"),
        expect.stringContaining("Review checkpoint owner")
      ])
    );
    expect(state?.lanes[0]?.state).toBe("waiting");
    expect(state?.approvals).toMatchObject([
      {
        laneId: "lane-1",
        boundary: "automation-widening",
        status: "pending"
      }
    ]);
    expect(state?.artifacts).toMatchObject([
      {
        laneId: "lane-1",
        kind: "branch",
        uri: "branch:marceltuinstra/sc-438/lane-01"
      },
      {
        laneId: "lane-1",
        kind: "review-packet",
        uri: "docs/review-packets/run-alpha-lane-1.md"
      }
    ]);
  });

  it("captures handoff evidence and blocks for repair when the handoff contract is incomplete", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lanes = [{
      definition: {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["sc-438-core"],
        dependsOnLaneIds: [],
        branch: "marceltuinstra/sc-438/lane-01"
      }
    }] as const;

    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T18:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T18:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });

    // Act
    const reviewPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T18:03:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lanes[0],
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [{ requirement: "Repair incomplete handoff", evidence: "tests/supervisor-scheduler.test.ts", status: "done" }],
          scopedDiffSummary: ["Block review-ready because the handoff contract is missing the review packet artifact."],
          verificationResults: [{ check: "npm test", result: "pass", notes: "Intentional repair packet." }],
          riskRollbackNotes: ["None."],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Attempted review-ready transition.",
            deltaSummary: "Trigger repair routing.",
            risks: ["Missing review packet artifact should stay in repair."],
            nextRequiredEvidence: ["Review packet artifact"],
            evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
          },
          laneOutput: {
            runId: "run-alpha",
            laneId: "lane-1",
            status: "ready",
            handoff: {
              laneId: "lane-1",
              currentOwner: "DEV",
              nextOwner: "REVIEWER",
              transferScope: "review",
              transferTrigger: "Attempted review-ready transition.",
              deltaSummary: "Trigger repair routing.",
              risks: ["Missing review packet artifact should stay in repair."],
              nextRequiredEvidence: ["Review packet artifact"],
              evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
            },
            artifacts: [
              {
                laneId: "lane-1",
                kind: "branch",
                uri: "branch:marceltuinstra/sc-438/lane-01",
                label: "Lane branch"
              }
            ],
            evidence: ["npm test"],
            producedAt: "2026-03-13T18:03:00.000Z"
          },
          ownership: {
            reviewerOwner: "REVIEWER",
            mergeOwner: "Marcel Tuinstra",
            followUpOwner: "DEV"
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(reviewPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "blocked",
        action: "none",
        nextAction: "pause",
        reviewRouting: {
          outcome: "repair",
          policy: {
            applied: true,
            evaluator: "governance-policy:explicit-policy"
          }
        }
      }
    ]);
    expect(reviewPass.decisions[0]?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringContaining("review-artifacts-repair"),
        expect.stringContaining("review-packet artifact")
      ])
    );
    expect(state?.lanes[0]?.state).toBe("active");
    expect(state?.artifacts).toMatchObject([
      {
        laneId: "lane-1",
        kind: "branch",
        uri: "branch:marceltuinstra/sc-438/lane-01"
      }
    ]);
  });

  it("routes blocked review handoffs into an explicit scheduler hold", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lanes = [{
      definition: {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["sc-441-core"],
        dependsOnLaneIds: [],
        branch: "marceltuinstra/sc-441/lane-01"
      }
    }] as const;

    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T19:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T19:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes,
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });

    // Act
    const reviewPass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T19:03:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lanes[0],
        reviewReadyPacket: {
          acceptanceCriteriaTrace: [{ requirement: "Blocked review routing stays explicit.", evidence: "tests/supervisor-scheduler.test.ts", status: "done" }],
          scopedDiffSummary: ["Route blocked lane outputs into an explicit scheduler hold instead of a generic failure."],
          verificationResults: [{ check: "npm test", result: "pass", notes: "Blocked routing path is covered." }],
          riskRollbackNotes: ["None."],
          handoff: {
            laneId: "lane-1",
            currentOwner: "DEV",
            nextOwner: "REVIEWER",
            transferScope: "review",
            transferTrigger: "Implementation finished but blockers remain.",
            deltaSummary: "Trigger blocked review routing.",
            risks: ["Known blockers should pause the handoff before review starts."],
            nextRequiredEvidence: ["Resolved blocking issue"],
            evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
          },
          laneOutput: createLaneCompletionContract({
            runId: "run-alpha",
            laneId: "lane-1",
            status: "blocked",
            handoff: {
              laneId: "lane-1",
              currentOwner: "DEV",
              nextOwner: "REVIEWER",
              transferScope: "review",
              transferTrigger: "Implementation finished but blockers remain.",
              deltaSummary: "Trigger blocked review routing.",
              risks: ["Known blockers should pause the handoff before review starts."],
              nextRequiredEvidence: ["Resolved blocking issue"],
              evidenceAttached: ["tests/supervisor-scheduler.test.ts"]
            },
            artifacts: [
              {
                laneId: "lane-1",
                kind: "branch",
                uri: "branch:marceltuinstra/sc-441/lane-01",
                label: "Lane branch"
              },
              {
                laneId: "lane-1",
                kind: "review-packet",
                uri: "docs/review-packets/run-alpha-lane-1.md",
                label: "Review packet"
              }
            ],
            evidence: ["npm test"],
            producedAt: "2026-03-13T19:03:00.000Z",
            blockingIssues: ["Waiting for architecture sign-off."]
          }),
          ownership: {
            reviewerOwner: "REVIEWER",
            mergeOwner: "Marcel Tuinstra",
            followUpOwner: "DEV"
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "beta"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(reviewPass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "blocked",
        action: "pause-session",
        nextAction: "pause",
        reviewRouting: {
          outcome: "block",
          reasons: ["Waiting for architecture sign-off."]
        }
      }
    ]);
    expect(state?.lanes[0]?.state).toBe("waiting");
    expect(state?.sessions[0]?.status).toBe("paused");
    expect(state?.artifacts).toMatchObject([
      {
        laneId: "lane-1",
        kind: "branch",
        uri: "branch:marceltuinstra/sc-441/lane-01"
      },
      {
        laneId: "lane-1",
        kind: "review-packet",
        uri: "docs/review-packets/run-alpha-lane-1.md"
      }
    ]);
  });

  it("pauses at approval gates and resumes only after an explicit approval event", () => {
    // Arrange
    const rootDir = createTempRoot();
    const { store, repoRoot, worktreeRootDir } = seedRun(rootDir);
    const system = createFakeSystem();
    const runtime = createFakeRuntime();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const sessions = createSupervisorSessionLifecycle({ store, runtime });
    const scheduler = createSupervisorDispatchLoop({ store, provisioner, sessions });
    const lane = {
      definition: {
        laneId: "lane-1",
        sequence: 1,
        workUnitIds: ["sc-403-core"],
        dependsOnLaneIds: [],
        branch: "marceltuinstra/sc-403/lane-01"
      }
    } as const;

    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:01:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [lane],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:02:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [lane],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });

    // Act
    const pausePass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:03:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lane,
        approvalGate: {
          request: {
            boundary: "merge",
            requestedAction: "merge lane PR",
            summary: "Pause before merging the lane pull request.",
            rationale: "Merge is a governance boundary in alpha.",
            context: {
              targetRef: "epic/supervisor-alpha"
            }
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    const resumePass = scheduler.run({
      runId: "run-alpha",
      actor: "supervisor",
      occurredAt: "2026-03-13T15:04:00.000Z",
      repoRiskTier: "medium-moderate-risk",
      lanes: [{
        ...lane,
        approvalGate: {
          request: {
            boundary: "merge",
            requestedAction: "merge lane PR",
            summary: "Pause before merging the lane pull request.",
            rationale: "Merge is a governance boundary in alpha.",
            context: {
              targetRef: "epic/supervisor-alpha"
            }
          },
          signal: {
            status: "approved",
            actor: "marceltuinstra",
            occurredAt: "2026-03-13T15:04:30.000Z",
            note: "Validated and approved."
          }
        }
      }],
      sessionOwners: ["developer-a"],
      baseRef: "epic/supervisor-alpha"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(pausePass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "blocked",
        action: "pause-session",
        nextAction: "pause",
        reasons: ["Human approval is required at the merge governance boundary before merge lane PR."]
      }
    ]);
    expect(resumePass.decisions).toMatchObject([
      {
        laneId: "lane-1",
        status: "active",
        action: "resume-session",
        nextAction: "resume",
        reasons: ["Explicit human approval cleared merge lane PR to resume execution."]
      }
    ]);
    expect(state?.approvals).toMatchObject([
      {
        laneId: "lane-1",
        boundary: "merge",
        status: "approved",
        decidedBy: "marceltuinstra"
      }
    ]);
    expect(state?.sessions[0]?.status).toBe("active");
  });
});
