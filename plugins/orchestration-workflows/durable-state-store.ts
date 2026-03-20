import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LaneLifecycleState } from "./lane-lifecycle";
import type { ChildSessionRecord } from "./child-session-lifecycle";

export const SUPERVISOR_STATE_STORE_SCHEMA_VERSION = 2;
export const DEFAULT_SUPERVISOR_STATE_ROOT = ".opencode/supervisor/state";

export type SupervisorPersistedRunStatus =
  | "planned"
  | "active"
  | "paused"
  | "waiting"
  | "review_ready"
  | "completed"
  | "failed";

export type SupervisorPersistedWorktreeStatus = "active" | "parked" | "released";
export type SupervisorPersistedSessionStatus = "launching" | "active" | "paused" | "stalled" | "completed" | "failed" | "replaced";
export type SupervisorPersistedApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type SupervisorPersistedArtifactStatus = "pending" | "ready" | "superseded";
export type SupervisorPersistedArtifactKind = "branch" | "pull-request" | "review-packet" | "session-log" | "other";
export type SupervisorAuditEntityKind = "run" | "lane" | "worktree" | "session" | "approval" | "artifact";

export type SupervisorRunRecord = {
  runId: string;
  status: SupervisorPersistedRunStatus;
  objective: string;
  sourceOfTruth: "control-plane-state";
  createdAt: string;
  updatedAt: string;
};

export type SupervisorRunRecordInput = {
  runId: string;
  status: SupervisorPersistedRunStatus;
  objective: string;
  createdAt: string;
  updatedAt?: string;
};

export type SupervisorRunPatch = Partial<Pick<SupervisorRunRecord, "status" | "objective" | "updatedAt">>;

export type SupervisorLaneRecord = {
  laneId: string;
  state: LaneLifecycleState;
  branch: string;
  worktreeId?: string;
  sessionId?: string;
  updatedAt: string;
};

export type SupervisorWorktreeRecord = {
  worktreeId: string;
  laneId: string;
  path: string;
  branch: string;
  status: SupervisorPersistedWorktreeStatus;
  updatedAt: string;
};

export type SupervisorSessionRecord = {
  sessionId: string;
  laneId: string;
  worktreeId: string;
  status: SupervisorPersistedSessionStatus;
  runtime?: string;
  owner?: string;
  startedAt?: string;
  attachedAt?: string;
  lastHeartbeatAt?: string;
  failureReason?: string;
  replacementOfSessionId?: string;
  replacedBySessionId?: string;
  updatedAt: string;
};

export type SupervisorApprovalRecord = {
  approvalId: string;
  laneId: string;
  status: SupervisorPersistedApprovalStatus;
  boundary: "write" | "merge" | "release" | "destructive" | "security-sensitive" | "budget-exception" | "automation-widening";
  requestedAction: string;
  summary: string;
  rationale: string;
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  context?: {
    changedPaths?: readonly string[];
    targetRef?: string;
    budgetUsagePercent?: number;
    budgetThresholdPercent?: number;
    automationChangeSummary?: string;
    riskSummary?: string;
    metadata?: Readonly<Record<string, string>>;
  };
  updatedAt: string;
};

export type SupervisorArtifactRecord = {
  artifactId: string;
  laneId: string;
  kind: SupervisorPersistedArtifactKind;
  status: SupervisorPersistedArtifactStatus;
  uri: string;
  updatedAt: string;
};

export type SupervisorAuditEntityReference = {
  kind: SupervisorAuditEntityKind;
  id: string;
  state?: string;
};

export type SupervisorAuditEntry = {
  sequence: number;
  mutationId: string;
  actor: string;
  summary: string;
  occurredAt: string;
  sideEffects: readonly string[];
  entityRefs: readonly SupervisorAuditEntityReference[];
};

