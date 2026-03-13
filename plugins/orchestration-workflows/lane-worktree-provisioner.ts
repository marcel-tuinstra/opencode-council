import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type {
  SupervisorLaneRecord,
  SupervisorRunState,
  SupervisorStateStore,
  SupervisorWorktreeRecord
} from "./durable-state-store";
import type { LaneLifecycleState } from "./lane-lifecycle";

export const DEFAULT_SUPERVISOR_WORKTREE_ROOT = ".opencode/supervisor/worktrees";

export type GitWorktreeEntry = {
  path: string;
  branch?: string;
  head?: string;
  isBare: boolean;
  isDetached: boolean;
  isLocked: boolean;
  isPrunable: boolean;
};

export type SupervisorLaneWorktreeSystem = {
  listGitWorktrees(): readonly GitWorktreeEntry[];
  pathExists(filePath: string): boolean;
  branchExists(branch: string): boolean;
  createWorktree(input: {
    path: string;
    branch: string;
    baseRef: string;
    createBranch: boolean;
  }): void;
  removeWorktree(worktreePath: string): void;
  listManagedLanePaths(runWorktreeRoot: string): readonly string[];
};

export type SupervisorLaneWorktreeProvisionerOptions = {
  repoRoot: string;
  store: SupervisorStateStore;
  worktreeRootDir?: string;
  system?: SupervisorLaneWorktreeSystem;
};

export type ProvisionSupervisorLaneWorktreeInput = {
  runId: string;
  laneId: string;
  branch: string;
  laneState: LaneLifecycleState;
  actor: string;
  mutationId: string;
  occurredAt: string;
  baseRef?: string;
  summary?: string;
};

export type ProvisionSupervisorLaneWorktreeResult = {
  action: "created" | "reused" | "blocked";
  worktree: SupervisorWorktreeRecord;
  lane: SupervisorLaneRecord;
  reconciliation: SupervisorLaneWorktreeReconciliationReport;
  reasons: readonly string[];
};

export type ReleaseSupervisorLaneWorktreeInput = {
  runId: string;
  laneId: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  summary?: string;
};

export type ReleaseSupervisorLaneWorktreeResult = {
  action: "released" | "already-released";
  worktree: SupervisorWorktreeRecord;
  lane: SupervisorLaneRecord;
};

export type SupervisorLaneWorktreeDrift = {
  laneId: string;
  worktreeId: string;
  reason: string;
};

export type SupervisorLaneWorktreeCollision = {
  laneId?: string;
  worktreeId?: string;
  branch?: string;
  path?: string;
  reason: string;
};

export type SupervisorLaneWorktreeOrphan = {
  worktreeId?: string;
  path: string;
  branch?: string;
  reason: string;
};

export type SupervisorLaneWorktreeHealth = {
  laneId: string;
  worktreeId: string;
  path: string;
  branch: string;
};

export type SupervisorLaneWorktreeReconciliationReport = {
  runId: string;
  worktreeRootDir: string;
  isClean: boolean;
  healthy: readonly SupervisorLaneWorktreeHealth[];
  drift: readonly SupervisorLaneWorktreeDrift[];
  collisions: readonly SupervisorLaneWorktreeCollision[];
  orphans: readonly SupervisorLaneWorktreeOrphan[];
};

