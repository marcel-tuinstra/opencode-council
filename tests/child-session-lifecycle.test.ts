import { describe, expect, it } from "vitest";
import {
  assertChildSessionTransition,
  canTransitionChildSession,
  CHILD_SESSION_TRANSITIONS,
  classifyChildSessionFailure,
  DEFAULT_CHILD_SESSION_RETRY_POLICY,
  DEFAULT_CHILD_SESSION_TIMEOUT_POLICY,
  isTerminalChildSessionState,
  resolveRetryEligibility
} from "../plugins/orchestration-workflows/child-session-lifecycle";
import type {
  ChildSessionFailureCode,
  ChildSessionRecord,
  ChildSessionRetryPolicy,
  ChildSessionState
} from "../plugins/orchestration-workflows/child-session-lifecycle";

const ALL_STATES: readonly ChildSessionState[] = [
  "pending", "launching", "active", "paused", "stalled",
  "recovering", "cancelling", "cancelled", "completed", "failed"
];

const TERMINAL_STATES: readonly ChildSessionState[] = ["cancelled", "completed", "failed"];

const NON_TERMINAL_STATES: readonly ChildSessionState[] = ALL_STATES.filter(
  (state) => !TERMINAL_STATES.includes(state)
);

const makeRecord = (overrides: Partial<ChildSessionRecord> = {}): ChildSessionRecord => ({
  sessionId: "sess-1",
  parentRunId: "run-1",
  laneId: "lane-1",
  correlationId: "corr-1",
  state: "failed",
  heartbeatIntervalMs: 30_000,
  heartbeatCount: 0,
  retryCount: 0,
  maxRetries: 2,
  updatedAt: new Date().toISOString(),
  ...overrides
});

