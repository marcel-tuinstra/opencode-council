import { describe, expect, it, vi } from "vitest";
import type { OpencodeClient } from "@opencode-ai/plugin";
import {
  createOpencodeClientRuntimeAdapter,
  abortChildSession,
  getChildSessionMessages,
  type OpencodeClientAdapterOptions
} from "../plugins/orchestration-workflows/opencode-client-adapter.ts";
import type {
  LaunchSupervisorRuntimeSessionInput,
  AttachSupervisorRuntimeSessionInput
} from "../plugins/orchestration-workflows/session-runtime-adapter.ts";

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

function createMockClient(): OpencodeClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "child-session-1" } }),
      promptAsync: vi.fn().mockResolvedValue(undefined),
      status: vi.fn().mockResolvedValue({ data: {} }),
      abort: vi.fn().mockResolvedValue(undefined),
      children: vi.fn().mockResolvedValue({ data: [] }),
      messages: vi.fn().mockResolvedValue({ data: [] }),
      get: vi.fn().mockResolvedValue({ data: { id: "child-session-1", status: "idle" } })
    }
  } as any;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DIRECTORY = "/tmp/test-worktree";
const PARENT_SESSION_ID = "parent-session-0";

const makeLaunchInput = (overrides?: Partial<LaunchSupervisorRuntimeSessionInput>): LaunchSupervisorRuntimeSessionInput => ({
  runId: "run-1",
  laneId: "lane-fe",
  worktreeId: "wt-1",
  worktreePath: "/tmp/test-worktree/lane-fe",
  branch: "feature/lane-fe",
  owner: "FE",
  occurredAt: "2026-03-21T10:00:00.000Z",
  ...overrides
});

const makeAttachInput = (overrides?: Partial<AttachSupervisorRuntimeSessionInput>): AttachSupervisorRuntimeSessionInput => ({
  runId: "run-1",
  laneId: "lane-fe",
  worktreeId: "wt-1",
  worktreePath: "/tmp/test-worktree/lane-fe",
  branch: "feature/lane-fe",
  sessionId: "child-session-1",
  owner: "FE",
  occurredAt: "2026-03-21T10:05:00.000Z",
  ...overrides
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createOpencodeClientRuntimeAdapter", () => {
  // -----------------------------------------------------------------------
  // launchSession
  // -----------------------------------------------------------------------
  describe("launchSession", () => {
    it("calls client.session.create with the correct parentID and directory", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY, parentSessionId: PARENT_SESSION_ID });

      await adapter.launchSession(makeLaunchInput());

      expect(client.session.create).toHaveBeenCalledOnce();
      expect(client.session.create).toHaveBeenCalledWith({
        body: { parentID: PARENT_SESSION_ID, title: "lane-fe" },
        query: { directory: DIRECTORY }
      });
    });

    it("calls client.session.create without parentID when parentSessionId is omitted", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      await adapter.launchSession(makeLaunchInput());

      expect(client.session.create).toHaveBeenCalledWith({
        body: { parentID: undefined, title: "lane-fe" },
        query: { directory: DIRECTORY }
      });
    });

    it("calls client.session.promptAsync with system prompt, agent, and parts", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY, parentSessionId: PARENT_SESSION_ID });

      await adapter.launchSession(makeLaunchInput());

      expect(client.session.promptAsync).toHaveBeenCalledOnce();
      const call = vi.mocked(client.session.promptAsync).mock.calls[0][0];

      expect(call.path).toEqual({ id: "child-session-1" });
      expect(call.body?.agent).toBe("FE");
      expect(call.body?.system).toContain("FE");
      expect(call.body?.system).toContain("lane-fe");
      expect(call.body?.parts).toEqual([{ type: "text", text: "Begin work on your assigned lane." }]);
    });

    it("includes resume context in the prompt when resumeSessionId is provided", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      await adapter.launchSession(makeLaunchInput({ resumeSessionId: "prev-session-7" }));

      const call = vi.mocked(client.session.promptAsync).mock.calls[0][0];
      expect(call.body?.parts[0].text).toContain("prev-session-7");
    });

    it("returns a valid SupervisorRuntimeSessionSnapshot with the child session ID", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.launchSession(makeLaunchInput());

      expect(snapshot.runtimeSessionId).toBe("child-session-1");
      expect(snapshot.owner).toBe("FE");
      expect(snapshot.status).toBe("active");
      expect(typeof snapshot.attachedAt).toBe("string");
      expect(new Date(snapshot.attachedAt).getTime()).not.toBeNaN();
    });

    it("propagates network errors from session.create", async () => {
      const client = createMockClient();
      vi.mocked(client.session.create).mockRejectedValue(new Error("Network timeout"));
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      await expect(adapter.launchSession(makeLaunchInput())).rejects.toThrow("Network timeout");
    });

    it("propagates errors from session.promptAsync", async () => {
      const client = createMockClient();
      vi.mocked(client.session.promptAsync).mockRejectedValue(new Error("Prompt rejected"));
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      await expect(adapter.launchSession(makeLaunchInput())).rejects.toThrow("Prompt rejected");
    });

    it("aborts the created session when promptAsync fails", async () => {
      const client = createMockClient();
      vi.mocked(client.session.promptAsync).mockRejectedValue(new Error("Prompt rejected"));
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      await expect(adapter.launchSession(makeLaunchInput())).rejects.toThrow("Prompt rejected");

      expect(client.session.abort).toHaveBeenCalledOnce();
      expect(client.session.abort).toHaveBeenCalledWith({ path: { id: "child-session-1" } });
    });
  });

  // -----------------------------------------------------------------------
  // attachSession
  // -----------------------------------------------------------------------
  describe("attachSession", () => {
    it("calls client.session.get with the correct session ID", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      await adapter.attachSession(makeAttachInput());

      expect(client.session.get).toHaveBeenCalledOnce();
      expect(client.session.get).toHaveBeenCalledWith({ path: { id: "child-session-1" } });
    });

    it("maps 'idle' status to 'active'", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({ data: { id: "child-session-1", status: "idle" } });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("active");
    });

    it("maps 'running' status to 'active'", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({ data: { id: "child-session-1", status: "running" } });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("active");
    });

    it("maps 'completed' status to 'completed'", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({ data: { id: "child-session-1", status: "completed" } });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("completed");
    });

    it("maps 'aborted' status to 'completed'", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({ data: { id: "child-session-1", status: "aborted" } });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("completed");
    });

    it("maps 'cancelled' status to 'completed'", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({ data: { id: "child-session-1", status: "cancelled" } });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("completed");
    });

    it("maps 'error' status to 'failed' and includes failureReason", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({
        data: { id: "child-session-1", status: "error", error: "OOM killed" }
      });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("failed");
      expect(snapshot.failureReason).toBe("OOM killed");
    });

    it("maps unknown status to 'active' by default", async () => {
      const client = createMockClient();
      vi.mocked(client.session.get).mockResolvedValue({ data: { id: "child-session-1", status: "unknown-state" } });
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput());
      expect(snapshot.status).toBe("active");
    });

    it("returns a valid snapshot preserving the session ID and owner", async () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      const snapshot = await adapter.attachSession(makeAttachInput({ sessionId: "session-xyz", owner: "BE" }));

      expect(snapshot.runtimeSessionId).toBe("session-xyz");
      expect(snapshot.owner).toBe("BE");
      expect(typeof snapshot.attachedAt).toBe("string");
    });
  });

  // -----------------------------------------------------------------------
  // Adapter shape
  // -----------------------------------------------------------------------
  describe("adapter shape", () => {
    it("exposes runtime: 'opencode'", () => {
      const client = createMockClient();
      const adapter = createOpencodeClientRuntimeAdapter({ client, directory: DIRECTORY });

      expect(adapter.runtime).toBe("opencode");
    });
  });
});

