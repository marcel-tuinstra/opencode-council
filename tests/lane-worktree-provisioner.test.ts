import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore } from "../plugins/orchestration-workflows/durable-state-store";
import {
  buildSupervisorManagedWorktreePath,
  createSupervisorLaneWorktreeProvisioner,
  type GitWorktreeEntry,
  type SupervisorLaneWorktreeSystem
} from "../plugins/orchestration-workflows/lane-worktree-provisioner";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "lane-worktree-provisioner-"));
  tempDirs.push(rootDir);
  return rootDir;
};

const createFakeSystem = (): SupervisorLaneWorktreeSystem & { createCount: number; removeCount: number } => {
  const gitWorktrees = new Map<string, GitWorktreeEntry>();
  const localBranches = new Set<string>();
  let createCount = 0;
  let removeCount = 0;

  return {
    get createCount(): number {
      return createCount;
    },

    get removeCount(): number {
      return removeCount;
    },

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
      createCount += 1;
    },

    removeWorktree: (worktreePath: string): void => {
      gitWorktrees.delete(path.resolve(worktreePath));
      rmSync(worktreePath, { force: true, recursive: true });
      removeCount += 1;
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

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("lane-worktree-provisioner", () => {
  it("creates one managed worktree per lane and persists the durable mapping", () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });

    store.commitMutation("run-alpha", {
      mutationId: "run-alpha-create",
      actor: "supervisor",
      summary: "Create the run before provisioning lanes.",
      occurredAt: "2026-03-13T13:00:00.000Z",
      createRun: {
        runId: "run-alpha",
        status: "active",
        objective: "Provision durable worktrees for active lanes.",
        createdAt: "2026-03-13T13:00:00.000Z"
      }
    });

    // Act
    const result = provisioner.provisionLaneWorktree({
      runId: "run-alpha",
      laneId: "lane-one",
      branch: "marceltuinstra/sc-398-lane-one",
      laneState: "active",
      actor: "supervisor",
      mutationId: "lane-one-provision",
      occurredAt: "2026-03-13T13:01:00.000Z",
      baseRef: "epic/supervisor-alpha"
    });
    const state = store.getRunState("run-alpha");

    // Assert
    expect(result.action).toBe("created");
    expect(result.worktree.path).toBe(buildSupervisorManagedWorktreePath("run-alpha", "lane-one", worktreeRootDir));
    expect(result.reasons).toEqual([]);
    expect(system.createCount).toBe(1);
    expect(state?.lanes).toEqual([
      {
        laneId: "lane-one",
        state: "active",
        branch: "marceltuinstra/sc-398-lane-one",
        worktreeId: "run-alpha:lane-one",
        updatedAt: "2026-03-13T13:01:00.000Z"
      }
    ]);
    expect(state?.worktrees).toEqual([
      {
        worktreeId: "run-alpha:lane-one",
        laneId: "lane-one",
        path: buildSupervisorManagedWorktreePath("run-alpha", "lane-one", worktreeRootDir),
        branch: "marceltuinstra/sc-398-lane-one",
        status: "active",
        updatedAt: "2026-03-13T13:01:00.000Z"
      }
    ]);
  });

  it("reuses an existing healthy managed lane worktree instead of creating another one", () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });

    store.commitMutation("run-reuse", {
      mutationId: "run-reuse-create",
      actor: "supervisor",
      summary: "Create a reusable run.",
      occurredAt: "2026-03-13T13:10:00.000Z",
      createRun: {
        runId: "run-reuse",
        status: "active",
        objective: "Reuse durable lane worktrees.",
        createdAt: "2026-03-13T13:10:00.000Z"
      }
    });

    provisioner.provisionLaneWorktree({
      runId: "run-reuse",
      laneId: "lane-reuse",
      branch: "marceltuinstra/sc-398-lane-reuse",
      laneState: "active",
      actor: "supervisor",
      mutationId: "lane-reuse-provision-1",
      occurredAt: "2026-03-13T13:11:00.000Z",
      baseRef: "epic/supervisor-alpha"
    });

    // Act
    const result = provisioner.provisionLaneWorktree({
      runId: "run-reuse",
      laneId: "lane-reuse",
      branch: "marceltuinstra/sc-398-lane-reuse",
      laneState: "waiting",
      actor: "supervisor",
      mutationId: "lane-reuse-provision-2",
      occurredAt: "2026-03-13T13:12:00.000Z",
      baseRef: "epic/supervisor-alpha"
    });

    // Assert
    expect(result.action).toBe("reused");
    expect(result.lane.state).toBe("waiting");
    expect(result.reasons).toEqual([]);
    expect(system.createCount).toBe(1);
  });

  it("blocks provisioning when another git worktree already holds the requested branch", () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const occupiedPath = path.join(rootDir, "already-in-use");

    store.commitMutation("run-collision", {
      mutationId: "run-collision-create",
      actor: "supervisor",
      summary: "Create a run for collision testing.",
      occurredAt: "2026-03-13T13:20:00.000Z",
      createRun: {
        runId: "run-collision",
        status: "active",
        objective: "Detect branch collisions before provisioning.",
        createdAt: "2026-03-13T13:20:00.000Z"
      }
    });
    system.createWorktree({
      path: occupiedPath,
      branch: "marceltuinstra/sc-398-shared-branch",
      baseRef: "epic/supervisor-alpha",
      createBranch: true
    });

    // Act
    const result = provisioner.provisionLaneWorktree({
      runId: "run-collision",
      laneId: "lane-two",
      branch: "marceltuinstra/sc-398-shared-branch",
      laneState: "active",
      actor: "supervisor",
      mutationId: "lane-two-provision",
      occurredAt: "2026-03-13T13:21:00.000Z",
      baseRef: "epic/supervisor-alpha"
    });

    // Assert
    expect(result.action).toBe("blocked");
    expect(result.reasons).toEqual([
      `Branch 'marceltuinstra/sc-398-shared-branch' is already checked out at '${path.resolve(occupiedPath)}'.`
    ]);
    expect(system.createCount).toBe(1);
  });

  it("reconciles drift, collisions, and orphaned managed worktrees", () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
    const collisionPath = buildSupervisorManagedWorktreePath("run-reconcile", "lane-a", worktreeRootDir);
    const orphanPath = buildSupervisorManagedWorktreePath("run-reconcile", "lane-orphan", worktreeRootDir);

    store.commitMutation("run-reconcile", {
      mutationId: "run-reconcile-create",
      actor: "supervisor",
      summary: "Create a run to reconcile.",
      occurredAt: "2026-03-13T13:30:00.000Z",
      createRun: {
        runId: "run-reconcile",
        status: "active",
        objective: "Reconcile durable lane worktree state.",
        createdAt: "2026-03-13T13:30:00.000Z"
      },
      laneUpserts: [
        {
          laneId: "lane-a",
          state: "active",
          branch: "branch-shared",
          worktreeId: "run-reconcile:lane-a",
          updatedAt: "2026-03-13T13:30:00.000Z"
        },
        {
          laneId: "lane-b",
          state: "waiting",
          branch: "branch-shared",
          worktreeId: "run-reconcile:lane-b",
          updatedAt: "2026-03-13T13:30:00.000Z"
        }
      ],
      worktreeUpserts: [
        {
          worktreeId: "run-reconcile:lane-a",
          laneId: "lane-a",
          path: collisionPath,
          branch: "branch-shared",
          status: "active",
          updatedAt: "2026-03-13T13:30:00.000Z"
        },
        {
          worktreeId: "run-reconcile:lane-b",
          laneId: "lane-b",
          path: collisionPath,
          branch: "branch-shared",
          status: "active",
          updatedAt: "2026-03-13T13:30:00.000Z"
        }
      ]
    });
    system.createWorktree({
      path: collisionPath,
      branch: "branch-drifted",
      baseRef: "epic/supervisor-alpha",
      createBranch: true
    });
    mkdirSync(orphanPath, { recursive: true });

    // Act
    const report = provisioner.reconcileLaneWorktrees("run-reconcile");

    // Assert
    expect(report.isClean).toBe(false);
    expect(report.collisions.map((issue) => issue.reason)).toEqual([
      `Path '${path.resolve(collisionPath)}' is claimed by multiple durable worktree records.`,
      "Branch 'branch-shared' is claimed by multiple durable worktree records.",
      `Path '${path.resolve(collisionPath)}' is claimed by multiple durable worktree records.`,
      "Branch 'branch-shared' is claimed by multiple durable worktree records."
    ]);
    expect(report.drift.map((issue) => issue.reason)).toEqual([
      `Git reports branch 'branch-drifted' at '${path.resolve(collisionPath)}', but durable state expects 'branch-shared'.`,
      `Git reports branch 'branch-drifted' at '${path.resolve(collisionPath)}', but durable state expects 'branch-shared'.`
    ]);
    expect(report.orphans).toEqual([
      {
        path: path.resolve(orphanPath),
        branch: undefined,
        reason: "A managed worktree path exists on disk without a durable lane/worktree record."
      }
    ]);
  });

  it("releases a provisioned lane worktree and marks it as released in durable state", () => {
    // Arrange
    const rootDir = createTempRoot();
    const repoRoot = path.join(rootDir, "repo");
    const worktreeRootDir = path.join(rootDir, "worktrees");
    mkdirSync(repoRoot, { recursive: true });
    const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
    const system = createFakeSystem();
    const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });

    store.commitMutation("run-release", {
      mutationId: "run-release-create",
      actor: "supervisor",
      summary: "Create a run before cleanup.",
      occurredAt: "2026-03-13T13:40:00.000Z",
      createRun: {
        runId: "run-release",
        status: "active",
        objective: "Release managed lane worktrees after completion.",
        createdAt: "2026-03-13T13:40:00.000Z"
      }
    });
    const provisioned = provisioner.provisionLaneWorktree({
      runId: "run-release",
      laneId: "lane-release",
      branch: "marceltuinstra/sc-398-release",
      laneState: "review_ready",
      actor: "supervisor",
      mutationId: "lane-release-provision",
      occurredAt: "2026-03-13T13:41:00.000Z",
      baseRef: "epic/supervisor-alpha"
    });

    // Act
    const result = provisioner.releaseLaneWorktree({
      runId: "run-release",
      laneId: "lane-release",
      actor: "supervisor",
      mutationId: "lane-release-cleanup",
      occurredAt: "2026-03-13T13:42:00.000Z"
    });
    const state = store.getRunState("run-release");

    // Assert
    expect(result.action).toBe("released");
    expect(system.removeCount).toBe(1);
    expect(existsSync(provisioned.worktree.path)).toBe(false);
    expect(state?.lanes).toEqual([
      {
        laneId: "lane-release",
        state: "review_ready",
        branch: "marceltuinstra/sc-398-release",
        sessionId: undefined,
        worktreeId: undefined,
        updatedAt: "2026-03-13T13:42:00.000Z"
      }
    ]);
    expect(state?.worktrees).toEqual([
      {
        worktreeId: "run-release:lane-release",
        laneId: "lane-release",
        path: buildSupervisorManagedWorktreePath("run-release", "lane-release", worktreeRootDir),
        branch: "marceltuinstra/sc-398-release",
        status: "released",
        updatedAt: "2026-03-13T13:42:00.000Z"
      }
    ]);
  });
});
