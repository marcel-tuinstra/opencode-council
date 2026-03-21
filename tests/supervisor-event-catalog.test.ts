import { describe, expect, it } from "vitest";
import {
  buildCorrelationId,
  createSupervisorEvent,
  EVENT_DEFAULT_LEVELS,
  isMinimumViableEvent,
  MINIMUM_VIABLE_EVENTS,
  type SupervisorCorrelationContext,
  type SupervisorEvent,
  type SupervisorEventKind,
  type SupervisorMvpEventKind,
  type SupervisorExtendedEventKind
} from "../plugins/orchestration-workflows/supervisor-event-catalog";

// ── Fixtures ────────────────────────────────────────────────────────────────

const fullContext: SupervisorCorrelationContext = {
  traceId: "trace-abc",
  parentRunId: "run-42",
  laneId: "lane-7",
  sessionId: "sess-9",
  worktreeId: "wt-3"
};

const minimalContext: SupervisorCorrelationContext = {
  parentRunId: "run-1"
};

const MVP_KINDS: readonly SupervisorMvpEventKind[] = [
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
];

const EXTENDED_KINDS: readonly SupervisorExtendedEventKind[] = [
  "session.paused",
  "session.resumed",
  "session.recovering",
  "worktree.provisioned",
  "worktree.released",
  "lane.state-changed",
  "approval.requested",
  "approval.decided",
  "review.ready",
  "run.completed"
];

// ── Tests ───────────────────────────────────────────────────────────────────

describe("supervisor-event-catalog", () => {
  // ── MINIMUM_VIABLE_EVENTS ───────────────────────────────────────────────

  it("MINIMUM_VIABLE_EVENTS contains exactly 11 entries", () => {
    expect(MINIMUM_VIABLE_EVENTS).toHaveLength(11);
  });

  it("MINIMUM_VIABLE_EVENTS lists all expected MVP kinds", () => {
    expect([...MINIMUM_VIABLE_EVENTS].sort()).toEqual([...MVP_KINDS].sort());
  });

  // ── isMinimumViableEvent ────────────────────────────────────────────────

  it("returns true for all 11 MVP event kinds", () => {
    for (const kind of MVP_KINDS) {
      expect(isMinimumViableEvent(kind), `${kind} should be MVP`).toBe(true);
    }
  });

  it("returns false for all 10 extended event kinds", () => {
    for (const kind of EXTENDED_KINDS) {
      expect(isMinimumViableEvent(kind), `${kind} should NOT be MVP`).toBe(false);
    }
  });

  // ── EVENT_DEFAULT_LEVELS ────────────────────────────────────────────────

  it("maps session.failed to error", () => {
    expect(EVENT_DEFAULT_LEVELS["session.failed"]).toBe("error");
  });

  it("maps run.budget-exceeded to error", () => {
    expect(EVENT_DEFAULT_LEVELS["run.budget-exceeded"]).toBe("error");
  });

  it("maps session.stalled to warn", () => {
    expect(EVENT_DEFAULT_LEVELS["session.stalled"]).toBe("warn");
  });

  it("maps run.budget-warning to warn", () => {
    expect(EVENT_DEFAULT_LEVELS["run.budget-warning"]).toBe("warn");
  });

  it("maps session.launched to info", () => {
    expect(EVENT_DEFAULT_LEVELS["session.launched"]).toBe("info");
  });

  it("has a level entry for every known event kind", () => {
    const allKinds: readonly SupervisorEventKind[] = [...MVP_KINDS, ...EXTENDED_KINDS];

    for (const kind of allKinds) {
      expect(EVENT_DEFAULT_LEVELS[kind], `missing level for ${kind}`).toBeDefined();
    }
  });

  // ── buildCorrelationId ────────────────────────────────────────────────

  it("produces the canonical format with all context fields", () => {
    const id = buildCorrelationId(fullContext, 1710000000000);

    expect(id).toBe("sv-run-42:lane-7:sess-9:1710000000000");
  });

  it("uses 'root' for missing laneId and 'none' for missing sessionId", () => {
    const id = buildCorrelationId(minimalContext, 1710000000000);

    expect(id).toBe("sv-run-1:root:none:1710000000000");
  });

  it("is deterministic given the same inputs and timestamp", () => {
    const a = buildCorrelationId(fullContext, 9999);
    const b = buildCorrelationId(fullContext, 9999);

    expect(a).toBe(b);
  });

  it("produces different IDs for different timestamps", () => {
    const a = buildCorrelationId(fullContext, 1000);
    const b = buildCorrelationId(fullContext, 2000);

    expect(a).not.toBe(b);
  });

  // ── createSupervisorEvent ─────────────────────────────────────────────

  it("creates a well-formed event for each MVP kind", () => {
    for (const kind of MVP_KINDS) {
      const event = createSupervisorEvent(kind, fullContext, { detail: kind });

      expect(event.kind).toBe(kind);
      expect(event.level).toBe(EVENT_DEFAULT_LEVELS[kind]);
      expect(event.context.parentRunId).toBe("run-42");
      expect(event.payload).toEqual({ detail: kind });
      expect(event.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(event.correlationId).toMatch(/^sv-run-42:lane-7:sess-9:\d+$/);
    }
  });

  it("defaults payload to an empty object when omitted", () => {
    const event = createSupervisorEvent("session.launched", fullContext);

    expect(event.payload).toEqual({});
  });

  it("auto-sets occurredAt to a valid ISO-8601 timestamp", () => {
    const before = Date.now();
    const event = createSupervisorEvent("session.launched", minimalContext);
    const after = Date.now();
    const eventMs = new Date(event.occurredAt).getTime();

    expect(eventMs).toBeGreaterThanOrEqual(before);
    expect(eventMs).toBeLessThanOrEqual(after);
  });

  it("correlationId timestamp is consistent with occurredAt", () => {
    const event = createSupervisorEvent("delegation.started", fullContext);
    const idTimestamp = Number(event.correlationId.split(":").pop());
    const occurredAtMs = new Date(event.occurredAt).getTime();

    expect(idTimestamp).toBe(occurredAtMs);
  });

  it("creates events for extended kinds with correct levels", () => {
    for (const kind of EXTENDED_KINDS) {
      const event = createSupervisorEvent(kind, minimalContext);

      expect(event.kind).toBe(kind);
      expect(event.level).toBe(EVENT_DEFAULT_LEVELS[kind]);
      expect(event.correlationId).toMatch(/^sv-run-1:root:none:\d+$/);
    }
  });

  it("returns a frozen event object", () => {
    const event = createSupervisorEvent("session.launched", fullContext);

    expect(Object.isFrozen(event)).toBe(true);
  });

  it("uses caller-provided occurredAt instead of wall-clock time", () => {
    const fixedTimestamp = "2025-06-15T12:00:00.000Z";
    const event = createSupervisorEvent("session.launched", fullContext, {}, fixedTimestamp);

    expect(event.occurredAt).toBe(fixedTimestamp);
    // The correlation ID must embed the same timestamp
    const idTimestamp = Number(event.correlationId.split(":").pop());
    expect(idTimestamp).toBe(new Date(fixedTimestamp).getTime());
  });

  it("throws when caller-provided occurredAt is not a valid ISO-8601 string", () => {
    expect(() =>
      createSupervisorEvent("session.launched", fullContext, {}, "not-a-date")
    ).toThrow('Invalid occurredAt timestamp');
  });
});