export type SupervisorLaneWorktreeProvisioner = {
  provisionLaneWorktree(input: ProvisionSupervisorLaneWorktreeInput): ProvisionSupervisorLaneWorktreeResult;
  releaseLaneWorktree(input: ReleaseSupervisorLaneWorktreeInput): ReleaseSupervisorLaneWorktreeResult;
  reconcileLaneWorktrees(runId: string): SupervisorLaneWorktreeReconciliationReport;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor lane worktree provisioner requires a non-empty ${field}.`);
  }

  return normalized;
};

const sanitizePathSegment = (value: string, field: string): string => {
  const normalized = assertNonEmpty(value, field)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

  if (normalized.length === 0 || normalized === "." || normalized === "..") {
    throw new Error(`Supervisor lane worktree provisioner could not derive a safe filesystem segment for ${field}.`);
  }

  return normalized;
};

const normalizeWorktreePath = (value: string): string => path.resolve(value);

const buildWorktreeId = (runId: string, laneId: string): string => `${assertNonEmpty(runId, "run id")}:${assertNonEmpty(laneId, "lane id")}`;

const getRunWorktreeRoot = (rootDir: string, runId: string): string => path.join(rootDir, sanitizePathSegment(runId, "run id"));

export const buildSupervisorManagedWorktreePath = (
  runId: string,
  laneId: string,
  worktreeRootDir: string = DEFAULT_SUPERVISOR_WORKTREE_ROOT
): string => path.join(
  path.resolve(worktreeRootDir),
  sanitizePathSegment(runId, "run id"),
  sanitizePathSegment(laneId, "lane id")
);

const normalizeGitWorktreeEntry = (entry: GitWorktreeEntry): GitWorktreeEntry => freezeRecord({
  ...entry,
  path: normalizeWorktreePath(entry.path)
});

const parseGitWorktreeList = (raw: string): readonly GitWorktreeEntry[] => {
  const blocks = raw.trim().length === 0
    ? []
    : raw.trim().split(/\n\s*\n/);

  return freezeList(blocks.map((block) => {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    let worktreePath = "";
    let branch: string | undefined;
    let head: string | undefined;
    let isBare = false;
    let isDetached = false;
    let isLocked = false;
    let isPrunable = false;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
        continue;
      }

      if (line.startsWith("branch refs/heads/")) {
        branch = line.slice("branch refs/heads/".length);
        continue;
      }

      if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
        continue;
      }

      if (line === "bare") {
        isBare = true;
        continue;
      }

      if (line === "detached") {
        isDetached = true;
        continue;
      }

      if (line.startsWith("locked")) {
        isLocked = true;
        continue;
      }

      if (line.startsWith("prunable")) {
        isPrunable = true;
      }
    }

    return normalizeGitWorktreeEntry({
      path: worktreePath,
      branch,
      head,
      isBare,
      isDetached,
      isLocked,
      isPrunable
    });
  }));
};

const createNodeSupervisorLaneWorktreeSystem = (repoRoot: string): SupervisorLaneWorktreeSystem => ({
  listGitWorktrees: (): readonly GitWorktreeEntry[] => parseGitWorktreeList(execFileSync(
    "git",
    ["worktree", "list", "--porcelain"],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  )),

  pathExists: (filePath: string): boolean => existsSync(filePath),

  branchExists: (branch: string): boolean => spawnSync(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${assertNonEmpty(branch, "branch")}`],
    { cwd: repoRoot }
  ).status === 0,

  createWorktree: ({ path: worktreePath, branch, baseRef, createBranch }): void => {
    mkdirSync(path.dirname(worktreePath), { recursive: true });
    const args = createBranch
      ? ["worktree", "add", "-b", branch, worktreePath, baseRef]
      : ["worktree", "add", worktreePath, branch];

    execFileSync("git", args, { cwd: repoRoot, stdio: "pipe" });
  },

  removeWorktree: (worktreePath: string): void => {
    execFileSync("git", ["worktree", "remove", worktreePath], { cwd: repoRoot, stdio: "pipe" });
  },

  listManagedLanePaths: (runWorktreeRoot: string): readonly string[] => {
    if (!existsSync(runWorktreeRoot)) {
      return [];
    }

    return freezeList(readdirSync(runWorktreeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeWorktreePath(path.join(runWorktreeRoot, entry.name))));
  }
});

const findLane = (state: SupervisorRunState, laneId: string): SupervisorLaneRecord | undefined => (
  state.lanes.find((lane) => lane.laneId === laneId)
);

const findWorktree = (state: SupervisorRunState, worktreeId: string): SupervisorWorktreeRecord | undefined => (
  state.worktrees.find((worktree) => worktree.worktreeId === worktreeId)
);

const buildPathCollisionMap = (worktrees: readonly SupervisorWorktreeRecord[]): Map<string, SupervisorWorktreeRecord[]> => {
  const collisions = new Map<string, SupervisorWorktreeRecord[]>();

  for (const worktree of worktrees) {
    const key = normalizeWorktreePath(worktree.path);
    collisions.set(key, [...(collisions.get(key) ?? []), worktree]);
  }

  return collisions;
};

const buildBranchCollisionMap = (worktrees: readonly SupervisorWorktreeRecord[]): Map<string, SupervisorWorktreeRecord[]> => {
  const collisions = new Map<string, SupervisorWorktreeRecord[]>();

  for (const worktree of worktrees) {
    collisions.set(worktree.branch, [...(collisions.get(worktree.branch) ?? []), worktree]);
  }

  return collisions;
};

const buildLaneRecord = (
  previousLane: SupervisorLaneRecord | undefined,
  input: ProvisionSupervisorLaneWorktreeInput,
  worktreeId: string
): SupervisorLaneRecord => freezeRecord({
  laneId: input.laneId,
  state: input.laneState,
  branch: input.branch,
  worktreeId,
  sessionId: previousLane?.sessionId,
  updatedAt: input.occurredAt
});