export type SupervisorRunState = {
  schemaVersion: typeof SUPERVISOR_STATE_STORE_SCHEMA_VERSION;
  run: SupervisorRunRecord;
  lanes: readonly SupervisorLaneRecord[];
  worktrees: readonly SupervisorWorktreeRecord[];
  sessions: readonly SupervisorSessionRecord[];
  childSessions: readonly ChildSessionRecord[];
  approvals: readonly SupervisorApprovalRecord[];
  artifacts: readonly SupervisorArtifactRecord[];
  appliedMutations: readonly string[];
  auditLog: readonly SupervisorAuditEntry[];
};

export type SupervisorRunStateMutation = {
  mutationId: string;
  actor: string;
  summary: string;
  occurredAt: string;
  createRun?: SupervisorRunRecordInput;
  runPatch?: SupervisorRunPatch;
  laneUpserts?: readonly SupervisorLaneRecord[];
  worktreeUpserts?: readonly SupervisorWorktreeRecord[];
  sessionUpserts?: readonly SupervisorSessionRecord[];
  childSessionUpserts?: readonly ChildSessionRecord[];
  approvalUpserts?: readonly SupervisorApprovalRecord[];
  artifactUpserts?: readonly SupervisorArtifactRecord[];
  sideEffects?: readonly string[];
};

export type SupervisorRunStorageLocation = {
  rootDir: string;
  runDir: string;
  stateFile: string;
  eventsDir: string;
};

export type SupervisorStateStore = {
  getRunState(runId: string): Promise<SupervisorRunState | null>;
  commitMutation(runId: string, mutation: SupervisorRunStateMutation): Promise<SupervisorRunState>;
  getRunStorageLocation(runId: string): SupervisorRunStorageLocation;
};

export type FileBackedSupervisorStateStoreOptions = {
  rootDir?: string;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor durable state requires a non-empty ${field}.`);
  }

  return normalized;
};

const assertTimestamp = (value: string, field: string): string => {
  const normalized = assertNonEmpty(value, field);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Supervisor durable state requires a valid ${field}.`);
  }

  return normalized;
};

const normalizeRunRecord = (input: SupervisorRunRecordInput): SupervisorRunRecord => {
  const createdAt = assertTimestamp(input.createdAt, "run created timestamp");
  const updatedAt = input.updatedAt === undefined
    ? createdAt
    : assertTimestamp(input.updatedAt, "run updated timestamp");

  return freezeRecord({
    runId: assertNonEmpty(input.runId, "run id"),
    status: input.status,
    objective: assertNonEmpty(input.objective, "run objective"),
    sourceOfTruth: "control-plane-state",
    createdAt,
    updatedAt
  });
};

const normalizeLaneRecord = (input: SupervisorLaneRecord): SupervisorLaneRecord => freezeRecord({
  laneId: assertNonEmpty(input.laneId, "lane id"),
  state: input.state,
  branch: assertNonEmpty(input.branch, "lane branch"),
  worktreeId: input.worktreeId ? assertNonEmpty(input.worktreeId, "lane worktree id") : undefined,
  sessionId: input.sessionId ? assertNonEmpty(input.sessionId, "lane session id") : undefined,
  updatedAt: assertTimestamp(input.updatedAt, "lane updated timestamp")
});

const normalizeWorktreeRecord = (input: SupervisorWorktreeRecord): SupervisorWorktreeRecord => freezeRecord({
  worktreeId: assertNonEmpty(input.worktreeId, "worktree id"),
  laneId: assertNonEmpty(input.laneId, "worktree lane id"),
  path: assertNonEmpty(input.path, "worktree path"),
  branch: assertNonEmpty(input.branch, "worktree branch"),
  status: input.status,
  updatedAt: assertTimestamp(input.updatedAt, "worktree updated timestamp")
});

