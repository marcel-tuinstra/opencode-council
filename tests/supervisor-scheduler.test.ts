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
      lanes: [{ ...lanes[0], reviewReady: true }],
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
        action: "none"
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
  });
});
