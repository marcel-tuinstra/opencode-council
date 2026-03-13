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

const seedRunWithLaneWorktree = (rootDir: string) => {
  const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });

  store.commitMutation("run-session", {
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
  it("launches one runtime session for a lane worktree and persists owner metadata", () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    // Act
    const result = lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    const state = store.getRunState("run-session");

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

  it("resumes a stalled session by reattaching the runtime session to the same worktree", () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    lifecycle.detectStalledSession({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-stalled",
      observedAt: "2026-03-13T14:09:00.000Z",
      stallTimeoutMs: 60_000
    });

    // Act
    const result = lifecycle.resumeSession({
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

  it("replaces a failed lane session and keeps replacement lineage in durable state", () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });
    lifecycle.recordHeartbeat({
      runId: "run-session",
      laneId: "lane-1",
      actor: "supervisor",
      mutationId: "lane-1-failed",
      occurredAt: "2026-03-13T14:03:00.000Z",
      status: "failed",
      failureReason: "Tool process exited unexpectedly."
    });

    // Act
    const result = lifecycle.replaceSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-c",
      actor: "supervisor",
      mutationId: "lane-1-replace-session",
      occurredAt: "2026-03-13T14:04:00.000Z"
    });
    const state = store.getRunState("run-session");

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

  it("marks the current session as stalled when heartbeat age exceeds the timeout", () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = seedRunWithLaneWorktree(rootDir);
    const runtime = createFakeRuntime();
    const lifecycle = createSupervisorSessionLifecycle({ store, runtime });

    lifecycle.launchSession({
      runId: "run-session",
      laneId: "lane-1",
      owner: "developer-a",
      actor: "supervisor",
      mutationId: "lane-1-launch-session",
      occurredAt: "2026-03-13T14:01:00.000Z"
    });

    // Act
    const result = lifecycle.detectStalledSession({
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
});