describe("child-session-lifecycle", () => {
  // ── Transition map ──────────────────────────────────────────────────────

  describe("canTransitionChildSession – valid transitions", () => {
    const validPairs: readonly [ChildSessionState, ChildSessionState][] = [
      ["pending", "launching"],
      ["pending", "cancelled"],
      ["launching", "active"],
      ["launching", "failed"],
      ["launching", "cancelled"],
      ["active", "paused"],
      ["active", "stalled"],
      ["active", "completed"],
      ["active", "failed"],
      ["active", "cancelled"],
      ["active", "cancelling"],
      ["paused", "active"],
      ["paused", "cancelled"],
      ["paused", "failed"],
      ["stalled", "recovering"],
      ["stalled", "failed"],
      ["stalled", "cancelled"],
      ["recovering", "active"],
      ["recovering", "failed"],
      ["recovering", "cancelled"],
      ["cancelling", "cancelled"],
      ["cancelling", "failed"]
    ];

    it.each(validPairs)("%s -> %s is allowed", (from, to) => {
      expect(canTransitionChildSession(from, to)).toBe(true);
    });
  });

  describe("canTransitionChildSession – invalid transitions", () => {
    const invalidPairs: readonly [ChildSessionState, ChildSessionState][] = [
      ["pending", "active"],
      ["pending", "completed"],
      ["launching", "paused"],
      ["launching", "stalled"],
      ["paused", "stalled"],
      ["paused", "completed"],
      ["stalled", "active"],
      ["stalled", "paused"],
      ["recovering", "paused"],
      ["cancelling", "active"],
      ["cancelling", "recovering"],
      ["cancelled", "active"],
      ["completed", "active"],
      ["failed", "active"]
    ];

    it.each(invalidPairs)("%s -> %s is rejected", (from, to) => {
      expect(canTransitionChildSession(from, to)).toBe(false);
    });
  });

  it("assertChildSessionTransition throws for an invalid transition", () => {
    expect(() => assertChildSessionTransition("pending", "completed")).toThrow(
      "Invalid child-session transition: pending -> completed"
    );
  });

  it("assertChildSessionTransition succeeds for a valid transition", () => {
    expect(() => assertChildSessionTransition("pending", "launching")).not.toThrow();
  });

  // ── Terminal states ─────────────────────────────────────────────────────

  it("terminal states have no outbound transitions", () => {
    for (const state of TERMINAL_STATES) {
      expect(CHILD_SESSION_TRANSITIONS[state]).toEqual([]);
      expect(isTerminalChildSessionState(state)).toBe(true);
    }
  });

  it("non-terminal states are not classified as terminal", () => {
    for (const state of NON_TERMINAL_STATES) {
      expect(isTerminalChildSessionState(state)).toBe(false);
    }
  });

  // ── classifyChildSessionFailure ─────────────────────────────────────────

  describe("classifyChildSessionFailure", () => {
    it("returns cancelled-by-parent (not retry-eligible) when cancelledByParent is set", () => {
      const result = classifyChildSessionFailure({ cancelledByParent: true });
      expect(result.code).toBe("cancelled-by-parent");
      expect(result.retryEligible).toBe(false);
    });

    it("returns budget-exceeded (not retry-eligible) when budgetExceeded is set", () => {
      const result = classifyChildSessionFailure({ budgetExceeded: true });
      expect(result.code).toBe("budget-exceeded");
      expect(result.retryEligible).toBe(false);
    });

    it("returns merge-conflict (retry-eligible) when mergeConflict is set", () => {
      const result = classifyChildSessionFailure({ mergeConflict: true });
      expect(result.code).toBe("merge-conflict");
      expect(result.retryEligible).toBe(true);
    });

    it("returns heartbeat-timeout (retry-eligible) when heartbeatMissing is set", () => {
      const result = classifyChildSessionFailure({ heartbeatMissing: true });
      expect(result.code).toBe("heartbeat-timeout");
      expect(result.retryEligible).toBe(true);
    });

    it("returns runtime-crash (retry-eligible) when runtimeError is set", () => {
      const result = classifyChildSessionFailure({ runtimeError: "segfault" });
      expect(result.code).toBe("runtime-crash");
      expect(result.retryEligible).toBe(true);
    });

    it("returns unknown (retry-eligible) when no signal flags are set", () => {
      const result = classifyChildSessionFailure({});
      expect(result.code).toBe("unknown");
      expect(result.retryEligible).toBe(true);
    });

    it("prioritises cancelledByParent over other signals", () => {
      const result = classifyChildSessionFailure({
        cancelledByParent: true,
        heartbeatMissing: true,
        budgetExceeded: true
      });
      expect(result.code).toBe("cancelled-by-parent");
      expect(result.retryEligible).toBe(false);
    });

    it("prioritises budgetExceeded over heartbeat and runtime signals", () => {
      const result = classifyChildSessionFailure({
        budgetExceeded: true,
        heartbeatMissing: true,
        runtimeError: "crash"
      });
      expect(result.code).toBe("budget-exceeded");
      expect(result.retryEligible).toBe(false);
    });

    it("returns tool-outage (retry-eligible) when toolOutage is set", () => {
      const result = classifyChildSessionFailure({ toolOutage: true });
      expect(result.code).toBe("tool-outage");
      expect(result.retryEligible).toBe(true);
    });

    it("returns partial-completion (retry-eligible) when partialCompletion is set", () => {
      const result = classifyChildSessionFailure({ partialCompletion: true });
      expect(result.code).toBe("partial-completion");
      expect(result.retryEligible).toBe(true);
    });

    it("prioritises toolOutage over mergeConflict", () => {
      const result = classifyChildSessionFailure({
        toolOutage: true,
        mergeConflict: true
      });
      expect(result.code).toBe("tool-outage");
      expect(result.retryEligible).toBe(true);
    });

    it("prioritises partialCompletion over mergeConflict but not toolOutage", () => {
      const result = classifyChildSessionFailure({
        partialCompletion: true,
        mergeConflict: true
      });
      expect(result.code).toBe("partial-completion");
      expect(result.retryEligible).toBe(true);
    });
  });

  // ── resolveRetryEligibility ─────────────────────────────────────────────

  describe("resolveRetryEligibility", () => {
    const policy: ChildSessionRetryPolicy = { maxRetries: 3, backoffBaseMs: 1_000, backoffMultiplier: 2 };

    it("is eligible when retryCount < maxRetries and failure is retryable", () => {
      const record = makeRecord({ failureCode: "heartbeat-timeout", retryCount: 0 });
      const result = resolveRetryEligibility(record, policy);

      expect(result.eligible).toBe(true);
      expect(result.nextRetryDelayMs).toBeGreaterThan(0);
    });

    it("is not eligible when retryCount >= maxRetries", () => {
      const record = makeRecord({ failureCode: "heartbeat-timeout", retryCount: 3 });
      const result = resolveRetryEligibility(record, policy);

      expect(result.eligible).toBe(false);
      expect(result.nextRetryDelayMs).toBe(0);
      expect(result.reason).toContain("reached the maximum");
    });

    it("is not eligible for non-retryable failure codes", () => {
      const nonRetryableCodes: ChildSessionFailureCode[] = ["cancelled-by-parent", "budget-exceeded"];

      for (const code of nonRetryableCodes) {
        const record = makeRecord({ failureCode: code, retryCount: 0 });
        const result = resolveRetryEligibility(record, policy);

        expect(result.eligible).toBe(false);
        expect(result.reason).toContain("not retry-eligible");
      }
    });

    it("is not eligible when no failure code is present", () => {
      const record = makeRecord({ failureCode: undefined, retryCount: 0 });
      const result = resolveRetryEligibility(record, policy);

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain("No failure code");
    });

    it("calculates correct backoff delay: baseMs * multiplier^retryCount", () => {
      const record0 = makeRecord({ failureCode: "runtime-crash", retryCount: 0 });
      const record1 = makeRecord({ failureCode: "runtime-crash", retryCount: 1 });
      const record2 = makeRecord({ failureCode: "runtime-crash", retryCount: 2 });

      expect(resolveRetryEligibility(record0, policy).nextRetryDelayMs).toBe(1_000);  // 1000 * 2^0
      expect(resolveRetryEligibility(record1, policy).nextRetryDelayMs).toBe(2_000);  // 1000 * 2^1
      expect(resolveRetryEligibility(record2, policy).nextRetryDelayMs).toBe(4_000);  // 1000 * 2^2
    });
  });

  // ── Default policy values ─────────────────────────────────────────────

  it("DEFAULT_CHILD_SESSION_RETRY_POLICY has the correct values", () => {
    expect(DEFAULT_CHILD_SESSION_RETRY_POLICY).toEqual({
      maxRetries: 2,
      backoffBaseMs: 5_000,
      backoffMultiplier: 2
    });
  });

  it("DEFAULT_CHILD_SESSION_TIMEOUT_POLICY has the correct values", () => {
    expect(DEFAULT_CHILD_SESSION_TIMEOUT_POLICY).toEqual({
      heartbeatTimeoutMs: 300_000,
      taskTimeoutMs: 3_600_000,
      gracefulCancelTimeoutMs: 30_000
    });
  });
});
