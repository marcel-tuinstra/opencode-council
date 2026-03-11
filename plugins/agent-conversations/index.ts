import type { Plugin } from "@opencode-ai/plugin";
import {
  DEEP_MCP_REGEX,
  MARKER_PREFIX,
  MARKER_REMOVAL_REGEX,
  MARKER_SUFFIX,
  STALE_SENSITIVE_REGEX,
  MCP_CAPS
} from "./constants";
import { buildSystemInstruction, enforceUserContract } from "./contracts";
import { debugLog, previewText } from "./debug";
import { buildTurnTargets, detectIntent, shouldUseHeartbeat } from "./intent";
import {
  buildMcpHints,
  checkMcpAccess,
  detectMcpProviders,
  getMissingProviders,
  initializeProviderPatterns,
  providerFromToolName
} from "./mcp";
import {
  appendMcpSuggestion,
  appendMcpWarnings,
  appendMissingProviderNotice,
  extractDelegatedRoles,
  normalizeThreadOutput
} from "./output";
import { detectRolesFromMentions, detectRolesFromText } from "./roles";
import {
  resetSessionState,
  sessionPolicy,
  systemInjectedForSession
} from "./session";
import type { Role } from "./types";

export const AgentConversations: Plugin = async () => {
  await initializeProviderPatterns();

  return {
    "tui.prompt.append": async ({ input }) => {
      const roles = detectRolesFromMentions(input);
      if (roles.length === 0) {
        debugLog("tui.prompt.append.no_roles", { preview: previewText(input) });
        return input;
      }

      const marker = `${MARKER_PREFIX}${roles.join(",")}${MARKER_SUFFIX}`;
      debugLog("tui.prompt.append.marker_appended", {
        roles,
        preview: previewText(input)
      });
      return `${input}\n\n${marker}`;
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      const userMessages = output.messages.filter((message) => message.info.role === "user");
      const message = userMessages[userMessages.length - 1];
      if (!message) {
        debugLog("messages.transform.no_user_message");
        return;
      }

      let roles: Role[] | null = null;
      let sourceText = "";
      let nonTextParts = 0;
      let textPartsWithoutRoles = 0;
      let textPartsWithRoles = 0;

      for (const part of message.parts) {
        if (part.type !== "text") {
          nonTextParts += 1;
          continue;
        }

        const parsed = detectRolesFromText(part.text);
        if (!parsed) {
          textPartsWithoutRoles += 1;
          continue;
        }

        textPartsWithRoles += 1;
        roles = parsed;
        sourceText = part.text;
        part.text = part.text.replace(MARKER_REMOVAL_REGEX, "");
      }

      debugLog("messages.transform.parts_processed", {
        sessionID: message.info.sessionID,
        nonTextParts,
        textPartsWithRoles,
        textPartsWithoutRoles
      });

      if (!roles || roles.length === 0) {
        resetSessionState(message.info.sessionID);
        debugLog("messages.transform.policy_cleared", {
          sessionID: message.info.sessionID,
          reason: "no_roles_detected"
        });
        return;
      }

      const intent = detectIntent(sourceText);
      const targets = buildTurnTargets(roles, sourceText);
      const heartbeat = shouldUseHeartbeat(roles);
      const mcpProviders = detectMcpProviders(sourceText);
      const mcpHints = buildMcpHints(mcpProviders);
      const staleSensitive = STALE_SENSITIVE_REGEX.test(sourceText);
      const allowDeepMcp = DEEP_MCP_REGEX.test(sourceText);

      for (const part of message.parts) {
        if (part.type === "text") {
          part.text = enforceUserContract(part.text, roles, targets, heartbeat, mcpProviders, staleSensitive);
        }
      }

      sessionPolicy.set(message.info.sessionID, {
        roles,
        targets,
        heartbeat,
        intent,
        mcpProviders,
        mcpHints,
        staleSensitive,
        allowDeepMcp,
        mcpCallCount: 0,
        mcpTouched: {},
        mcpWarnings: []
      });

      debugLog("messages.transform.policy_set", {
        sessionID: message.info.sessionID,
        roles,
        heartbeat,
        intent,
        mcpProviders,
        staleSensitive,
        allowDeepMcp
      });
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (!input.sessionID || systemInjectedForSession.has(input.sessionID)) {
        debugLog("system.transform.skipped", {
          sessionID: input.sessionID ?? null,
          reason: input.sessionID ? "already_injected" : "missing_session_id"
        });
        return;
      }

      const policy = sessionPolicy.get(input.sessionID);
      const roles = policy?.roles;
      if (!roles || roles.length === 0) {
        debugLog("system.transform.no_roles", { sessionID: input.sessionID });
        return;
      }

      const targets = policy?.targets ?? buildTurnTargets(roles, "");
      const heartbeat = policy?.heartbeat ?? shouldUseHeartbeat(roles);
      const mcpProviders = policy?.mcpProviders ?? [];
      const staleSensitive = policy?.staleSensitive ?? false;

      output.system.push(buildSystemInstruction(roles, targets, heartbeat, mcpProviders, staleSensitive));
      systemInjectedForSession.add(input.sessionID);

      debugLog("system.transform.injected", {
        sessionID: input.sessionID,
        roles,
        mcpProviders
      });
    },

    "tool.execute.before": async (input) => {
      const provider = providerFromToolName(input.tool);
      if (!provider) {
        debugLog("tool.execute.before.skip_non_mcp", {
          sessionID: input.sessionID,
          tool: input.tool
        });
        return;
      }

      const policy = sessionPolicy.get(input.sessionID);
      if (!policy) {
        debugLog("tool.execute.before.skip_no_policy", {
          sessionID: input.sessionID,
          tool: input.tool,
          provider
        });
        return;
      }

      const result = checkMcpAccess(input.tool, policy);
      if (result.blocked) {
        if (result.warning) {
          policy.mcpWarnings.push(result.warning);
          sessionPolicy.set(input.sessionID, policy);
        }

        debugLog("tool.execute.before.blocked", {
          sessionID: input.sessionID,
          provider,
          tool: input.tool,
          warning: result.warning
        });
        throw new Error(result.warning ?? "MCP call blocked.");
      }

      policy.mcpCallCount += 1;
      policy.mcpTouched[provider] = (policy.mcpTouched[provider] ?? 0) + 1;
      sessionPolicy.set(input.sessionID, policy);

      debugLog("tool.execute.before.allowed", {
        sessionID: input.sessionID,
        provider,
        tool: input.tool,
        mcpCallCount: policy.mcpCallCount,
        cap: policy.allowDeepMcp ? MCP_CAPS.deep : MCP_CAPS.default
      });
    },

    "experimental.text.complete": async (input, output) => {
      const policy = sessionPolicy.get(input.sessionID);
      if (!policy) {
        debugLog("text.complete.skip_no_policy", { sessionID: input.sessionID });
        return;
      }

      let nextText = output.text;
      let activeRoles = policy.roles;
      let activeTargets = policy.targets;

      if (policy.roles.length === 1) {
        const delegated = extractDelegatedRoles(nextText, policy.roles[0]);
        nextText = delegated.text;

        if (delegated.roles.length > 1) {
          activeRoles = delegated.roles;
          activeTargets = buildTurnTargets(activeRoles, nextText);
          nextText = normalizeThreadOutput(nextText, activeRoles, activeTargets);
          debugLog("text.complete.delegation_upgraded", {
            sessionID: input.sessionID,
            leadRole: policy.roles[0],
            delegatedRoles: delegated.roles.slice(1)
          });
        }
      }

      if (policy.roles.length > 1) {
        nextText = normalizeThreadOutput(nextText, activeRoles, activeTargets);
      }

      if (policy.mcpProviders.length > 1) {
        const missingProviders = getMissingProviders(policy);
        if (missingProviders.length > 0) {
          nextText = appendMissingProviderNotice(nextText, activeRoles[0], activeRoles.length > 1, missingProviders);
        }
      }

      const shouldSuggestMcp = policy.staleSensitive && policy.mcpProviders.length === 0;
      if (shouldSuggestMcp) {
        nextText = appendMcpSuggestion(nextText, activeRoles[0], activeRoles.length > 1);
      }

      nextText = appendMcpWarnings(nextText, policy.mcpWarnings);
      output.text = nextText;

      debugLog("text.complete.processed", {
        sessionID: input.sessionID,
        roles: activeRoles,
        mcpProviders: policy.mcpProviders,
        staleSensitive: policy.staleSensitive,
        hadThreadNormalization: activeRoles.length > 1,
        mcpWarningsCount: policy.mcpWarnings.length
      });
    }
  };
};