const normalizeSessionRecord = (input: SupervisorSessionRecord): SupervisorSessionRecord => freezeRecord({
  sessionId: assertNonEmpty(input.sessionId, "session id"),
  laneId: assertNonEmpty(input.laneId, "session lane id"),
  worktreeId: assertNonEmpty(input.worktreeId, "session worktree id"),
  status: input.status,
  runtime: input.runtime ? assertNonEmpty(input.runtime, "session runtime") : undefined,
  owner: input.owner ? assertNonEmpty(input.owner, "session owner") : undefined,
  startedAt: input.startedAt ? assertTimestamp(input.startedAt, "session started timestamp") : undefined,
  attachedAt: input.attachedAt ? assertTimestamp(input.attachedAt, "session attached timestamp") : undefined,
  lastHeartbeatAt: input.lastHeartbeatAt ? assertTimestamp(input.lastHeartbeatAt, "session heartbeat timestamp") : undefined,
  failureReason: input.failureReason ? assertNonEmpty(input.failureReason, "session failure reason") : undefined,
  replacementOfSessionId: input.replacementOfSessionId
    ? assertNonEmpty(input.replacementOfSessionId, "session replacement source id")
    : undefined,
  replacedBySessionId: input.replacedBySessionId
    ? assertNonEmpty(input.replacedBySessionId, "session replacement target id")
    : undefined,
  updatedAt: assertTimestamp(input.updatedAt, "session updated timestamp")
});

const normalizeApprovalRecord = (input: SupervisorApprovalRecord): SupervisorApprovalRecord => freezeRecord({
  approvalId: assertNonEmpty(input.approvalId, "approval id"),
  laneId: assertNonEmpty(input.laneId, "approval lane id"),
  status: input.status,
  boundary: input.boundary,
  requestedAction: assertNonEmpty(input.requestedAction, "approval requested action"),
  summary: assertNonEmpty(input.summary, "approval summary"),
  rationale: assertNonEmpty(input.rationale, "approval rationale"),
  requestedBy: assertNonEmpty(input.requestedBy, "approval requester"),
  requestedAt: assertTimestamp(input.requestedAt, "approval requested timestamp"),
  decidedBy: input.decidedBy ? assertNonEmpty(input.decidedBy, "approval decider") : undefined,
  decidedAt: input.decidedAt ? assertTimestamp(input.decidedAt, "approval decided timestamp") : undefined,
  decisionNote: input.decisionNote ? assertNonEmpty(input.decisionNote, "approval decision note") : undefined,
  context: input.context === undefined ? undefined : freezeRecord({
    changedPaths: freezeList((input.context.changedPaths ?? []).map((value) => assertNonEmpty(value, "approval changed path"))),
    targetRef: input.context.targetRef ? assertNonEmpty(input.context.targetRef, "approval target ref") : undefined,
    budgetUsagePercent: input.context.budgetUsagePercent,
    budgetThresholdPercent: input.context.budgetThresholdPercent,
    automationChangeSummary: input.context.automationChangeSummary
      ? assertNonEmpty(input.context.automationChangeSummary, "approval automation summary")
      : undefined,
    riskSummary: input.context.riskSummary ? assertNonEmpty(input.context.riskSummary, "approval risk summary") : undefined,
    metadata: input.context.metadata === undefined ? undefined : freezeRecord(Object.fromEntries(
      Object.entries(input.context.metadata)
        .map(([key, value]) => [assertNonEmpty(key, "approval metadata key"), assertNonEmpty(value, "approval metadata value")])
    ))
  }),
  updatedAt: assertTimestamp(input.updatedAt, "approval updated timestamp")
});

const normalizeArtifactRecord = (input: SupervisorArtifactRecord): SupervisorArtifactRecord => freezeRecord({
  artifactId: assertNonEmpty(input.artifactId, "artifact id"),
  laneId: assertNonEmpty(input.laneId, "artifact lane id"),
  kind: input.kind,
  status: input.status,
  uri: assertNonEmpty(input.uri, "artifact uri"),
  updatedAt: assertTimestamp(input.updatedAt, "artifact updated timestamp")
});

