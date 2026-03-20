import type {
  SupervisorLaneRecord,
  SupervisorPersistedSessionStatus,
  SupervisorRunState,
  SupervisorSessionRecord,
  SupervisorStateStore,
  SupervisorWorktreeRecord
} from "./durable-state-store";
import type { ChildSessionRecord, ChildSessionState } from "./child-session-lifecycle";
import { assertChildSessionTransition, canTransitionChildSession } from "./child-session-lifecycle";

export const DEFAULT_SUPERVISOR_SESSION_STALL_TIMEOUT_MS = 5 * 60 * 1000;

export type SupervisorSessionRuntimeKind = "opencode";
export type SupervisorRuntimeSessionStatus = Extract<
  SupervisorPersistedSessionStatus,
  "active" | "paused" | "completed" | "failed"
>;

export type SupervisorRuntimeSessionSnapshot = {
  runtimeSessionId: string;
  owner: string;
  status: SupervisorRuntimeSessionStatus;
  attachedAt: string;
  lastHeartbeatAt?: string;
  failureReason?: string;
};

export type LaunchSupervisorRuntimeSessionInput = {
  runId: string;
  laneId: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  owner: string;
  occurredAt: string;
  resumeSessionId?: string;
};

export type AttachSupervisorRuntimeSessionInput = {
  runId: string;
  laneId: string;
  worktreeId: string;
  worktreePath: string;
  branch: string;
  sessionId: string;
  owner: string;
  occurredAt: string;
};

export type SupervisorSessionRuntimeAdapter = {
  runtime: SupervisorSessionRuntimeKind;
  launchSession(input: LaunchSupervisorRuntimeSessionInput): Promise<SupervisorRuntimeSessionSnapshot>;
  attachSession(input: AttachSupervisorRuntimeSessionInput): Promise<SupervisorRuntimeSessionSnapshot>;
};

export type SupervisorSessionBinding = {
  lane: SupervisorLaneRecord;
  worktree: SupervisorWorktreeRecord;
  currentSession?: SupervisorSessionRecord;
};

export type LaunchSupervisorSessionInput = {
  runId: string;
  laneId: string;
  owner: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  summary?: string;
};

export type ResumeSupervisorSessionInput = {
  runId: string;
  laneId: string;
  owner: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  sessionId?: string;
  summary?: string;
};

export type PauseSupervisorSessionInput = {
  runId: string;
  laneId: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  sessionId?: string;
  summary?: string;
};

export type ReplaceSupervisorSessionInput = {
  runId: string;
  laneId: string;
  owner: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  summary?: string;
};

export type RecordSupervisorSessionHeartbeatInput = {
  runId: string;
  laneId: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  sessionId?: string;
  status?: SupervisorRuntimeSessionStatus;
  owner?: string;
  lastHeartbeatAt?: string;
  failureReason?: string;
  summary?: string;
};

export type DetectStalledSupervisorSessionInput = {
  runId: string;
  laneId: string;
  actor: string;
  mutationId: string;
  observedAt: string;
  stallTimeoutMs?: number;
  failureReason?: string;
  summary?: string;
};

export type CancelSupervisorSessionInput = {
  runId: string;
  laneId: string;
  actor: string;
  mutationId: string;
  occurredAt: string;
  sessionId?: string;
  cancelledReason?: string;
  summary?: string;
};

export type SupervisorSessionLifecycleResultAction =
  | "launched"
  | "paused"
  | "resumed"
  | "replaced"
  | "heartbeat-recorded"
  | "stalled"
  | "cancelled"
  | "unchanged";

export type SupervisorSessionLifecycleResult = {
  action: SupervisorSessionLifecycleResultAction;
  lane: SupervisorLaneRecord;
  worktree: SupervisorWorktreeRecord;
  session: SupervisorSessionRecord;
  previousSession?: SupervisorSessionRecord;
};

