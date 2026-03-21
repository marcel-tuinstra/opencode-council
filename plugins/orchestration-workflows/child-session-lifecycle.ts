// ──────────────────────────────────────────────────────────────────────────────
// Child-session lifecycle: types, transition map, and pure functions.
// Wave 1A – opencode-council v0.6.0
// ──────────────────────────────────────────────────────────────────────────────

// ── State & transitions ─────────────────────────────────────────────────────

export type ChildSessionState =
  | "pending"
  | "launching"
  | "active"
  | "paused"
  | "stalled"
  | "recovering"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed";

export const CHILD_SESSION_TRANSITIONS: Readonly<Record<ChildSessionState, readonly ChildSessionState[]>> = {
  pending:    ["launching", "cancelled"],
  launching:  ["active", "failed", "cancelled"],
  active:     ["paused", "stalled", "completed", "failed", "cancelled", "cancelling"],
  paused:     ["active", "cancelled", "failed"],
  stalled:    ["recovering", "failed", "cancelled"],
  recovering: ["active", "failed", "cancelled"],
  cancelling: ["cancelled", "failed"],
  cancelled:  [],
  completed:  [],
  failed:     []
};

// ── Failure codes ───────────────────────────────────────────────────────────

export type ChildSessionFailureCode =
  | "heartbeat-timeout"
  | "runtime-crash"
  | "tool-outage"
  | "budget-exceeded"
  | "merge-conflict"
  | "cancelled-by-parent"
  | "unknown"
  | "partial-completion";

// ── Record ──────────────────────────────────────────────────────────────────

export type ChildSessionRecord = {
  sessionId: string;
  parentRunId: string;
  laneId: string;
  worktreeId?: string;
  correlationId: string;
  state: ChildSessionState;
  previousState?: ChildSessionState;
  owner?: string;
  budgetCeiling?: { maxTokens: number; warnAtPercent: number };
  startedAt?: string;
  lastHeartbeatAt?: string;
  heartbeatIntervalMs: number;
  heartbeatCount: number;
  failureCode?: ChildSessionFailureCode;
  failureDetail?: string;
  retryCount: number;
  maxRetries: number;
  cancelledReason?: string;
  completedAt?: string;
  updatedAt: string;
};

// ── Retry policy ────────────────────────────────────────────────────────────

export type ChildSessionRetryPolicy = {
  maxRetries: number;
  backoffBaseMs: number;
  backoffMultiplier: number;
};

export const DEFAULT_CHILD_SESSION_RETRY_POLICY: Readonly<ChildSessionRetryPolicy> = {
  maxRetries: 2,
  backoffBaseMs: 5_000,
  backoffMultiplier: 2
};

// ── Timeout policy ──────────────────────────────────────────────────────────

export type ChildSessionTimeoutPolicy = {
  heartbeatTimeoutMs: number;
  taskTimeoutMs: number;
  gracefulCancelTimeoutMs: number;
};

export const DEFAULT_CHILD_SESSION_TIMEOUT_POLICY: Readonly<ChildSessionTimeoutPolicy> = {
  heartbeatTimeoutMs: 300_000,
  taskTimeoutMs: 3_600_000,
  gracefulCancelTimeoutMs: 30_000
};

// ── Deduplication key ───────────────────────────────────────────────────────

export type ChildSessionDeduplicationKey = {
  laneId: string;
  worktreeId: string;
  state: ChildSessionState;
};

// ── Pure functions ──────────────────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<ChildSessionState> = new Set<ChildSessionState>(["cancelled", "completed", "failed"]);

export const isTerminalChildSessionState = (state: ChildSessionState): boolean => TERMINAL_STATES.has(state);

export const canTransitionChildSession = (from: ChildSessionState, to: ChildSessionState): boolean => (
  CHILD_SESSION_TRANSITIONS[from].includes(to)
);

export const assertChildSessionTransition = (from: ChildSessionState, to: ChildSessionState): void => {
  if (!canTransitionChildSession(from, to)) {
    throw new Error(`Invalid child-session transition: ${from} -> ${to}`);
  }
};

const RETRY_ELIGIBLE_CODES: ReadonlySet<ChildSessionFailureCode> = new Set<ChildSessionFailureCode>([
  "heartbeat-timeout",
  "runtime-crash",
  "tool-outage",
  "merge-conflict",
  "partial-completion",
  "unknown"
]);

export const classifyChildSessionFailure = (signal: {
  heartbeatMissing?: boolean;
  runtimeError?: string;
  budgetExceeded?: boolean;
  toolOutage?: boolean;
  partialCompletion?: boolean;
  mergeConflict?: boolean;
  cancelledByParent?: boolean;
}): { code: ChildSessionFailureCode; retryEligible: boolean } => {
  if (signal.cancelledByParent) {
    return { code: "cancelled-by-parent", retryEligible: false };
  }

  if (signal.budgetExceeded) {
    return { code: "budget-exceeded", retryEligible: false };
  }

  if (signal.toolOutage) {
    return { code: "tool-outage", retryEligible: true };
  }

  if (signal.partialCompletion) {
    return { code: "partial-completion", retryEligible: true };
  }

  if (signal.mergeConflict) {
    return { code: "merge-conflict", retryEligible: true };
  }

  if (signal.heartbeatMissing) {
    return { code: "heartbeat-timeout", retryEligible: true };
  }

  if (signal.runtimeError) {
    return { code: "runtime-crash", retryEligible: true };
  }

  return { code: "unknown", retryEligible: true };
};

export const resolveRetryEligibility = (
  record: ChildSessionRecord,
  policy: ChildSessionRetryPolicy
): { eligible: boolean; nextRetryDelayMs: number; reason: string } => {
  if (!record.failureCode) {
    return { eligible: false, nextRetryDelayMs: 0, reason: "No failure code present on record." };
  }

  if (!RETRY_ELIGIBLE_CODES.has(record.failureCode)) {
    return { eligible: false, nextRetryDelayMs: 0, reason: `Failure code '${record.failureCode}' is not retry-eligible.` };
  }

  if (record.retryCount >= policy.maxRetries) {
    return { eligible: false, nextRetryDelayMs: 0, reason: `Retry count ${record.retryCount} has reached the maximum of ${policy.maxRetries}.` };
  }

  const nextRetryDelayMs = policy.backoffBaseMs * Math.pow(policy.backoffMultiplier, record.retryCount);

  return {
    eligible: true,
    nextRetryDelayMs,
    reason: `Retry ${record.retryCount + 1} of ${policy.maxRetries} after ${nextRetryDelayMs}ms backoff.`
  };
};