const buildWorktreeRecord = (
  laneId: string,
  worktreeId: string,
  worktreePath: string,
  branch: string,
  updatedAt: string,
  status: SupervisorWorktreeRecord["status"] = "active"
): SupervisorWorktreeRecord => freezeRecord({
  worktreeId,
  laneId,
  path: worktreePath,
  branch,
  status,
  updatedAt
});

const buildReleaseLaneRecord = (
  lane: SupervisorLaneRecord,
  occurredAt: string
): SupervisorLaneRecord => freezeRecord({
  ...lane,
  worktreeId: undefined,
  updatedAt: occurredAt
});

const buildHealthyWorktree = (worktree: SupervisorWorktreeRecord): SupervisorLaneWorktreeHealth => freezeRecord({
  laneId: worktree.laneId,
  worktreeId: worktree.worktreeId,
  path: normalizeWorktreePath(worktree.path),
  branch: worktree.branch
});

const createReconciliationReport = (
  runId: string,
  worktreeRootDir: string,
  healthy: readonly SupervisorLaneWorktreeHealth[],
  drift: readonly SupervisorLaneWorktreeDrift[],
  collisions: readonly SupervisorLaneWorktreeCollision[],
  orphans: readonly SupervisorLaneWorktreeOrphan[]
): SupervisorLaneWorktreeReconciliationReport => freezeRecord({
  runId,
  worktreeRootDir,
  isClean: drift.length === 0 && collisions.length === 0 && orphans.length === 0,
  healthy: freezeList(healthy),
  drift: freezeList(drift),
  collisions: freezeList(collisions),
  orphans: freezeList(orphans)
});

