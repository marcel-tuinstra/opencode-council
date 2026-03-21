import type { OpencodeClient } from "@opencode-ai/plugin";
import type {
  AttachSupervisorRuntimeSessionInput,
  LaunchSupervisorRuntimeSessionInput,
  SupervisorRuntimeSessionSnapshot,
  SupervisorRuntimeSessionStatus,
  SupervisorSessionRuntimeAdapter
} from "./session-runtime-adapter.ts";

/**
 * Configuration for creating an OpenCode client-backed runtime adapter.
 */
export type OpencodeClientAdapterOptions = {
  client: OpencodeClient;
  directory: string;
  parentSessionId?: string;
};

/**
 * Maps an OpenCode session status string to the supervisor runtime status enum.
 *
 * OpenCode reports statuses like "idle", "running", "completed", "error", etc.
 * We collapse these into the four-state `SupervisorRuntimeSessionStatus`.
 */
const mapSessionStatus = (raw: string | undefined | null): SupervisorRuntimeSessionStatus => {
  switch (raw) {
    case "running":
    case "pending":
    case "idle":
      return "active";
    case "paused":
      return "paused";
    case "completed":
    case "done":
    case "aborted":
    case "cancelled":
      return "completed";
    case "error":
    case "failed":
      return "failed";
    default:
      return "active";
  }
};

/**
 * Creates a `SupervisorSessionRuntimeAdapter` backed by the real
 * OpenCode `client.session.*` APIs.
 *
 * This adapter translates the durable supervisor session lifecycle into
 * concrete OpenCode SDK calls:
 *
 * - `launchSession` → `session.create` + `session.promptAsync`
 * - `attachSession` → `session.get` (re-reads the live status)
 */
export const createOpencodeClientRuntimeAdapter = (
  options: OpencodeClientAdapterOptions
): SupervisorSessionRuntimeAdapter => {
  const { client, directory, parentSessionId } = options;

  const launchSession = async (
    input: LaunchSupervisorRuntimeSessionInput
  ): Promise<SupervisorRuntimeSessionSnapshot> => {
    const createResponse = await client.session.create({
      body: {
        parentID: parentSessionId,
        title: input.laneId
      },
      query: {
        directory
      }
    });

    const sessionId = createResponse.data.id;

    const systemPrompt = [
      `You are the ${input.owner} agent.`,
      `Lane: ${input.laneId}`,
      `Branch: ${input.branch}`,
      `Worktree: ${input.worktreePath}`
    ].join("\n");

    const promptText = input.resumeSessionId
      ? `Resume work from previous session ${input.resumeSessionId}.`
      : "Begin work on your assigned lane.";

    try {
      await client.session.promptAsync({
        path: { id: sessionId },
        body: {
          system: systemPrompt,
          agent: input.owner,
          parts: [{ type: "text", text: promptText }]
        }
      });
    } catch (error) {
      await abortChildSession(client, sessionId);
      throw error;
    }

    return {
      runtimeSessionId: sessionId,
      owner: input.owner,
      status: "active",
      attachedAt: new Date().toISOString()
    };
  };

  const attachSession = async (
    input: AttachSupervisorRuntimeSessionInput
  ): Promise<SupervisorRuntimeSessionSnapshot> => {
    const response = await client.session.get({
      path: { id: input.sessionId }
    });

    const data = response.data;
    const status = mapSessionStatus(data?.status);

    return {
      runtimeSessionId: input.sessionId,
      owner: input.owner,
      status,
      attachedAt: new Date().toISOString(),
      lastHeartbeatAt: data?.lastHeartbeatAt ?? undefined,
      failureReason: status === "failed" ? (data?.error ?? data?.failureReason ?? undefined) : undefined
    };
  };

  return {
    runtime: "opencode",
    launchSession,
    attachSession
  };
};

/**
 * Abort a child session. Fire-and-forget — all errors are silently swallowed.
 */
export const abortChildSession = async (
  client: OpencodeClient,
  sessionId: string
): Promise<void> => {
  try {
    await client.session.abort({ path: { id: sessionId } });
  } catch {
    // fire-and-forget: swallow all errors
  }
};

/**
 * Retrieve all messages from a child session.
 */
export const getChildSessionMessages = async (
  client: OpencodeClient,
  sessionId: string
): Promise<any[]> => {
  const response = await client.session.messages({ path: { id: sessionId } });
  return Array.isArray(response.data) ? response.data : [];
};
