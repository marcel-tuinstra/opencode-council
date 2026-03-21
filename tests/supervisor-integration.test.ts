import { afterEach, describe, expect, it } from "vitest";
import { AgentConversations } from "../plugins/orchestration-workflows/index";
import {
  sessionPolicy,
  systemInjectedForSession
} from "../plugins/orchestration-workflows/session";
import type { PluginInput, OpencodeClient } from "@opencode-ai/plugin";

/**
 * Mock PluginInput for testing AgentConversations hooks.
 */
const createMockPluginInput = (overrides?: {
  client?: OpencodeClient;
  directory?: string;
}): PluginInput => ({
  client: overrides?.client ?? (undefined as any),
  project: {},
  directory: overrides?.directory ?? "/tmp/test-project",
  worktree: "/tmp/test-project",
  serverUrl: new URL("http://localhost:3000"),
  $: {}
});

/**
 * Build a mock messages output structure matching what OpenCode provides.
 */
const createMessagesOutput = (text: string, sessionID: string) => ({
  messages: [
    {
      info: { role: "user", sessionID },
      parts: [{ type: "text", text }]
    }
  ]
});

/**
 * Build a mock system transform input/output pair.
 */
const createSystemTransformIO = (sessionID: string) => ({
  input: { sessionID },
  output: { system: [] as string[] }
});

/**
 * Build a mock text complete input/output pair.
 */
const createTextCompleteIO = (sessionID: string, text: string) => ({
  input: { sessionID },
  output: { text }
});

afterEach(() => {
  sessionPolicy.clear();
  systemInjectedForSession.clear();
});

