import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore, SUPERVISOR_STATE_STORE_SCHEMA_VERSION } from "../plugins/orchestration-workflows/durable-state-store";
import type { ChildSessionRecord } from "../plugins/orchestration-workflows/child-session-lifecycle";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "supervisor-state-store-"));
  tempDirs.push(rootDir);
  return rootDir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("durable-state-store", () => {
  it("persists and reloads supervisor run control-plane state from disk", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const writer = createFileBackedSupervisorStateStore({ rootDir });

    await writer.commitMutation("run-001", {
      mutationId: "mutation-001",
      actor: "supervisor",
      summary: "Start the run and persist initial execution state.",
      occurredAt: "2026-03-13T10:00:00.000Z",
      createRun: {
        runId: "run-001",
        status: "active",
        objective: "Persist lane, worktree, session, approval, and artifact state.",
        createdAt: "2026-03-13T10:00:00.000Z"
      },
      laneUpserts: [
        {
          laneId: "lane-1",
          state: "active",
          branch: "marceltuinstra/sc-397/supervisor-run-control-plane",
          worktreeId: "worktree-1",
          sessionId: "session-1",
          updatedAt: "2026-03-13T10:00:00.000Z"
        }
      ],
      worktreeUpserts: [
        {
          worktreeId: "worktree-1",
          laneId: "lane-1",
          path: "/tmp/worktrees/run-001/lane-1",
          branch: "marceltuinstra/sc-397/supervisor-run-control-plane",
          status: "active",
          updatedAt: "2026-03-13T10:00:00.000Z"
        }
      ],
      sessionUpserts: [
        {
          sessionId: "session-1",
          laneId: "lane-1",
          worktreeId: "worktree-1",
          status: "active",
          lastHeartbeatAt: "2026-03-13T10:00:05.000Z",
          updatedAt: "2026-03-13T10:00:05.000Z"
        }
      ],
      approvalUpserts: [
        {
          approvalId: "approval-1",
          laneId: "lane-1",
          status: "pending",
          boundary: "merge",
          requestedAction: "merge lane branch",
          summary: "Awaiting human review before merge.",
          rationale: "Merge is a governance boundary in alpha.",
          requestedBy: "supervisor",
          requestedAt: "2026-03-13T10:01:00.000Z",
          context: {
            changedPaths: ["plugins/orchestration-workflows/supervisor-scheduler.ts"],
            targetRef: "epic/supervisor-alpha"
          },
          updatedAt: "2026-03-13T10:01:00.000Z"
        }
      ],
      artifactUpserts: [
        {
          artifactId: "artifact-1",
          laneId: "lane-1",
          kind: "review-packet",
          status: "ready",
          uri: "docs/review-packets/run-001.md",
          updatedAt: "2026-03-13T10:02:00.000Z"
        }
      ],
      sideEffects: ["created-worktree", "captured-review-packet"]
    });

    const reader = createFileBackedSupervisorStateStore({ rootDir });

    // Act
    const state = await reader.getRunState("run-001");

    // Assert
    expect(state).not.toBeNull();
    expect(state?.run).toEqual({
      runId: "run-001",
      status: "active",
      objective: "Persist lane, worktree, session, approval, and artifact state.",
      sourceOfTruth: "control-plane-state",
      createdAt: "2026-03-13T10:00:00.000Z",
      updatedAt: "2026-03-13T10:00:00.000Z"
    });
    expect(state?.lanes).toEqual([
      {
        laneId: "lane-1",
        state: "active",
        branch: "marceltuinstra/sc-397/supervisor-run-control-plane",
        worktreeId: "worktree-1",
        sessionId: "session-1",
        updatedAt: "2026-03-13T10:00:00.000Z"
      }
    ]);
    expect(state?.worktrees[0]?.path).toBe("/tmp/worktrees/run-001/lane-1");
    expect(state?.sessions[0]?.lastHeartbeatAt).toBe("2026-03-13T10:00:05.000Z");
    expect(state?.approvals[0]?.status).toBe("pending");
    expect(state?.approvals[0]?.boundary).toBe("merge");
    expect(state?.approvals[0]?.requestedBy).toBe("supervisor");
    expect(state?.artifacts[0]?.uri).toBe("docs/review-packets/run-001.md");
    expect(state?.auditLog).toEqual([
      {
        sequence: 1,
        mutationId: "mutation-001",
        actor: "supervisor",
        summary: "Start the run and persist initial execution state.",
        occurredAt: "2026-03-13T10:00:00.000Z",
        sideEffects: ["created-worktree", "captured-review-packet"],
        entityRefs: [
          { kind: "run", id: "run-001", state: "active" },
          { kind: "lane", id: "lane-1", state: "active" },
          { kind: "worktree", id: "worktree-1", state: "active" },
          { kind: "session", id: "session-1", state: "active" },
          { kind: "approval", id: "approval-1", state: "pending" },
          { kind: "artifact", id: "artifact-1", state: "ready" }
        ]
      }
    ]);
  });

  it("deduplicates retried mutations by mutation id", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = createFileBackedSupervisorStateStore({ rootDir });
    const mutation = {
      mutationId: "mutation-retry-1",
      actor: "supervisor",
      summary: "Persist lane resume checkpoint.",
      occurredAt: "2026-03-13T11:00:00.000Z",
      createRun: {
        runId: "run-002",
        status: "active",
        objective: "Checkpoint resumable supervisor state.",
        createdAt: "2026-03-13T11:00:00.000Z"
      },
      laneUpserts: [
        {
          laneId: "lane-retry",
          state: "waiting",
          branch: "epic/supervisor-alpha",
          updatedAt: "2026-03-13T11:00:00.000Z"
        }
      ],
      sideEffects: ["pause-for-review"]
    } as const;

    await store.commitMutation("run-002", mutation);

    // Act
    const secondState = await store.commitMutation("run-002", mutation);

    // Assert
    expect(secondState.appliedMutations).toEqual(["mutation-retry-1"]);
    expect(secondState.auditLog).toHaveLength(1);
    expect(secondState.lanes).toEqual([
      {
        laneId: "lane-retry",
        state: "waiting",
        branch: "epic/supervisor-alpha",
        updatedAt: "2026-03-13T11:00:00.000Z"
      }
    ]);
  });

  it("writes an auditable event file for each committed mutation", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = createFileBackedSupervisorStateStore({ rootDir });

    await store.commitMutation("run-003", {
      mutationId: "mutation-003",
      actor: "supervisor",
      summary: "Persist review-ready promotion and PR artifact.",
      occurredAt: "2026-03-13T12:00:00.000Z",
      createRun: {
        runId: "run-003",
        status: "review_ready",
        objective: "Promote the lane into review with durable evidence.",
        createdAt: "2026-03-13T12:00:00.000Z"
      },
      laneUpserts: [
        {
          laneId: "lane-review",
          state: "review_ready",
          branch: "marceltuinstra/sc-397/supervisor-run-control-plane",
          updatedAt: "2026-03-13T12:00:00.000Z"
        }
      ],
      artifactUpserts: [
        {
          artifactId: "artifact-pr-1",
          laneId: "lane-review",
          kind: "pull-request",
          status: "ready",
          uri: "https://github.com/example/repo/pull/1",
          updatedAt: "2026-03-13T12:00:10.000Z"
        }
      ],
      sideEffects: ["opened-pr"]
    });

    const location = store.getRunStorageLocation("run-003");

    // Act
    const eventFiles = readdirSync(location.eventsDir);
    const auditEvent = JSON.parse(readFileSync(path.join(location.eventsDir, eventFiles[0]!), "utf8")) as {
      mutationId: string;
      sideEffects: string[];
      entityRefs: Array<{ kind: string; id: string; state?: string }>;
    };

    // Assert
    expect(eventFiles).toEqual(["0001-mutation-003.json"]);
    expect(auditEvent.mutationId).toBe("mutation-003");
    expect(auditEvent.sideEffects).toEqual(["opened-pr"]);
    expect(auditEvent.entityRefs).toEqual([
      { kind: "run", id: "run-003", state: "review_ready" },
      { kind: "lane", id: "lane-review", state: "review_ready" },
      { kind: "artifact", id: "artifact-pr-1", state: "ready" }
    ]);
  });

  it("migrates v1 state by adding childSessions when reading from disk", async () => {
    // Arrange – write a v1 state file directly (no childSessions field)
    const rootDir = createTempRoot();
    const runDir = path.join(rootDir, "runs", "run-v1-migrate");
    mkdirSync(path.join(runDir, "events"), { recursive: true });
    const v1State = {
      schemaVersion: 1,
      run: {
        runId: "run-v1-migrate",
        status: "active",
        objective: "Test v1 -> v2 migration.",
        sourceOfTruth: "control-plane-state",
        createdAt: "2026-03-20T10:00:00.000Z",
        updatedAt: "2026-03-20T10:00:00.000Z"
      },
      lanes: [],
      worktrees: [],
      sessions: [],
      approvals: [],
      artifacts: [],
      appliedMutations: [],
      auditLog: []
    };
    writeFileSync(path.join(runDir, "state.json"), JSON.stringify(v1State, null, 2), "utf8");

    const store = createFileBackedSupervisorStateStore({ rootDir });

    // Act
    const state = await store.getRunState("run-v1-migrate");

    // Assert
    expect(state).not.toBeNull();
    expect(state?.schemaVersion).toBe(SUPERVISOR_STATE_STORE_SCHEMA_VERSION);
    expect(state?.childSessions).toEqual([]);
  });

  it("inserts and updates child sessions via childSessionUpserts", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = createFileBackedSupervisorStateStore({ rootDir });

    const childSession: ChildSessionRecord = {
      sessionId: "child-sess-1",
      parentRunId: "run-cs",
      laneId: "lane-1",
      correlationId: "run-cs:lane-1:child-sess-1",
      state: "launching",
      heartbeatIntervalMs: 30_000,
      heartbeatCount: 0,
      retryCount: 0,
      maxRetries: 2,
      startedAt: "2026-03-20T10:00:00.000Z",
      updatedAt: "2026-03-20T10:00:00.000Z"
    };

    await store.commitMutation("run-cs", {
      mutationId: "mutation-cs-create",
      actor: "supervisor",
      summary: "Create run with child session.",
      occurredAt: "2026-03-20T10:00:00.000Z",
      createRun: {
        runId: "run-cs",
        status: "active",
        objective: "Test child session upserts.",
        createdAt: "2026-03-20T10:00:00.000Z"
      },
      childSessionUpserts: [childSession]
    });

    // Act – insert
    const stateAfterInsert = await store.getRunState("run-cs");
    expect(stateAfterInsert?.childSessions).toHaveLength(1);
    expect(stateAfterInsert?.childSessions[0]?.sessionId).toBe("child-sess-1");
    expect(stateAfterInsert?.childSessions[0]?.state).toBe("launching");

    // Act – update (upsert same sessionId with new state)
    const updatedChildSession: ChildSessionRecord = {
      ...childSession,
      state: "active",
      previousState: "launching",
      heartbeatCount: 1,
      lastHeartbeatAt: "2026-03-20T10:01:00.000Z",
      updatedAt: "2026-03-20T10:01:00.000Z"
    };

    await store.commitMutation("run-cs", {
      mutationId: "mutation-cs-update",
      actor: "supervisor",
      summary: "Update child session to active.",
      occurredAt: "2026-03-20T10:01:00.000Z",
      childSessionUpserts: [updatedChildSession]
    });

    const stateAfterUpdate = await store.getRunState("run-cs");
    expect(stateAfterUpdate?.childSessions).toHaveLength(1);
    expect(stateAfterUpdate?.childSessions[0]?.state).toBe("active");
    expect(stateAfterUpdate?.childSessions[0]?.heartbeatCount).toBe(1);
    expect(stateAfterUpdate?.childSessions[0]?.lastHeartbeatAt).toBe("2026-03-20T10:01:00.000Z");
  });

  it("persists child sessions across a full read/write cycle", async () => {
    // Arrange
    const rootDir = createTempRoot();
    const writer = createFileBackedSupervisorStateStore({ rootDir });

    const childSession: ChildSessionRecord = {
      sessionId: "child-persist-1",
      parentRunId: "run-persist",
      laneId: "lane-1",
      correlationId: "run-persist:lane-1:child-persist-1",
      state: "active",
      heartbeatIntervalMs: 30_000,
      heartbeatCount: 3,
      retryCount: 0,
      maxRetries: 2,
      startedAt: "2026-03-20T10:00:00.000Z",
      lastHeartbeatAt: "2026-03-20T10:03:00.000Z",
      updatedAt: "2026-03-20T10:03:00.000Z"
    };

    await writer.commitMutation("run-persist", {
      mutationId: "mutation-persist-1",
      actor: "supervisor",
      summary: "Create run with active child session.",
      occurredAt: "2026-03-20T10:00:00.000Z",
      createRun: {
        runId: "run-persist",
        status: "active",
        objective: "Verify child sessions survive a read/write cycle.",
        createdAt: "2026-03-20T10:00:00.000Z"
      },
      childSessionUpserts: [childSession]
    });

    // Act – read from a separate store instance (simulates process restart)
    const reader = createFileBackedSupervisorStateStore({ rootDir });
    const state = await reader.getRunState("run-persist");

    // Assert
    expect(state?.childSessions).toHaveLength(1);
    expect(state?.childSessions[0]).toMatchObject({
      sessionId: "child-persist-1",
      parentRunId: "run-persist",
      state: "active",
      heartbeatCount: 3,
      lastHeartbeatAt: "2026-03-20T10:03:00.000Z"
    });
  });
});
