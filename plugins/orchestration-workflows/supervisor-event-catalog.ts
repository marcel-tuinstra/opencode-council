// ─── Supervisor Event Catalog ───────────────────────────────────────────────
// Canonical event types, default levels, and pure factory functions for the
// supervisor observability surface. Every event the supervisor can emit is
// declared here so downstream consumers (dashboards, durability layer, replay
// tools) share a single source of truth.
// ────────────────────────────────────────────────────────────────────────────

// ── Event kind union ────────────────────────────────────────────────────────

/** MVP event kinds – the minimum viable observability surface. */
export type SupervisorMvpEventKind =
  | "session.launched"
  | "session.heartbeat"
  | "session.stalled"
  | "session.failed"
  | "session.completed"
  | "session.cancelled"
  | "session.retrying"
  | "delegation.started"
  | "delegation.completed"
  | "run.budget-warning"
  | "run.budget-exceeded";

/** Extended event kinds – richer lifecycle observability beyond MVP. */
export type SupervisorExtendedEventKind =
  | "session.paused"
  | "session.resumed"
  | "session.recovering"
  | "worktree.provisioned"
  | "worktree.released"
  | "lane.state-changed"
  | "approval.requested"
  | "approval.decided"
  | "review.ready"
  | "run.completed";

/** Full union of every supervisor event kind. */
export type SupervisorEventKind = SupervisorMvpEventKind | SupervisorExtendedEventKind;

// ── Event level ─────────────────────────────────────────────────────────────

export type SupervisorEventLevel = "info" | "warn" | "error";

// ── Correlation context ─────────────────────────────────────────────────────

export type SupervisorCorrelationContext = {
  traceId?: string;
  parentRunId: string;
  laneId?: string;
  sessionId?: string;
  worktreeId?: string;
};

// ── Supervisor event ────────────────────────────────────────────────────────

export type SupervisorEvent = {
  kind: SupervisorEventKind;
  correlationId: string;
  context: SupervisorCorrelationContext;
  occurredAt: string;
  level: SupervisorEventLevel;
  payload: Record<string, unknown>;
};

// ── Constants ───────────────────────────────────────────────────────────────

/** The 11 MVP event kinds that every supervisor implementation must emit. */
export const MINIMUM_VIABLE_EVENTS: readonly SupervisorMvpEventKind[] = Object.freeze([
  "session.launched",
  "session.heartbeat",
  "session.stalled",
  "session.failed",
  "session.completed",
  "session.cancelled",
  "session.retrying",
  "delegation.started",
  "delegation.completed",
  "run.budget-warning",
  "run.budget-exceeded"
] as const);

/**
 * Default severity level for each event kind.
 *
 * - Failures and budget-exceeded map to `"error"`.
 * - Stalled sessions and budget warnings map to `"warn"`.
 * - Everything else maps to `"info"`.
 */
export const EVENT_DEFAULT_LEVELS: Record<SupervisorEventKind, SupervisorEventLevel> = Object.freeze({
  // MVP – info
  "session.launched": "info",
  "session.heartbeat": "info",
  "session.completed": "info",
  "session.cancelled": "info",
  "session.retrying": "info",
  "delegation.started": "info",
  "delegation.completed": "info",

  // MVP – warn
  "session.stalled": "warn",
  "run.budget-warning": "warn",

  // MVP – error
  "session.failed": "error",
  "run.budget-exceeded": "error",

  // Extended – info
  "session.paused": "info",
  "session.resumed": "info",
  "session.recovering": "info",
  "worktree.provisioned": "info",
  "worktree.released": "info",
  "lane.state-changed": "info",
  "approval.requested": "info",
  "approval.decided": "info",
  "review.ready": "info",
  "run.completed": "info"
});

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Build a deterministic correlation ID from the given context and a
 * millisecond-precision timestamp.
 *
 * Format: `sv-{parentRunId}:{laneId ?? "root"}:{sessionId ?? "none"}:{timestamp_ms}`
 */
export const buildCorrelationId = (
  context: SupervisorCorrelationContext,
  timestampMs: number = Date.now()
): string => {
  const lane = context.laneId ?? "root";
  const session = context.sessionId ?? "none";

  return `sv-${context.parentRunId}:${lane}:${session}:${timestampMs}`;
};

/**
 * Returns `true` when the given kind is one of the 11 minimum-viable events.
 */
export const isMinimumViableEvent = (kind: SupervisorEventKind): boolean =>
  (MINIMUM_VIABLE_EVENTS as readonly string[]).includes(kind);

/**
 * Create a fully-formed `SupervisorEvent` with auto-generated correlation ID,
 * ISO-8601 timestamp, and the default severity level for the given kind.
 */
export const createSupervisorEvent = (
  kind: SupervisorEventKind,
  context: SupervisorCorrelationContext,
  payload: Record<string, unknown> = {}
): SupervisorEvent => {
  const now = Date.now();

  return Object.freeze({
    kind,
    correlationId: buildCorrelationId(context, now),
    context: Object.freeze({ ...context }),
    occurredAt: new Date(now).toISOString(),
    level: EVENT_DEFAULT_LEVELS[kind],
    payload: Object.freeze({ ...payload })
  });
};