const normalizeSideEffects = (items: readonly string[] | undefined): readonly string[] => freezeList(
  Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)))
);

const compareById = <T>(left: T, right: T, selectId: (value: T) => string): number => (
  selectId(left).localeCompare(selectId(right))
);

const upsertRecords = <T>(
  existing: readonly T[],
  updates: readonly T[],
  selectId: (value: T) => string
): readonly T[] => {
  const recordMap = new Map(existing.map((value) => [selectId(value), value]));

  for (const update of updates) {
    recordMap.set(selectId(update), update);
  }

  return freezeList(Array.from(recordMap.values()).sort((left, right) => compareById(left, right, selectId)));
};

const normalizeAuditEntityReference = (input: SupervisorAuditEntityReference): SupervisorAuditEntityReference => freezeRecord({
  kind: input.kind,
  id: assertNonEmpty(input.id, `${input.kind} reference id`),
  state: input.state ? assertNonEmpty(input.state, `${input.kind} reference state`) : undefined
});

const normalizeAuditEntry = (input: SupervisorAuditEntry): SupervisorAuditEntry => freezeRecord({
  sequence: input.sequence,
  mutationId: assertNonEmpty(input.mutationId, "audit mutation id"),
  actor: assertNonEmpty(input.actor, "audit actor"),
  summary: assertNonEmpty(input.summary, "audit summary"),
  occurredAt: assertTimestamp(input.occurredAt, "audit timestamp"),
  sideEffects: normalizeSideEffects(input.sideEffects),
  entityRefs: freezeList((input.entityRefs ?? []).map(normalizeAuditEntityReference))
});

const buildInitialRunState = (input: SupervisorRunRecordInput): SupervisorRunState => freezeRecord({
  schemaVersion: SUPERVISOR_STATE_STORE_SCHEMA_VERSION,
  run: normalizeRunRecord(input),
  lanes: freezeList([]),
  worktrees: freezeList([]),
  sessions: freezeList([]),
  childSessions: freezeList([]),
  approvals: freezeList([]),
  artifacts: freezeList([]),
  appliedMutations: freezeList([]),
  auditLog: freezeList([])
});

const normalizeRunPatch = (patch: SupervisorRunPatch | undefined): SupervisorRunPatch | undefined => {
  if (!patch) {
    return undefined;
  }

  return {
    status: patch.status,
    objective: patch.objective === undefined ? undefined : assertNonEmpty(patch.objective, "run objective"),
    updatedAt: patch.updatedAt === undefined ? undefined : assertTimestamp(patch.updatedAt, "run updated timestamp")
  };
};

const applyRunPatch = (run: SupervisorRunRecord, patch: SupervisorRunPatch | undefined): SupervisorRunRecord => {
  if (!patch) {
    return run;
  }

  return freezeRecord({
    ...run,
    status: patch.status ?? run.status,
    objective: patch.objective ?? run.objective,
    updatedAt: patch.updatedAt ?? run.updatedAt
  });
};

const buildAuditEntry = (
  state: SupervisorRunState,
  mutation: SupervisorRunStateMutation
): SupervisorAuditEntry => {
  const entityRefs: SupervisorAuditEntityReference[] = [];

  if (mutation.createRun || mutation.runPatch) {
    entityRefs.push({
      kind: "run",
      id: state.run.runId,
      state: state.run.status
    });
  }

  for (const lane of mutation.laneUpserts ?? []) {
    entityRefs.push({ kind: "lane", id: lane.laneId, state: lane.state });
  }

  for (const worktree of mutation.worktreeUpserts ?? []) {
    entityRefs.push({ kind: "worktree", id: worktree.worktreeId, state: worktree.status });
  }

  for (const session of mutation.sessionUpserts ?? []) {
    entityRefs.push({ kind: "session", id: session.sessionId, state: session.status });
  }

  for (const approval of mutation.approvalUpserts ?? []) {
    entityRefs.push({ kind: "approval", id: approval.approvalId, state: approval.status });
  }

  for (const artifact of mutation.artifactUpserts ?? []) {
    entityRefs.push({ kind: "artifact", id: artifact.artifactId, state: artifact.status });
  }

  return normalizeAuditEntry({
    sequence: state.auditLog.length + 1,
    mutationId: mutation.mutationId,
    actor: mutation.actor,
    summary: mutation.summary,
    occurredAt: mutation.occurredAt,
    sideEffects: mutation.sideEffects ?? [],
    entityRefs
  });
};