export type SupervisorSessionLifecycle = {
  getLaneSessionBinding(runId: string, laneId: string): Promise<SupervisorSessionBinding>;
  launchSession(input: LaunchSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult>;
  pauseSession(input: PauseSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult>;
  resumeSession(input: ResumeSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult>;
  replaceSession(input: ReplaceSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult>;
  recordHeartbeat(input: RecordSupervisorSessionHeartbeatInput): Promise<SupervisorSessionLifecycleResult>;
  detectStalledSession(input: DetectStalledSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult>;
  cancelSession(input: CancelSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult>;
};

export type CreateSupervisorSessionLifecycleOptions = {
  store: SupervisorStateStore;
  runtime: SupervisorSessionRuntimeAdapter;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor session lifecycle requires a non-empty ${field}.`);
  }

  return normalized;
};

const assertTimestamp = (value: string, field: string): string => {
  const normalized = assertNonEmpty(value, field);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Supervisor session lifecycle requires a valid ${field}.`);
  }

  return normalized;
};

const buildSupervisorSessionId = (runId: string, laneId: string, attempt: number): string => (
  `${assertNonEmpty(runId, "run id")}:${assertNonEmpty(laneId, "lane id")}:session-${String(attempt).padStart(2, "0")}`
);

const findLane = (state: SupervisorRunState, laneId: string): SupervisorLaneRecord | undefined => (
  state.lanes.find((lane) => lane.laneId === laneId)
);

const findWorktree = (state: SupervisorRunState, worktreeId: string): SupervisorWorktreeRecord | undefined => (
  state.worktrees.find((worktree) => worktree.worktreeId === worktreeId)
);

const findSession = (state: SupervisorRunState, sessionId: string): SupervisorSessionRecord | undefined => (
  state.sessions.find((session) => session.sessionId === sessionId)
);

const resolveRunState = async (store: SupervisorStateStore, runId: string): Promise<SupervisorRunState> => {
  const normalizedRunId = assertNonEmpty(runId, "run id");
  const state = await store.getRunState(normalizedRunId);

  if (!state) {
    throw new Error(`Cannot manage sessions for unknown run '${normalizedRunId}'.`);
  }

  return state;
};

const resolveLaneSessionBinding = (
  state: SupervisorRunState,
  laneId: string
): SupervisorSessionBinding => {
  const normalizedLaneId = assertNonEmpty(laneId, "lane id");
  const lane = findLane(state, normalizedLaneId);

  if (!lane) {
    throw new Error(`Run '${state.run.runId}' does not include lane '${normalizedLaneId}'.`);
  }

  if (!lane.worktreeId) {
    throw new Error(`Lane '${normalizedLaneId}' does not have a provisioned worktree.`);
  }

  const worktree = findWorktree(state, lane.worktreeId);
  if (!worktree || worktree.status === "released") {
    throw new Error(`Lane '${normalizedLaneId}' does not have an active durable worktree binding.`);
  }

  const currentSession = lane.sessionId ? findSession(state, lane.sessionId) : undefined;

  return freezeRecord({
    lane,
    worktree,
    currentSession
  });
};

const countLaneSessionAttempts = (
  state: SupervisorRunState,
  laneId: string,
  worktreeId: string
): number => state.sessions.filter((session) => session.laneId === laneId && session.worktreeId === worktreeId).length;

const buildLaneRecord = (
  lane: SupervisorLaneRecord,
  sessionId: string,
  updatedAt: string
): SupervisorLaneRecord => freezeRecord({
  ...lane,
  sessionId,
  updatedAt
});

const buildSessionRecord = (
  sessionId: string,
  binding: SupervisorSessionBinding,
  runtime: SupervisorSessionRuntimeAdapter,
  snapshot: SupervisorRuntimeSessionSnapshot,
  startedAt: string,
  updatedAt: string,
  previousSession?: SupervisorSessionRecord
): SupervisorSessionRecord => freezeRecord({
  sessionId,
  laneId: binding.lane.laneId,
  worktreeId: binding.worktree.worktreeId,
  status: snapshot.status,
  runtime: runtime.runtime,
  owner: snapshot.owner,
  startedAt,
  attachedAt: snapshot.attachedAt,
  lastHeartbeatAt: snapshot.lastHeartbeatAt,
  failureReason: snapshot.failureReason,
  replacementOfSessionId: previousSession?.sessionId,
  updatedAt
});

const replaceSessionRecord = (
  session: SupervisorSessionRecord,
  status: SupervisorSessionRecord["status"],
  updatedAt: string,
  updates: Partial<Pick<SupervisorSessionRecord, "owner" | "attachedAt" | "lastHeartbeatAt" | "failureReason" | "replacedBySessionId">> = {}
): SupervisorSessionRecord => freezeRecord({
  ...session,
  status,
  owner: updates.owner ?? session.owner,
  attachedAt: updates.attachedAt ?? session.attachedAt,
  lastHeartbeatAt: updates.lastHeartbeatAt ?? session.lastHeartbeatAt,
  failureReason: updates.failureReason,
  replacedBySessionId: updates.replacedBySessionId ?? session.replacedBySessionId,
  updatedAt
});

const resolveExistingSession = (
  binding: SupervisorSessionBinding,
  state: SupervisorRunState,
  sessionId?: string
): SupervisorSessionRecord => {
  const targetSessionId = sessionId ?? binding.currentSession?.sessionId;

  if (!targetSessionId) {
    throw new Error(`Lane '${binding.lane.laneId}' does not have a durable session to resume or replace.`);
  }

  const session = findSession(state, targetSessionId);
  if (!session) {
    throw new Error(`Lane '${binding.lane.laneId}' points at unknown durable session '${targetSessionId}'.`);
  }

  if (session.worktreeId !== binding.worktree.worktreeId) {
    throw new Error(`Session '${targetSessionId}' no longer belongs to lane '${binding.lane.laneId}' worktree '${binding.worktree.worktreeId}'.`);
  }

  return session;
};

const DEFAULT_CHILD_SESSION_HEARTBEAT_INTERVAL_MS = 30_000;
const DEFAULT_CHILD_SESSION_MAX_RETRIES = 2;

const buildChildSessionRecord = (
  sessionId: string,
  parentRunId: string,
  laneId: string,
  worktreeId: string,
  state: ChildSessionState,
  occurredAt: string,
  owner?: string
): ChildSessionRecord => ({
  sessionId,
  parentRunId,
  laneId,
  worktreeId,
  correlationId: `${parentRunId}:${laneId}:${sessionId}`,
  state,
  owner,
  heartbeatIntervalMs: DEFAULT_CHILD_SESSION_HEARTBEAT_INTERVAL_MS,
  heartbeatCount: 0,
  retryCount: 0,
  maxRetries: DEFAULT_CHILD_SESSION_MAX_RETRIES,
  startedAt: occurredAt,
  updatedAt: occurredAt
});

const findChildSession = (state: SupervisorRunState, sessionId: string): ChildSessionRecord | undefined => (
  state.childSessions.find((cs) => cs.sessionId === sessionId)
);

const transitionChildSession = (
  record: ChildSessionRecord,
  to: ChildSessionState,
  updatedAt: string,
  updates: Partial<Pick<ChildSessionRecord, "lastHeartbeatAt" | "heartbeatCount" | "cancelledReason" | "completedAt">> = {}
): ChildSessionRecord => {
  assertChildSessionTransition(record.state, to);
  return {
    ...record,
    previousState: record.state,
    state: to,
    lastHeartbeatAt: updates.lastHeartbeatAt ?? record.lastHeartbeatAt,
    heartbeatCount: updates.heartbeatCount ?? record.heartbeatCount,
    cancelledReason: updates.cancelledReason ?? record.cancelledReason,
    completedAt: updates.completedAt ?? record.completedAt,
    updatedAt
  };
};

const validateLaunchableSession = (binding: SupervisorSessionBinding): void => {
  if (!binding.currentSession) {
    return;
  }

  if (!["failed", "replaced", "completed"].includes(binding.currentSession.status)) {
    throw new Error(
      `Lane '${binding.lane.laneId}' already has active durable session '${binding.currentSession.sessionId}' in status '${binding.currentSession.status}'.`
    );
  }
};

export const createSupervisorSessionLifecycle = (
  options: CreateSupervisorSessionLifecycleOptions
): SupervisorSessionLifecycle => {
  const store = options.store;
  const runtime = options.runtime;

  const getLaneSessionBinding = async (runId: string, laneId: string): Promise<SupervisorSessionBinding> => (
    resolveLaneSessionBinding(await resolveRunState(store, runId), laneId)
  );

  const launchSession = async (input: LaunchSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult> => {
    const occurredAt = assertTimestamp(input.occurredAt, "mutation timestamp");
    const owner = assertNonEmpty(input.owner, "session owner");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    validateLaunchableSession(binding);
    const attempt = countLaneSessionAttempts(state, binding.lane.laneId, binding.worktree.worktreeId) + 1;
    const sessionId = buildSupervisorSessionId(state.run.runId, binding.lane.laneId, attempt);
    const snapshot = await runtime.launchSession({
      runId: state.run.runId,
      laneId: binding.lane.laneId,
      worktreeId: binding.worktree.worktreeId,
      worktreePath: binding.worktree.path,
      branch: binding.worktree.branch,
      owner,
      occurredAt
    });
    const lane = buildLaneRecord(binding.lane, sessionId, occurredAt);
    const session = buildSessionRecord(sessionId, binding, runtime, snapshot, occurredAt, occurredAt);
    const childSession = buildChildSessionRecord(
      sessionId,
      state.run.runId,
      binding.lane.laneId,
      binding.worktree.worktreeId,
      "launching",
      occurredAt,
      owner
    );

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Launch runtime session for lane '${binding.lane.laneId}'.`,
      occurredAt,
      laneUpserts: [lane],
      sessionUpserts: [session],
      childSessionUpserts: [childSession],
      sideEffects: ["launched-session"]
    });

    return {
      action: "launched",
      lane,
      worktree: binding.worktree,
      session
    };
  };

  const resumeSession = async (input: ResumeSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult> => {
    const occurredAt = assertTimestamp(input.occurredAt, "mutation timestamp");
    const owner = assertNonEmpty(input.owner, "session owner");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    const existingSession = resolveExistingSession(binding, state, input.sessionId);
    const snapshot = await runtime.attachSession({
      runId: state.run.runId,
      laneId: binding.lane.laneId,
      worktreeId: binding.worktree.worktreeId,
      worktreePath: binding.worktree.path,
      branch: binding.worktree.branch,
      sessionId: existingSession.sessionId,
      owner,
      occurredAt
    });
    const lane = buildLaneRecord(binding.lane, existingSession.sessionId, occurredAt);
    const session = freezeRecord({
      ...existingSession,
      status: snapshot.status,
      owner: snapshot.owner,
      attachedAt: snapshot.attachedAt,
      lastHeartbeatAt: snapshot.lastHeartbeatAt,
      failureReason: snapshot.failureReason,
      updatedAt: occurredAt
    });

    const childSessionUpserts: ChildSessionRecord[] = [];
    const existingChildSession = findChildSession(state, existingSession.sessionId);
    if (existingChildSession && canTransitionChildSession(existingChildSession.state, "active")) {
      childSessionUpserts.push(transitionChildSession(existingChildSession, "active", occurredAt));
    }

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Resume runtime session for lane '${binding.lane.laneId}'.`,
      occurredAt,
      laneUpserts: [lane],
      sessionUpserts: [session],
      childSessionUpserts,
      sideEffects: ["attached-session"]
    });

    return {
      action: "resumed",
      lane,
      worktree: binding.worktree,
      session
    };
  };

  const pauseSession = async (input: PauseSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult> => {
    const occurredAt = assertTimestamp(input.occurredAt, "mutation timestamp");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    const existingSession = resolveExistingSession(binding, state, input.sessionId);

    if (existingSession.status === "paused") {
      return {
        action: "unchanged",
        lane: binding.lane,
        worktree: binding.worktree,
        session: existingSession
      };
    }

    const pausedSession = replaceSessionRecord(existingSession, "paused", occurredAt, {
      owner: existingSession.owner,
      attachedAt: existingSession.attachedAt,
      lastHeartbeatAt: existingSession.lastHeartbeatAt
    });

    const childSessionUpserts: ChildSessionRecord[] = [];
    const existingChildSession = findChildSession(state, existingSession.sessionId);
    if (existingChildSession && canTransitionChildSession(existingChildSession.state, "paused")) {
      childSessionUpserts.push(transitionChildSession(existingChildSession, "paused", occurredAt));
    }

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Pause runtime session for lane '${binding.lane.laneId}'.`,
      occurredAt,
      sessionUpserts: [pausedSession],
      childSessionUpserts,
      sideEffects: ["paused-session"]
    });

    return {
      action: "paused",
      lane: binding.lane,
      worktree: binding.worktree,
      session: pausedSession
    };
  };

  const replaceSession = async (input: ReplaceSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult> => {
    const occurredAt = assertTimestamp(input.occurredAt, "mutation timestamp");
    const owner = assertNonEmpty(input.owner, "session owner");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    const previousSession = resolveExistingSession(binding, state);
    const attempt = countLaneSessionAttempts(state, binding.lane.laneId, binding.worktree.worktreeId) + 1;
    const sessionId = buildSupervisorSessionId(state.run.runId, binding.lane.laneId, attempt);
    const snapshot = await runtime.launchSession({
      runId: state.run.runId,
      laneId: binding.lane.laneId,
      worktreeId: binding.worktree.worktreeId,
      worktreePath: binding.worktree.path,
      branch: binding.worktree.branch,
      owner,
      occurredAt,
      resumeSessionId: previousSession.sessionId
    });
    const lane = buildLaneRecord(binding.lane, sessionId, occurredAt);
    const session = buildSessionRecord(sessionId, binding, runtime, snapshot, occurredAt, occurredAt, previousSession);
    const retiredSession = replaceSessionRecord(previousSession, "replaced", occurredAt, {
      failureReason: previousSession.failureReason ?? "Replaced by a newer runtime session.",
      replacedBySessionId: sessionId
    });

    const childSessionUpserts: ChildSessionRecord[] = [];
    const existingChildSession = findChildSession(state, previousSession.sessionId);
    if (existingChildSession && canTransitionChildSession(existingChildSession.state, "cancelled")) {
      childSessionUpserts.push(transitionChildSession(existingChildSession, "cancelled", occurredAt, {
        cancelledReason: "Replaced by a newer runtime session."
      }));
    }
    const newChildSession = buildChildSessionRecord(
      sessionId,
      state.run.runId,
      binding.lane.laneId,
      binding.worktree.worktreeId,
      "launching",
      occurredAt,
      owner
    );
    childSessionUpserts.push(newChildSession);

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Replace runtime session for lane '${binding.lane.laneId}'.`,
      occurredAt,
      laneUpserts: [lane],
      sessionUpserts: [retiredSession, session],
      childSessionUpserts,
      sideEffects: ["replaced-session"]
    });

    return {
      action: "replaced",
      lane,
      worktree: binding.worktree,
      session,
      previousSession: retiredSession
    };
  };

  const recordHeartbeat = async (input: RecordSupervisorSessionHeartbeatInput): Promise<SupervisorSessionLifecycleResult> => {
    const occurredAt = assertTimestamp(input.occurredAt, "mutation timestamp");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    const session = resolveExistingSession(binding, state, input.sessionId);
    const nextStatus = input.status ?? session.status;
    const nextHeartbeatAt = input.lastHeartbeatAt === undefined
      ? session.lastHeartbeatAt
      : assertTimestamp(input.lastHeartbeatAt, "heartbeat timestamp");
    const nextOwner = input.owner === undefined
      ? session.owner
      : assertNonEmpty(input.owner, "session owner");
    const nextSession = freezeRecord({
      ...session,
      status: nextStatus,
      owner: nextOwner,
      lastHeartbeatAt: nextHeartbeatAt,
      failureReason: input.failureReason,
      updatedAt: occurredAt
    });

    const childSessionUpserts: ChildSessionRecord[] = [];
    const existingChildSession = findChildSession(state, session.sessionId);
    if (existingChildSession) {
      const nextChildState: ChildSessionState = existingChildSession.state === "launching" ? "active" : existingChildSession.state;
      const shouldTransition = nextChildState !== existingChildSession.state;
      if (shouldTransition) {
        childSessionUpserts.push(transitionChildSession(existingChildSession, nextChildState, occurredAt, {
          lastHeartbeatAt: occurredAt,
          heartbeatCount: existingChildSession.heartbeatCount + 1
        }));
      } else {
        childSessionUpserts.push({
          ...existingChildSession,
          lastHeartbeatAt: occurredAt,
          heartbeatCount: existingChildSession.heartbeatCount + 1,
          updatedAt: occurredAt
        });
      }
    }

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Record heartbeat for lane '${binding.lane.laneId}' session '${session.sessionId}'.`,
      occurredAt,
      sessionUpserts: [nextSession],
      childSessionUpserts,
      sideEffects: ["recorded-session-heartbeat"]
    });

    return {
      action: "heartbeat-recorded",
      lane: binding.lane,
      worktree: binding.worktree,
      session: nextSession
    };
  };

  const detectStalledSession = async (input: DetectStalledSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult> => {
    const observedAt = assertTimestamp(input.observedAt, "stall observation timestamp");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    const session = resolveExistingSession(binding, state);

    if (session.status === "completed" || session.status === "failed" || session.status === "replaced") {
      return {
        action: "unchanged",
        lane: binding.lane,
        worktree: binding.worktree,
        session
      };
    }

    const lastHeartbeatAt = session.lastHeartbeatAt ?? session.attachedAt ?? session.startedAt;
    if (!lastHeartbeatAt) {
      throw new Error(`Session '${session.sessionId}' does not have a heartbeat or attachment timestamp to evaluate.`);
    }

    const stallTimeoutMs = input.stallTimeoutMs ?? DEFAULT_SUPERVISOR_SESSION_STALL_TIMEOUT_MS;
    const elapsedMs = Date.parse(observedAt) - Date.parse(lastHeartbeatAt);

    if (elapsedMs < stallTimeoutMs) {
      return {
        action: "unchanged",
        lane: binding.lane,
        worktree: binding.worktree,
        session
      };
    }

    const stalledSession = replaceSessionRecord(session, "stalled", observedAt, {
      failureReason: input.failureReason ?? `Heartbeat exceeded stall timeout after ${stallTimeoutMs}ms.`
    });

    const childSessionUpserts: ChildSessionRecord[] = [];
    const existingChildSession = findChildSession(state, session.sessionId);
    if (existingChildSession && canTransitionChildSession(existingChildSession.state, "stalled")) {
      childSessionUpserts.push(transitionChildSession(existingChildSession, "stalled", observedAt));
    }

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Mark lane '${binding.lane.laneId}' session '${session.sessionId}' as stalled.`,
      occurredAt: observedAt,
      sessionUpserts: [stalledSession],
      childSessionUpserts,
      sideEffects: ["stalled-session"]
    });

    return {
      action: "stalled",
      lane: binding.lane,
      worktree: binding.worktree,
      session: stalledSession
    };
  };

  const cancelSession = async (input: CancelSupervisorSessionInput): Promise<SupervisorSessionLifecycleResult> => {
    const occurredAt = assertTimestamp(input.occurredAt, "mutation timestamp");
    const state = await resolveRunState(store, input.runId);
    const binding = resolveLaneSessionBinding(state, input.laneId);
    const existingSession = resolveExistingSession(binding, state, input.sessionId);
    const cancelledReason = input.cancelledReason ?? "Cancelled by supervisor.";

    const cancelledSupervisorSession = replaceSessionRecord(existingSession, "failed", occurredAt, {
      failureReason: cancelledReason
    });

    const childSessionUpserts: ChildSessionRecord[] = [];
    const existingChildSession = findChildSession(state, existingSession.sessionId);
    if (existingChildSession) {
      if (canTransitionChildSession(existingChildSession.state, "cancelling")) {
        const cancellingChild = transitionChildSession(existingChildSession, "cancelling", occurredAt, {
          cancelledReason
        });
        const cancelledChild = transitionChildSession(cancellingChild, "cancelled", occurredAt, {
          cancelledReason
        });
        childSessionUpserts.push(cancelledChild);
      } else if (canTransitionChildSession(existingChildSession.state, "cancelled")) {
        childSessionUpserts.push(transitionChildSession(existingChildSession, "cancelled", occurredAt, {
          cancelledReason
        }));
      }
    }

    await store.commitMutation(state.run.runId, {
      mutationId: input.mutationId,
      actor: input.actor,
      summary: input.summary ?? `Cancel runtime session for lane '${binding.lane.laneId}'.`,
      occurredAt,
      sessionUpserts: [cancelledSupervisorSession],
      childSessionUpserts,
      sideEffects: ["cancelled-session"]
    });

    return {
      action: "cancelled",
      lane: binding.lane,
      worktree: binding.worktree,
      session: cancelledSupervisorSession
    };
  };

  return {
    getLaneSessionBinding,
    launchSession,
    pauseSession,
    resumeSession,
    replaceSession,
    recordHeartbeat,
    detectStalledSession,
    cancelSession
  };
};

export { buildSupervisorSessionId };