export const createSupervisorLaneWorktreeProvisioner = (
  options: SupervisorLaneWorktreeProvisionerOptions
): SupervisorLaneWorktreeProvisioner => {
  const repoRoot = path.resolve(assertNonEmpty(options.repoRoot, "repo root"));
  const store = options.store;
  const worktreeRootDir = path.resolve(options.worktreeRootDir ?? DEFAULT_SUPERVISOR_WORKTREE_ROOT);
  const system = options.system ?? createNodeSupervisorLaneWorktreeSystem(repoRoot);

  const reconcileLaneWorktrees = (runId: string): SupervisorLaneWorktreeReconciliationReport => {
    const normalizedRunId = assertNonEmpty(runId, "run id");
    const state = store.getRunState(normalizedRunId);

    if (!state) {
      throw new Error(`Cannot reconcile lane worktrees for unknown run '${normalizedRunId}'.`);
    }

    const runWorktreeRoot = getRunWorktreeRoot(worktreeRootDir, normalizedRunId);
    const activeWorktrees = state.worktrees.filter((worktree) => worktree.status !== "released");
    const actualGitWorktrees = new Map(system.listGitWorktrees().map((entry) => [entry.path, entry]));
    const managedPaths = new Set(system.listManagedLanePaths(runWorktreeRoot));
    const pathCollisions = buildPathCollisionMap(activeWorktrees);
    const branchCollisions = buildBranchCollisionMap(activeWorktrees);
    const healthy: SupervisorLaneWorktreeHealth[] = [];
    const drift: SupervisorLaneWorktreeDrift[] = [];
    const collisions: SupervisorLaneWorktreeCollision[] = [];
    const orphans: SupervisorLaneWorktreeOrphan[] = [];

    for (const worktree of activeWorktrees) {
      const normalizedPath = normalizeWorktreePath(worktree.path);
      const lane = findLane(state, worktree.laneId);
      const gitWorktree = actualGitWorktrees.get(normalizedPath);
      const samePathRecords = pathCollisions.get(normalizedPath) ?? [];
      const sameBranchRecords = branchCollisions.get(worktree.branch) ?? [];
      managedPaths.delete(normalizedPath);

      if (samePathRecords.length > 1) {
        collisions.push({
          laneId: worktree.laneId,
          worktreeId: worktree.worktreeId,
          path: normalizedPath,
          reason: `Path '${normalizedPath}' is claimed by multiple durable worktree records.`
        });
      }

      if (sameBranchRecords.length > 1) {
        collisions.push({
          laneId: worktree.laneId,
          worktreeId: worktree.worktreeId,
          branch: worktree.branch,
          reason: `Branch '${worktree.branch}' is claimed by multiple durable worktree records.`
        });
      }

      if (!lane) {
        orphans.push({
          worktreeId: worktree.worktreeId,
          path: normalizedPath,
          branch: worktree.branch,
          reason: `Durable worktree '${worktree.worktreeId}' no longer maps to a lane record.`
        });
        continue;
      }

      if (lane.worktreeId !== worktree.worktreeId) {
        drift.push({
          laneId: lane.laneId,
          worktreeId: worktree.worktreeId,
          reason: `Lane '${lane.laneId}' points at '${lane.worktreeId ?? "none"}' instead of durable worktree '${worktree.worktreeId}'.`
        });
      }

      if (lane.branch !== worktree.branch) {
        drift.push({
          laneId: lane.laneId,
          worktreeId: worktree.worktreeId,
          reason: `Lane '${lane.laneId}' expects branch '${lane.branch}', but durable worktree '${worktree.worktreeId}' tracks '${worktree.branch}'.`
        });
      }

      if (!system.pathExists(normalizedPath)) {
        drift.push({
          laneId: lane.laneId,
          worktreeId: worktree.worktreeId,
          reason: `Durable worktree '${worktree.worktreeId}' is missing from '${normalizedPath}'.`
        });
        continue;
      }

      if (!gitWorktree) {
        drift.push({
          laneId: lane.laneId,
          worktreeId: worktree.worktreeId,
          reason: `Filesystem path '${normalizedPath}' exists, but git no longer reports it as a worktree.`
        });
        continue;
      }

      if (gitWorktree.branch !== undefined && gitWorktree.branch !== worktree.branch) {
        drift.push({
          laneId: lane.laneId,
          worktreeId: worktree.worktreeId,
          reason: `Git reports branch '${gitWorktree.branch}' at '${normalizedPath}', but durable state expects '${worktree.branch}'.`
        });
        continue;
      }

      healthy.push(buildHealthyWorktree(worktree));
    }

    for (const remainingPath of managedPaths) {
      const gitWorktree = actualGitWorktrees.get(remainingPath);
      orphans.push({
        path: remainingPath,
        branch: gitWorktree?.branch,
        reason: "A managed worktree path exists on disk without a durable lane/worktree record."
      });
    }

    return createReconciliationReport(normalizedRunId, runWorktreeRoot, healthy, drift, collisions, orphans);
  };

  const provisionLaneWorktree = (input: ProvisionSupervisorLaneWorktreeInput): ProvisionSupervisorLaneWorktreeResult => {
    const normalizedRunId = assertNonEmpty(input.runId, "run id");
    const normalizedLaneId = assertNonEmpty(input.laneId, "lane id");
    const normalizedBranch = assertNonEmpty(input.branch, "branch");
    const baseRef = assertNonEmpty(input.baseRef ?? "HEAD", "base ref");
    const worktreeId = buildWorktreeId(normalizedRunId, normalizedLaneId);
    const worktreePath = buildSupervisorManagedWorktreePath(normalizedRunId, normalizedLaneId, worktreeRootDir);
    const state = store.getRunState(normalizedRunId);

    if (!state) {
      throw new Error(`Cannot provision a lane worktree for unknown run '${normalizedRunId}'.`);
    }

    const reconciliation = reconcileLaneWorktrees(normalizedRunId);
    const lane = findLane(state, normalizedLaneId);
    const existingWorktree = findWorktree(state, worktreeId);
    const normalizedExistingPath = existingWorktree ? normalizeWorktreePath(existingWorktree.path) : undefined;
    const actualGitWorktrees = system.listGitWorktrees();
    const gitAtTargetPath = actualGitWorktrees.find((entry) => entry.path === worktreePath);
    const gitUsingBranch = actualGitWorktrees.find((entry) => entry.branch === normalizedBranch);
    const reasons: string[] = [];

    if (reconciliation.collisions.some((issue) => issue.laneId === normalizedLaneId || issue.branch === normalizedBranch || issue.path === worktreePath)) {
      reasons.push("Reconciliation detected a collision involving the requested lane, branch, or target path.");
    }

    if (reconciliation.drift.some((issue) => issue.laneId === normalizedLaneId || issue.worktreeId === worktreeId)) {
      reasons.push("Reconciliation detected drift for the requested lane worktree; rebuild or release it before provisioning again.");
    }

    if (gitUsingBranch && gitUsingBranch.path !== worktreePath) {
      reasons.push(`Branch '${normalizedBranch}' is already checked out at '${gitUsingBranch.path}'.`);
    }

    if (gitAtTargetPath && gitAtTargetPath.branch !== undefined && gitAtTargetPath.branch !== normalizedBranch) {
      reasons.push(`Target path '${worktreePath}' already contains branch '${gitAtTargetPath.branch}'.`);
    }

    if (lane && lane.worktreeId && lane.worktreeId !== worktreeId) {
      reasons.push(`Lane '${normalizedLaneId}' is already mapped to durable worktree '${lane.worktreeId}'.`);
    }

    if (existingWorktree && normalizedExistingPath !== worktreePath) {
      reasons.push(`Durable worktree '${worktreeId}' points at '${normalizedExistingPath}', not '${worktreePath}'.`);
    }

    if (reasons.length > 0) {
      return {
        action: "blocked",
        worktree: existingWorktree ?? buildWorktreeRecord(normalizedLaneId, worktreeId, worktreePath, normalizedBranch, input.occurredAt),
        lane: buildLaneRecord(lane, input, worktreeId),
        reconciliation,
        reasons: freezeList(reasons)
      };
    }

    if (existingWorktree && normalizedExistingPath === worktreePath && system.pathExists(worktreePath) && gitAtTargetPath?.branch === normalizedBranch) {
      const nextLane = buildLaneRecord(lane, input, worktreeId);
      const nextWorktree = buildWorktreeRecord(normalizedLaneId, worktreeId, worktreePath, normalizedBranch, input.occurredAt);
      store.commitMutation(normalizedRunId, {
        mutationId: input.mutationId,
        actor: input.actor,
        summary: input.summary ?? `Reuse lane worktree for '${normalizedLaneId}'.`,
        occurredAt: input.occurredAt,
        laneUpserts: [nextLane],
        worktreeUpserts: [nextWorktree],
        sideEffects: ["reused-worktree"]
      });

      return {
        action: "reused",
        worktree: nextWorktree,
        lane: nextLane,
        reconciliation,
        reasons: freezeList([])
      };
    }

    system.createWorktree({
      path: worktreePath,
      branch: normalizedBranch,
      baseRef,
      createBranch: !system.branchExists(normalizedBranch)
    });

    const nextLane = buildLaneRecord(lane, input, worktreeId);
    const nextWorktree = buildWorktreeRecord(normalizedLaneId, worktreeId, worktreePath, normalizedBranch, input.occurredAt);
    store.commitMutation(normalizedRunId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Provision lane worktree for '${normalizedLaneId}'.`,
      occurredAt: input.occurredAt,
      laneUpserts: [nextLane],
      worktreeUpserts: [nextWorktree],
      sideEffects: ["created-worktree"]
    });

    return {
      action: "created",
      worktree: nextWorktree,
      lane: nextLane,
      reconciliation,
      reasons: freezeList([])
    };
  };

  const releaseLaneWorktree = (input: ReleaseSupervisorLaneWorktreeInput): ReleaseSupervisorLaneWorktreeResult => {
    const normalizedRunId = assertNonEmpty(input.runId, "run id");
    const normalizedLaneId = assertNonEmpty(input.laneId, "lane id");
    const state = store.getRunState(normalizedRunId);

    if (!state) {
      throw new Error(`Cannot release a lane worktree for unknown run '${normalizedRunId}'.`);
    }

    const lane = findLane(state, normalizedLaneId);
    if (!lane || !lane.worktreeId) {
      throw new Error(`Lane '${normalizedLaneId}' does not have a provisioned worktree to release.`);
    }

    const worktree = findWorktree(state, lane.worktreeId);
    if (!worktree) {
      throw new Error(`Lane '${normalizedLaneId}' points at unknown durable worktree '${lane.worktreeId}'.`);
    }

    const normalizedPath = normalizeWorktreePath(worktree.path);
    if (worktree.status !== "released" && system.pathExists(normalizedPath)) {
      system.removeWorktree(normalizedPath);
    }

    const nextLane = buildReleaseLaneRecord(lane, input.occurredAt);
    const nextWorktree = buildWorktreeRecord(normalizedLaneId, worktree.worktreeId, normalizedPath, worktree.branch, input.occurredAt, "released");
    store.commitMutation(normalizedRunId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Release lane worktree for '${normalizedLaneId}'.`,
      occurredAt: input.occurredAt,
      laneUpserts: [nextLane],
      worktreeUpserts: [nextWorktree],
      sideEffects: ["released-worktree"]
    });

    return {
      action: worktree.status === "released" ? "already-released" : "released",
      worktree: nextWorktree,
      lane: nextLane
    };
  };

  return {
    provisionLaneWorktree,
    releaseLaneWorktree,
    reconcileLaneWorktrees
  };
};
