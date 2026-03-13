import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore } from "../plugins/orchestration-workflows/durable-state-store";

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
  it("persists and reloads supervisor run control-plane state from disk", () => {
    // Arrange
    const rootDir = createTempRoot();
    const writer = createFileBackedSupervisorStateStore({ rootDir });

    writer.commitMutation("run-001", {
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
          summary: "Awaiting human review before merge.",
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
    const state = reader.getRunState("run-001");

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

  it("deduplicates retried mutations by mutation id", () => {
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

    store.commitMutation("run-002", mutation);

    // Act
    const secondState = store.commitMutation("run-002", mutation);

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

  it("writes an auditable event file for each committed mutation", () => {
    // Arrange
    const rootDir = createTempRoot();
    const store = createFileBackedSupervisorStateStore({ rootDir });

    store.commitMutation("run-003", {
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
});