// ---------------------------------------------------------------------------
// abortChildSession
// ---------------------------------------------------------------------------

describe("abortChildSession", () => {
  it("calls client.session.abort with the session ID", async () => {
    const client = createMockClient();

    await abortChildSession(client, "child-session-1");

    expect(client.session.abort).toHaveBeenCalledOnce();
    expect(client.session.abort).toHaveBeenCalledWith({ path: { id: "child-session-1" } });
  });

  it("swallows errors gracefully", async () => {
    const client = createMockClient();
    vi.mocked(client.session.abort).mockRejectedValue(new Error("Connection refused"));

    await expect(abortChildSession(client, "child-session-1")).resolves.toBeUndefined();
  });

  it("resolves even when abort rejects with a non-Error value", async () => {
    const client = createMockClient();
    vi.mocked(client.session.abort).mockRejectedValue("string rejection");

    await expect(abortChildSession(client, "child-session-1")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getChildSessionMessages
// ---------------------------------------------------------------------------

describe("getChildSessionMessages", () => {
  it("returns messages array from the client response", async () => {
    const client = createMockClient();
    const mockMessages = [{ id: "msg-1", text: "Hello" }, { id: "msg-2", text: "World" }];
    vi.mocked(client.session.messages).mockResolvedValue({ data: mockMessages });

    const messages = await getChildSessionMessages(client, "child-session-1");

    expect(client.session.messages).toHaveBeenCalledWith({ path: { id: "child-session-1" } });
    expect(messages).toEqual(mockMessages);
  });

  it("returns an empty array when no messages exist", async () => {
    const client = createMockClient();
    vi.mocked(client.session.messages).mockResolvedValue({ data: [] });

    const messages = await getChildSessionMessages(client, "child-session-1");
    expect(messages).toEqual([]);
  });

  it("returns an empty array when response.data is null", async () => {
    const client = createMockClient();
    vi.mocked(client.session.messages).mockResolvedValue({ data: null as any });

    const messages = await getChildSessionMessages(client, "child-session-1");
    expect(messages).toEqual([]);
  });

  it("returns an empty array when response.data is undefined", async () => {
    const client = createMockClient();
    vi.mocked(client.session.messages).mockResolvedValue({ data: undefined as any });

    const messages = await getChildSessionMessages(client, "child-session-1");
    expect(messages).toEqual([]);
  });

  it("propagates errors from the client", async () => {
    const client = createMockClient();
    vi.mocked(client.session.messages).mockRejectedValue(new Error("Session not found"));

    await expect(getChildSessionMessages(client, "nonexistent")).rejects.toThrow("Session not found");
  });
});