describe("supervisor integration (Wave 4)", () => {
  describe("messages.transform — supervisor trigger detection", () => {
    it("detects @supervisor trigger and sets supervisorMode in session policy", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-supervisor-1";
      const output = createMessagesOutput(
        "@supervisor Build auth module, refactor API layer",
        sessionID
      );

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const policy = sessionPolicy.get(sessionID);
      expect(policy).toBeDefined();
      expect(policy!.supervisorMode).toBe(true);
    });

    it("assigns recommended roles from the supervisor plan", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-supervisor-2";
      const output = createMessagesOutput(
        "@supervisor Build authentication module and refactor the API contract layer",
        sessionID
      );

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const policy = sessionPolicy.get(sessionID);
      expect(policy).toBeDefined();
      expect(policy!.roles.length).toBeGreaterThan(0);
      // Supervisor mode should be set
      expect(policy!.supervisorMode).toBe(true);
    });

    it("strips @supervisor prefix from message parts", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-supervisor-3";
      const output = createMessagesOutput(
        "@supervisor Build authentication module and refactor the API contract layer",
        sessionID
      );

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const lastMessage = output.messages[output.messages.length - 1];
      const textPart = lastMessage.parts.find((p: any) => p.type === "text") as { type: string; text: string };
      expect(textPart).toBeDefined();
      expect(textPart!.text).not.toMatch(/^@supervisor/i);
      expect(textPart!.text).toContain("Build authentication module");
    });

    it("skips normal role detection when supervisor trigger is detected", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-supervisor-4";
      const output = createMessagesOutput(
        "@supervisor Build authentication module and design the frontend dashboard",
        sessionID
      );

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const policy = sessionPolicy.get(sessionID);
      expect(policy).toBeDefined();
      // Should have supervisor mode, not regular role detection
      expect(policy!.supervisorMode).toBe(true);
      // Delegation should be null since we bypassed normal flow
      expect(policy!.delegation).toBeNull();
      expect(policy!.delegationPlan).toBeNull();
    });

    it("does not set supervisor mode for non-supervisor messages", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-no-supervisor";
      const output = createMessagesOutput(
        "Just a plain message without any mentions",
        sessionID
      );

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const policy = sessionPolicy.get(sessionID);
      // No policy should be set for a plain message (no roles detected)
      expect(policy).toBeUndefined();
    });
  });

  describe("system.transform — supervisor instruction injection", () => {
    it("injects supervisor system instructions when plan is supported", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-sys-1";

      // First, set up the supervisor trigger via messages.transform
      const msgOutput = createMessagesOutput(
        "@supervisor Build authentication module and refactor the API contract layer",
        sessionID
      );
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      // Then call system.transform
      const { input, output } = createSystemTransformIO(sessionID);
      await hooks["experimental.chat.system.transform"]!(input, output);

      // Should have at least 2 system entries: supervisor instruction + normal instruction
      expect(output.system.length).toBeGreaterThanOrEqual(2);
      // First system entry should be the supervisor instruction
      expect(output.system[0]).toContain("Supervisor mode");
    });
  });

  describe("text.complete — supervisor plan preview", () => {
    it("prepends supervisor plan preview to output text", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-text-1";

      // Set up supervisor trigger
      const msgOutput = createMessagesOutput(
        "@supervisor Build authentication module and refactor the API contract layer",
        sessionID
      );
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      // Call text.complete
      const { input, output } = createTextCompleteIO(sessionID, "LLM response here");
      await hooks["experimental.text.complete"]!(input, output);

      // Output should start with supervisor plan preview
      expect(output.text).toContain("[Supervisor] Plan");
    });

    it("shows sane synthesized preview for mixed discovery prompts", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-text-discovery";

      const msgOutput = createMessagesOutput(
        "@supervisor research competitor patterns, shape launch positioning, and outline a near-term roadmap",
        sessionID
      );
      await hooks["experimental.chat.messages.transform"]!({}, msgOutput);

      const { input, output } = createTextCompleteIO(sessionID, "LLM response here");
      await hooks["experimental.text.complete"]!(input, output);

      expect(output.text).toContain("[Supervisor] Plan");
      expect(output.text).toContain("comparison dimensions");
      expect(output.text).toContain("recommendations");
    });
  });

  describe("tool registration — supervisor_launch", () => {
    it("returns a tool hook with supervisor_launch", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      expect(hooks.tool).toBeDefined();
      expect(hooks.tool!.supervisor_launch).toBeDefined();
    });

    it("supervisor_launch has the correct shape", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const toolDef = hooks.tool!.supervisor_launch as any;
      expect(toolDef.description).toContain("Launch a child agent session");
      expect(toolDef.parameters).toBeDefined();
      expect(toolDef.parameters.properties.laneId).toBeDefined();
      expect(toolDef.parameters.properties.objective).toBeDefined();
      expect(toolDef.parameters.properties.role).toBeDefined();
      expect(typeof toolDef.execute).toBe("function");
    });

    it("supervisor_launch returns error when no client is available", async () => {
      const hooks = await AgentConversations(createMockPluginInput({ client: undefined as any }));
      const toolDef = hooks.tool!.supervisor_launch as any;
      const result = await toolDef.execute(
        { laneId: "lane-1", objective: "Build auth", role: "DEV" },
        { sessionID: "test-session-tool-1" }
      );
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain("No OpenCode client available");
    });
  });

  describe("event hook — child session monitoring", () => {
    it("returns an event hook", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      expect(hooks.event).toBeDefined();
      expect(typeof hooks.event).toBe("function");
    });

    it("handles events without crashing when no child sessions tracked", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      // Should not throw for unrecognized events
      await hooks.event!({
        event: {
          type: "session.completed",
          properties: { sessionID: "unknown-session" }
        }
      });
    });
  });

  describe("backward compatibility", () => {
    it("existing @cto role detection still works alongside supervisor", async () => {
      const hooks = await AgentConversations(createMockPluginInput());
      const sessionID = "test-session-compat-1";
      const output = createMessagesOutput(
        "Hello\n\n<<ORCHESTRATION_WORKFLOWS:CTO>>",
        sessionID
      );

      await hooks["experimental.chat.messages.transform"]!({}, output);

      const policy = sessionPolicy.get(sessionID);
      expect(policy).toBeDefined();
      expect(policy!.roles).toContain("CTO");
      // Should NOT have supervisor mode
      expect(policy!.supervisorMode).toBeUndefined();
    });
  });
});