const normalizeRunState = (input: SupervisorRunState): SupervisorRunState => freezeRecord({
  schemaVersion: SUPERVISOR_STATE_STORE_SCHEMA_VERSION,
  run: normalizeRunRecord(input.run),
  lanes: freezeList(input.lanes.map(normalizeLaneRecord).sort((left, right) => compareById(left, right, (value) => value.laneId))),
  worktrees: freezeList(input.worktrees.map(normalizeWorktreeRecord).sort((left, right) => compareById(left, right, (value) => value.worktreeId))),
  sessions: freezeList(input.sessions.map(normalizeSessionRecord).sort((left, right) => compareById(left, right, (value) => value.sessionId))),
  childSessions: freezeList([...(input.childSessions ?? [])].sort((left, right) => compareById(left, right, (value) => value.sessionId))),
  approvals: freezeList(input.approvals.map(normalizeApprovalRecord).sort((left, right) => compareById(left, right, (value) => value.approvalId))),
  artifacts: freezeList(input.artifacts.map(normalizeArtifactRecord).sort((left, right) => compareById(left, right, (value) => value.artifactId))),
  appliedMutations: freezeList(Array.from(new Set(input.appliedMutations.map((value) => assertNonEmpty(value, "mutation id"))).values()).sort()),
  auditLog: freezeList(input.auditLog.map(normalizeAuditEntry).sort((left, right) => left.sequence - right.sequence))
});

const SUPPORTED_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1, SUPERVISOR_STATE_STORE_SCHEMA_VERSION]);

const assertKnownSchemaVersion = (value: unknown): void => {
  if (typeof value !== "number" || !SUPPORTED_SCHEMA_VERSIONS.has(value)) {
    throw new Error(`Unsupported supervisor durable state schema version: ${String(value)}`);
  }
};

const migrateRunState = (raw: Record<string, unknown>): SupervisorRunState => {
  const version = raw.schemaVersion as number;

  if (version === 1) {
    return {
      ...(raw as unknown as Omit<SupervisorRunState, "schemaVersion" | "childSessions">),
      schemaVersion: SUPERVISOR_STATE_STORE_SCHEMA_VERSION,
      childSessions: []
    } as SupervisorRunState;
  }

  return raw as unknown as SupervisorRunState;
};

const getRunStorageLocation = (rootDir: string, runId: string): SupervisorRunStorageLocation => {
  const normalizedRunId = assertNonEmpty(runId, "run id");
  const runDir = path.join(rootDir, "runs", normalizedRunId);

  return {
    rootDir,
    runDir,
    stateFile: path.join(runDir, "state.json"),
    eventsDir: path.join(runDir, "events")
  };
};

const readJsonFile = <T>(filePath: string): T => JSON.parse(readFileSync(filePath, "utf8")) as T;

const writeJsonAtomically = (filePath: string, value: unknown): void => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;

  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
};

const writeAuditEvent = (eventsDir: string, entry: SupervisorAuditEntry): void => {
  mkdirSync(eventsDir, { recursive: true });
  const fileName = `${String(entry.sequence).padStart(4, "0")}-${entry.mutationId}.json`;
  writeJsonAtomically(path.join(eventsDir, fileName), entry);
};

