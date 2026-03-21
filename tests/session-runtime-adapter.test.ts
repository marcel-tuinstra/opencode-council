import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore } from "../plugins/orchestration-workflows/durable-state-store";
import {
  createSupervisorSessionLifecycle,
  type AttachSupervisorRuntimeSessionInput,
  type LaunchSupervisorRuntimeSessionInput,
  type SupervisorSessionRuntimeAdapter
} from "../plugins/orchestration-workflows/session-runtime-adapter";
import type { SupervisorEvent } from "../plugins/orchestration-workflows/supervisor-event-catalog";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "session-runtime-adapter-"));
  tempDirs.push(rootDir);
  return rootDir;
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

    launchSession: async (input) => {
      launched.push({ ...input });

      return {
        runtimeSessionId: `runtime-${launched.length}`,
        owner: input.owner,
        status: "active",
        attachedAt: input.occurredAt,
        lastHeartbeatAt: input.occurredAt
      };
    },

    attachSession: async (input) => {
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

const seedRunWithLaneWorktree = async (rootDir: string) => {
  const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });

  await store.commitMutation("run-session", {
    mutationId: "run-session-create",
    actor: "supervisor",
    summary: "Create a run with a provisioned lane worktree.",
    occurredAt: "2026-03-13T14:00:00.000Z",
    createRun: {
      runId: "run-session",
      status: "active",
      objective: "Track one OpenCode session per lane worktree.",
      createdAt: "2026-03-13T14:00:00.000Z"
    },
    laneUpserts: [
      {
        laneId: "lane-1",
        state: "active",
        branch: "marceltuinstra/sc-401-session-runtime",
        worktreeId: "run-session:lane-1",
        updatedAt: "2026-03-13T14:00:00.000Z"
      }
    ],
    worktreeUpserts: [
      {
        worktreeId: "run-session:lane-1",
        laneId: "lane-1",
        path: "/tmp/worktrees/run-session/lane-1",
        branch: "marceltuinstra/sc-401-session-runtime",
        status: "active",
        updatedAt: "2026-03-13T14:00:00.000Z"
      }
    ]
  });

  return store;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("session-runtime-adapter", () => {
  it("launches one runtime session for a lane worktree and persists owner metadata", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    // Act
    const result = await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    const state = await store.getRunState("run-session");

    // Assert
    expect(result.action).toBe("launched");
    expect(result.session).toEqual({
      sessionId: "run-session:lane-1:session-01",
      laneId: "lane-1",
      worktreeId: "run-session:lane-1",
      status: "active",
      runtime: "opencode",
      owner: "developer-a",
      startedAt: "2026-03-13T14:01:00.000Z",
      attachedAt: "2026-03-13T14:01:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:01:00.000Z",
      replacementOfSessionId: undefined,
      failureReason: undefined,
      replacedBySessionId: undefined,
      updatedAt: "2026-03-13T14:01:00.000Z"
    });
    expect(state?.lanes[0]?.sessionId).toBe("run-session:lane-1:session-01");
    expect(runtime.launched).toHaveLength(1);
  });

  it("resumes a stalled session by reattaching the runtime session to the same worktree", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    await lifecycle.detectStalledSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-stalled",
      observedAt: "2026-03-13T14:09:00.000Z",
      stallTimeoutMs: 60_000
    });

    // Act
    const result = await lifecycle.resumeSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-b",
      actor: "supervisor",
      mutationId: "lane-1-resume-session",
      occurredAt: "2026-03-13T14:10:00.000Z"
    });

    // Assert
    expect(result.action).toBe("resumed");
    expect(result.session.sessionId).toBe("run-session:lane-1:session-01");
    expect(result.session.status).toBe("active");
    expect(result.session.owner).toBe("developer-b");
    expect(result.session.attachedAt).toBe("2026-03-13T14:10:00.000Z");
    expect(result.session.lastHeartbeatAt).toBe("2026-03-13T14:10:00.000Z");
    expect(runtime.attached).toEqual([
      {
        runId: "run-session",
        laneId: "lane-1",
        worktreeId: "run-session:lane-1",
        worktreePath: "/tmp/worktrees/run-session/lane-1",
        branch: "marceltuinstra/sc-401-session-runtime",
        sessionId: "run-session:lane-1:session-01",
        owner: "developer-b",
        occurredAt: "2026-03-13T14:10:00.000Z"
      }
    ]);
  });

  it("marks an active lane session as paused while waiting for approval", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Act
    const result = await lifecycle.pauseSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-pause-session",
      occurredAt: "2026-03-13T14:02:00.000Z"
    });

    // Assert
    expect(result.action).toBe("paused");
    expect(result.session.status).toBe("paused");
    expect(result.session.updatedAt).toBe("2026-03-13T14:02:00.000Z");
  });

  it("replaces a failed lane session and keeps replacement lineage in durable state", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-failed",
      occurredAt: "2026-03-13T14:03:00.000Z",
      status: "failed",
      failureReason: "Tool process exited unexpectedly."
    });

    // Act
    const result = await lifecycle.replaceSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-c",
      actor: "supervisor",
      mutationId: "lane-1-replace-session",
      occurredAt: "2026-03-13T14:04:00.000Z"
    });
    const state = await store.getRunState("run-session");

    // Assert
    expect(result.action).toBe("replaced");
    expect(result.previousSession).toEqual({
      sessionId: "run-session:lane-1:session-01",
      laneId: "lane-1",
      worktreeId: "run-session:lane-1",
      status: "replaced",
      runtime: "opencode",
      owner: "developer-a",
      startedAt: "2026-03-13T14:01:00.000Z",
      attachedAt: "2026-03-13T14:01:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:01:00.000Z",
      replacementOfSessionId: undefined,
      failureReason: "Tool process exited unexpectedly.",
      replacedBySessionId: "run-session:lane-1:session-02",
      updatedAt: "2026-03-13T14:04:00.000Z"
    });
    expect(result.session.sessionId).toBe("run-session:lane-1:session-02");
    expect(result.session.replacementOfSessionId).toBe("run-session:lane-1:session-01");
    expect(state?.lanes[0]?.sessionId).toBe("run-session:lane-1:session-02");
    expect(state?.sessions.map((session) => session.sessionId)).toEqual([
      "run-session:lane-1:session-01",
      "run-session:lane-1:session-02"
    ]);
  });

  it("marks the current session as stalled when heartbeat age exceeds the timeout", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Act
    const result = await lifecycle.detectStalledSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-stalled",
      observedAt: "2026-03-13T14:08:00.000Z",
      stallTimeoutMs: 60_000,
      failureReason: "Heartbeat expired while the lane was waiting for output."
    });

    // Assert
    expect(result.action).toBe("stalled");
    expect(result.session.status).toBe("stalled");
    expect(result.session.failureReason).toBe("Heartbeat expired while the lane was waiting for output.");
  });

  it("creates both a SupervisorSessionRecord and a ChildSessionRecord on launch", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    // Act
    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-dual",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    const state = await store.getRunState("run-session");

    // Assert – supervisor session
    expect(state?.sessions).toHaveLength(1);
    expect(state?.sessions[0]?.sessionId).toBe("run-session:lane-1:session-01");

    // Assert – child session
    expect(state?.childSessions).toHaveLength(1);
    expect(state?.childSessions[0]).toMatchObject({
      sessionId: "run-session:lane-1:session-01",
      parentRunId: "run-session",
      laneId: "lane-1",
      worktreeId: "run-session:lane-1",
      state: "launching",
      owner: "developer-a",
      heartbeatCount: 0
    });
  });

  it("transitions child session from launching to active on first heartbeat", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-hb",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Act
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-heartbeat-1",
      occurredAt: "2026-03-13T14:02:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:02:00.000Z"
    });
    const state = await store.getRunState("run-session");

    // Assert
    expect(state?.childSessions[0]?.state).toBe("active");
    expect(state?.childSessions[0]?.previousState).toBe("launching");
    expect(state?.childSessions[0]?.heartbeatCount).toBe(1);
    expect(state?.childSessions[0]?.lastHeartbeatAt).toBe("2026-03-13T14:02:00.000Z");
  });

  it("cancels a child session through cancelling → cancelled transition", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-cancel",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Promote to active via heartbeat first
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-heartbeat-pre-cancel",
      occurredAt: "2026-03-13T14:02:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:02:00.000Z"
    });

    // Act
    const result = await lifecycle.cancelSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-cancel",
      occurredAt: "2026-03-13T14:03:00.000Z",
      cancelledReason: "User requested cancellation."
    });
    const state = await store.getRunState("run-session");

    // Assert
    expect(result.action).toBe("cancelled");
    expect(result.session.status).toBe("failed");
    expect(result.session.failureReason).toBe("User requested cancellation.");

    expect(state?.childSessions[0]?.state).toBe("cancelled");
    expect(state?.childSessions[0]?.cancelledReason).toBe("User requested cancellation.");
  });

  it("rejects invalid child session state transitions", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-invalid",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Promote to active, then cancel
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-hb-invalid",
      occurredAt: "2026-03-13T14:02:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:02:00.000Z"
    });
    await lifecycle.cancelSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-cancel-invalid",
      occurredAt: "2026-03-13T14:03:00.000Z",
      cancelledReason: "Done."
    });

    // Assert – child session is now cancelled (terminal), cannot be resumed
    const state = await store.getRunState("run-session");
    expect(state?.childSessions[0]?.state).toBe("cancelled");

    // The assertChildSessionTransition function prevents invalid jumps
    const { assertChildSessionTransition } = await import("../plugins/orchestration-workflows/child-session-lifecycle");
    expect(() => assertChildSessionTransition("cancelled", "active")).toThrow(
      "Invalid child-session transition: cancelled -> active"
    );
  });

  it("emits a session.launched event on successful launchSession", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const emitted: SupervisorEvent[] = [];
    const lifecycle = createSupervisorSessionLifecycle({
      store,
      runtime,
      emitEvent: (event) => emitted.push(event)
    });

    // Act
    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-event",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Assert
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.kind).toBe("session.launched");
    expect(emitted[0]?.context.parentRunId).toBe("run-session");
    expect(emitted[0]?.context.laneId).toBe("lane-1");
    expect(emitted[0]?.context.sessionId).toBe("run-session:lane-1:session-01");
    expect(emitted[0]?.level).toBe("info");
    expect(emitted[0]?.correlationId).toMatch(/^sv-run-session:lane-1:run-session:lane-1:session-01:/);
  });

  it("emits a session.stalled event when detectStalledSession detects stall", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const emitted: SupervisorEvent[] = [];
    const lifecycle = createSupervisorSessionLifecycle({
      store,
      runtime,
      emitEvent: (event) => emitted.push(event)
    });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-stall",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    emitted.length = 0; // Reset to capture only the stall event

    // Act
    await lifecycle.detectStalledSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-stalled-event",
      observedAt: "2026-03-13T14:08:00.000Z",
      stallTimeoutMs: 60_000
    });

    // Assert
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.kind).toBe("session.stalled");
    expect(emitted[0]?.level).toBe("warn");
    expect(emitted[0]?.context.parentRunId).toBe("run-session");
    expect(emitted[0]?.context.laneId).toBe("lane-1");
    expect(emitted[0]?.context.sessionId).toBe("run-session:lane-1:session-01");
    expect(emitted[0]?.payload).toHaveProperty("lastHeartbeatAt");
    expect(emitted[0]?.payload).toHaveProperty("elapsed");
  });

  it("emits a session.cancelled event on successful cancelSession", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const emitted: SupervisorEvent[] = [];
    const lifecycle = createSupervisorSessionLifecycle({
      store,
      runtime,
      emitEvent: (event) => emitted.push(event)
    });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-cancel-event",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-hb-cancel-event",
      occurredAt: "2026-03-13T14:02:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:02:00.000Z"
    });
    emitted.length = 0;

    // Act
    await lifecycle.cancelSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-cancel-event",
      occurredAt: "2026-03-13T14:03:00.000Z",
      cancelledReason: "User requested stop."
    });

    // Assert
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.kind).toBe("session.cancelled");
    expect(emitted[0]?.level).toBe("info");
    expect(emitted[0]?.context.parentRunId).toBe("run-session");
    expect(emitted[0]?.context.laneId).toBe("lane-1");
    expect(emitted[0]?.context.sessionId).toBe("run-session:lane-1:session-01");
    expect(emitted[0]?.payload).toEqual({ reason: "User requested stop." });
  });

  it("does not emit events when emitEvent is not provided (backward compat)", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    // Act – should not throw even without emitEvent
    const result = await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-no-emit",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Assert
    expect(result.action).toBe("launched");
    expect(result.session.sessionId).toBe("run-session:lane-1:session-01");
  });

  it("populates correct correlation fields on emitted events", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const emitted: SupervisorEvent[] = [];
    const lifecycle = createSupervisorSessionLifecycle({
      store,
      runtime,
      emitEvent: (event) => emitted.push(event)
    });

    // Act – launch, pause, resume, replace, cancel – collect all events
    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-corr",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    await lifecycle.pauseSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-pause-corr",
      occurredAt: "2026-03-13T14:02:00.000Z"
    });
    await lifecycle.resumeSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-b",
      actor: "supervisor",
      mutationId: "lane-1-resume-corr",
      occurredAt: "2026-03-13T14:03:00.000Z"
    });
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-hb-corr",
      occurredAt: "2026-03-13T14:04:00.000Z",
      status: "failed",
      failureReason: "Test failure."
    });
    await lifecycle.replaceSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-c",
      actor: "supervisor",
      mutationId: "lane-1-replace-corr",
      occurredAt: "2026-03-13T14:05:00.000Z"
    });

    // Assert – all emitted events share the same parentRunId and laneId
    expect(emitted).toHaveLength(5);
    const kinds = emitted.map((e) => e.kind);
    expect(kinds).toEqual([
      "session.launched",
      "session.paused",
      "session.resumed",
      "session.heartbeat",
      "session.retrying"
    ]);
    for (const event of emitted) {
      expect(event.context.parentRunId).toBe("run-session");
      expect(event.context.laneId).toBe("lane-1");
      expect(event.correlationId).toMatch(/^sv-/);
      expect(event.occurredAt).toBeTruthy();
    }
    // The retrying event should carry the replaced session id
    const retryEvent = emitted.find((e) => e.kind === "session.retrying");
    expect(retryEvent?.payload).toHaveProperty("replacedSessionId", "run-session:lane-1:session-01");
    expect(retryEvent?.context.sessionId).toBe("run-session:lane-1:session-02");
  });

  it("carries over retryCount incremented by one when replacing a child session", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-retry",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Fail the session so it can be replaced
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-fail-1",
      occurredAt: "2026-03-13T14:02:00.000Z",
      status: "failed",
      failureReason: "Crash #1."
    });

    // First replacement
    await lifecycle.replaceSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-replace-1",
      occurredAt: "2026-03-13T14:03:00.000Z"
    });

    const stateAfterFirst = await store.getRunState("run-session");
    const firstReplacement = stateAfterFirst?.childSessions.find(
      (cs) => cs.sessionId === "run-session:lane-1:session-02"
    );
    expect(firstReplacement?.retryCount).toBe(1);
    expect(firstReplacement?.maxRetries).toBe(2);

    // Fail the replacement too
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-fail-2",
      occurredAt: "2026-03-13T14:04:00.000Z",
      status: "failed",
      failureReason: "Crash #2."
    });

    // Second replacement
    await lifecycle.replaceSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-replace-2",
      occurredAt: "2026-03-13T14:05:00.000Z"
    });

    const stateAfterSecond = await store.getRunState("run-session");
    const secondReplacement = stateAfterSecond?.childSessions.find(
      (cs) => cs.sessionId === "run-session:lane-1:session-03"
    );

    // Assert – retryCount accumulates across replacements
    expect(secondReplacement?.retryCount).toBe(2);
    expect(secondReplacement?.maxRetries).toBe(2);
  });

  it("returns unchanged when cancelSession is called on a completed session", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-cancel-guard",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Mark session as completed via heartbeat
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-complete",
      occurredAt: "2026-03-13T14:02:00.000Z",
      status: "completed"
    });

    // Act – attempt to cancel an already-completed session
    const result = await lifecycle.cancelSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-cancel-completed",
      occurredAt: "2026-03-13T14:03:00.000Z",
      cancelledReason: "Too late."
    });

    // Assert
    expect(result.action).toBe("unchanged");
    expect(result.session.status).toBe("completed");
  });

  it("transitions child session to completed when heartbeat reports completed status", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-terminal-hb",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Promote to active first
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-hb-activate",
      occurredAt: "2026-03-13T14:02:00.000Z",
      lastHeartbeatAt: "2026-03-13T14:02:00.000Z"
    });

    // Act – heartbeat with completed status
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-hb-completed",
      occurredAt: "2026-03-13T14:03:00.000Z",
      status: "completed"
    });
    const state = await store.getRunState("run-session");

    // Assert
    expect(state?.childSessions[0]?.state).toBe("completed");
    expect(state?.childSessions[0]?.previousState).toBe("active");
    expect(state?.childSessions[0]?.completedAt).toBe("2026-03-13T14:03:00.000Z");
  });

  it("transitions child session to failed when heartbeat reports failed status", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = await seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    await lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-fail-hb",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Act – heartbeat with failed status directly from launching state
    await lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-hb-failed",
      occurredAt: "2026-03-13T14:02:00.000Z",
      status: "failed",
      failureReason: "Runtime crashed on startup."
    });
    const state = await store.getRunState("run-session");

    // Assert – launching → failed is a valid transition
    expect(state?.childSessions[0]?.state).toBe("failed");
    expect(state?.childSessions[0]?.previousState).toBe("launching");
  });
});