export const createFileBackedSupervisorStateStore = (
  options: FileBackedSupervisorStateStoreOptions = {}
): SupervisorStateStore => {
  const rootDir = path.resolve(options.rootDir ?? DEFAULT_SUPERVISOR_STATE_ROOT);

  return {
    getRunStorageLocation: (runId: string): SupervisorRunStorageLocation => getRunStorageLocation(rootDir, runId),

    getRunState: async (runId: string): Promise<SupervisorRunState | null> => {
      const location = getRunStorageLocation(rootDir, runId);

      try {
        const raw = readJsonFile<Record<string, unknown>>(location.stateFile);
        assertKnownSchemaVersion(raw.schemaVersion);
        return normalizeRunState(migrateRunState(raw));
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code === "ENOENT") {
          return null;
        }

        throw error;
      }
    },

    commitMutation: async (runId: string, mutation: SupervisorRunStateMutation): Promise<SupervisorRunState> => {
      const normalizedMutationId = assertNonEmpty(mutation.mutationId, "mutation id");
      const actor = assertNonEmpty(mutation.actor, "mutation actor");
      const summary = assertNonEmpty(mutation.summary, "mutation summary");
      const occurredAt = assertTimestamp(mutation.occurredAt, "mutation timestamp");
      const location = getRunStorageLocation(rootDir, runId);
      const currentState = (() => {
        const existing = (() => {
          try {
            const raw = readJsonFile<Record<string, unknown>>(location.stateFile);
            assertKnownSchemaVersion(raw.schemaVersion);
            return normalizeRunState(migrateRunState(raw));
          } catch (error) {
            const nodeError = error as NodeJS.ErrnoException;
            if (nodeError.code === "ENOENT") {
              return null;
            }

            throw error;
          }
        })();

        if (existing) {
          return existing;
        }

        if (!mutation.createRun) {
          throw new Error(`Cannot persist mutation '${normalizedMutationId}' before the supervisor run exists.`);
        }

        return buildInitialRunState(mutation.createRun);
      })();

      if (currentState.appliedMutations.includes(normalizedMutationId)) {
        return currentState;
      }

      const nextStateBase: SupervisorRunState = {
        schemaVersion: SUPERVISOR_STATE_STORE_SCHEMA_VERSION,
        run: applyRunPatch(currentState.run, normalizeRunPatch({
          ...mutation.runPatch,
          updatedAt: mutation.runPatch?.updatedAt ?? occurredAt
        })),
        lanes: upsertRecords(
          currentState.lanes,
          (mutation.laneUpserts ?? []).map(normalizeLaneRecord),
          (value) => value.laneId
        ),
        worktrees: upsertRecords(
          currentState.worktrees,
          (mutation.worktreeUpserts ?? []).map(normalizeWorktreeRecord),
          (value) => value.worktreeId
        ),
        sessions: upsertRecords(
          currentState.sessions,
          (mutation.sessionUpserts ?? []).map(normalizeSessionRecord),
          (value) => value.sessionId
        ),
        childSessions: upsertRecords(
          currentState.childSessions,
          mutation.childSessionUpserts ?? [],
          (value) => value.sessionId
        ),
        approvals: upsertRecords(
          currentState.approvals,
          (mutation.approvalUpserts ?? []).map(normalizeApprovalRecord),
          (value) => value.approvalId
        ),
        artifacts: upsertRecords(
          currentState.artifacts,
          (mutation.artifactUpserts ?? []).map(normalizeArtifactRecord),
          (value) => value.artifactId
        ),
        appliedMutations: freezeList([...currentState.appliedMutations, normalizedMutationId]),
        auditLog: currentState.auditLog
      };

      const auditEntry = buildAuditEntry(nextStateBase, {
        ...mutation,
        mutationId: normalizedMutationId,
        actor,
        summary,
        occurredAt
      });
      const nextState = normalizeRunState({
        ...nextStateBase,
        auditLog: [...nextStateBase.auditLog, auditEntry]
      });

      writeJsonAtomically(location.stateFile, nextState);
      writeAuditEvent(location.eventsDir, auditEntry);

      return nextState;
    }
  };
};
