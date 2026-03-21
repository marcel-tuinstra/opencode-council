import type { Plugin, PluginInput, OpencodeClient } from "@opencode-ai/plugin";
import {
  DEEP_MCP_REGEX,
  MARKER_PREFIX,
  MARKER_REMOVAL_REGEX,
  MARKER_SUFFIX,
  STALE_SENSITIVE_REGEX
} from "./constants";
import { buildSystemInstruction, enforceUserContract } from "./contracts";
import { debugLog, previewText } from "./debug";
import { appendCompactionNotice, compactWorkflowContext } from "./compact";
import { buildTurnTargets, detectIntent, shouldUseHeartbeat } from "./intent";
import {
  clearSessionBudgetState,
  estimateTokens,
  finalizeBudgetRun,
  getTruncateTokenLimit,
  recordBudgetUsage
} from "./budget";
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
  applyBudgetAction,
  appendMissingProviderNotice,
  appendSupervisorDecisionNotes,
  extractDelegatedRoles,
  normalizeThreadOutput,
  stripControlLeakage
} from "./output";
import {
  buildDelegationPlan,
  detectDelegationRequest,
  detectRolesFromMentions,
  detectRolesFromText
} from "./roles";
import { getSupervisorPolicy, getSupervisorPolicyDiagnostics } from "./supervisor-config";
import { createSupervisorReasonDetail, formatSupervisorReason } from "./reason-codes";
import {
  resetSessionState,
  sessionPolicy,
  systemInjectedForSession
} from "./session";
import type { Role } from "./types";

export const AgentConversations: Plugin = async (input: PluginInput) => {
  const opencodeClient: OpencodeClient | undefined = input?.client;
  void opencodeClient; // retained for Waves 2-4

  await initializeProviderPatterns();
  const policyDiagnostics = getSupervisorPolicyDiagnostics();
  if (policyDiagnostics.length > 0) {
    debugLog("supervisor.policy.diagnostics", {
      reasonCode: "governance.policy-invalid",
      remediation: [
        "Review the reported supervisor policy diagnostics.",
        "Fix the policy file or remove it to keep the default safe policy."
      ],
      diagnostics: policyDiagnostics
    });
  }

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
      const userMessages = output.messages.filter((message: { info: { role: string } }) => message.info.role === "user");
      const message = userMessages[userMessages.length - 1];
      if (!message) {
        debugLog("messages.transform.no_user_message");
        return;
      }

      if (message.info.sessionID && !sessionPolicy.has(message.info.sessionID)) {
        await initializeProviderPatterns(true);
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
          sessionId: message.info.sessionID,
          nonTextParts,
          textPartsWithRoles,
          textPartsWithoutRoles
      });

      if (!roles || roles.length === 0) {
        resetSessionState(message.info.sessionID);
        clearSessionBudgetState(message.info.sessionID);
        debugLog("messages.transform.policy_cleared", {
          sessionId: message.info.sessionID,
          reason: "no_roles_detected"
        });
        return;
      }

      const intent = detectIntent(sourceText);
      const delegation = detectDelegationRequest(sourceText);
      const delegationPlan = delegation
        ? buildDelegationPlan(delegation, roles, sourceText)
        : null;
      const compactedInput = compactWorkflowContext(sourceText, intent);
      const workingSourceText = compactedInput.text;
      const activeRoles = delegation && roles.includes(delegation.primaryRole)
        ? [delegation.primaryRole, ...roles.filter((role) => role !== delegation.primaryRole)]
        : roles;
      const targets = buildTurnTargets(activeRoles, workingSourceText);
      const heartbeat = shouldUseHeartbeat(activeRoles);
      const mcpProviders = detectMcpProviders(workingSourceText);
      const mcpHints = buildMcpHints(mcpProviders);
      const staleSensitive = STALE_SENSITIVE_REGEX.test(workingSourceText);
      const allowDeepMcp = DEEP_MCP_REGEX.test(workingSourceText);
      recordBudgetUsage(message.info.sessionID, intent, "plan", estimateTokens(sourceText));

      for (const part of message.parts) {
        if (part.type === "text") {
          const withCompaction = part.text === sourceText ? workingSourceText : part.text;
          part.text = enforceUserContract(withCompaction, activeRoles, targets, heartbeat, mcpProviders, staleSensitive);
        }
      }

      sessionPolicy.set(message.info.sessionID, {
        roles: activeRoles,
        targets,
        heartbeat,
        intent,
        delegation,
        delegationPlan,
        mcpProviders,
        mcpHints,
        staleSensitive,
        allowDeepMcp,
        mcpCallCount: 0,
        mcpTouched: {},
        mcpWarnings: []
      });

      debugLog("messages.transform.policy_set", {
        sessionId: message.info.sessionID,
        roles: activeRoles,
        delegation,
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
          sessionId: input.sessionID ?? null,
          reason: input.sessionID ? "already_injected" : "missing_session_id"
        });
        return;
      }

      const policy = sessionPolicy.get(input.sessionID);
      const roles = policy?.roles;
      if (!roles || roles.length === 0) {
        debugLog("system.transform.no_roles", { sessionId: input.sessionID });
        return;
      }

      const targets = policy?.targets ?? buildTurnTargets(roles, "");
      const heartbeat = policy?.heartbeat ?? shouldUseHeartbeat(roles);
      const mcpProviders = policy?.mcpProviders ?? [];
      const staleSensitive = policy?.staleSensitive ?? false;

      output.system.push(buildSystemInstruction(roles, targets, heartbeat, mcpProviders, staleSensitive, policy?.delegationPlan ?? null));
      systemInjectedForSession.add(input.sessionID);

      debugLog("system.transform.injected", {
        sessionId: input.sessionID,
        roles,
        mcpProviders
      });
    },

    "tool.execute.before": async (input) => {
      const provider = providerFromToolName(input.tool);
      if (!provider) {
        debugLog("tool.execute.before.skip_non_mcp", {
          sessionId: input.sessionID,
          tool: input.tool
        });
        return;
      }

      const policy = sessionPolicy.get(input.sessionID);
      if (!policy) {
        debugLog("tool.execute.before.skip_no_policy", {
          sessionId: input.sessionID,
          tool: input.tool,
          provider
        });
        return;
      }

      const executeBudget = recordBudgetUsage(
        input.sessionID,
        policy.intent,
        "execute",
        estimateTokens(input.tool)
      );
      if (executeBudget.action === "halt") {
        debugLog("tool.execute.before.budget_halt", {
          sessionId: input.sessionID,
          tool: input.tool,
          reason: executeBudget.reason,
          reasonCode: executeBudget.reasonCode,
          remediation: executeBudget.remediation,
          usagePercent: executeBudget.usagePercent
        });
        const message = formatSupervisorReason(createSupervisorReasonDetail(
          executeBudget.reasonCode ?? "budget.hard-stop",
          { usagePercent: executeBudget.usagePercent, actionReason: executeBudget.reason }
        ));
        throw new Error(`${message} Remediation: ${executeBudget.remediation.join(" ")}`);
      }

      const result = checkMcpAccess(input.tool, policy);
      if (result.blocked) {
        if (result.warning) {
          policy.mcpWarnings.push({
            message: result.warning,
            reasonCode: result.reasonCode,
            remediation: result.remediation
          });
          sessionPolicy.set(input.sessionID, policy);
        }

        debugLog("tool.execute.before.blocked", {
          sessionId: input.sessionID,
          provider,
          tool: input.tool,
          warning: result.warning,
          reasonCode: result.reasonCode,
          remediation: result.remediation
        });
        const message = formatSupervisorReason(createSupervisorReasonDetail(
          result.reasonCode ?? "blocked.mcp-access",
          { actionReason: result.warning }
        ));
        throw new Error(`${message}${result.remediation?.length ? ` Remediation: ${result.remediation.join(" ")}` : ""}`);
      }

      policy.mcpCallCount += 1;
      policy.mcpTouched[provider] = (policy.mcpTouched[provider] ?? 0) + 1;
      sessionPolicy.set(input.sessionID, policy);

      debugLog("tool.execute.before.allowed", {
        sessionId: input.sessionID,
        provider,
        tool: input.tool,
        mcpCallCount: policy.mcpCallCount,
        cap: policy.allowDeepMcp
          ? getSupervisorPolicy().limits.mcp.deepCallCap
          : getSupervisorPolicy().limits.mcp.defaultCallCap
      });
    },

    "experimental.text.complete": async (input, output) => {
      const policy = sessionPolicy.get(input.sessionID);
      if (!policy) {
        debugLog("text.complete.skip_no_policy", { sessionId: input.sessionID });
        return;
      }

      let nextText = stripControlLeakage(output.text);
      let activeRoles = policy.roles;
      let activeTargets = policy.targets;

      const summarizeBudget = recordBudgetUsage(
        input.sessionID,
        policy.intent,
        "summarize",
        estimateTokens(nextText)
      );

      if (policy.roles.length === 1) {
        const delegated = extractDelegatedRoles(nextText, policy.roles[0]);
        nextText = delegated.text;

        if (delegated.roles.length > 1) {
          activeRoles = delegated.roles;
          activeTargets = buildTurnTargets(activeRoles, nextText);
          nextText = normalizeThreadOutput(nextText, activeRoles, activeTargets);
          nextText = appendSupervisorDecisionNotes(nextText, activeRoles, activeTargets, "delegated-thread", {
            requestedByUser: policy.delegationPlan?.requestedByUser ?? policy.delegation?.requestedByUser ?? policy.roles,
            delegatedBy: delegated.delegatedBy,
            delegatedRoles: delegated.delegatedRoles,
            addedByOrchestrator: [],
            waves: policy.delegationPlan?.waves,
            maxParallelAgents: policy.delegationPlan?.maxParallelAgents
          });
          debugLog("text.complete.delegation_upgraded", {
            sessionId: input.sessionID,
            leadRole: policy.roles[0],
            delegatedRoles: delegated.roles.slice(1)
          });
        }
      }

      if (policy.roles.length > 1) {
        nextText = normalizeThreadOutput(nextText, activeRoles, activeTargets);
        nextText = appendSupervisorDecisionNotes(nextText, activeRoles, activeTargets, "multi-role-thread", {
          requestedByUser: policy.delegation?.requestedByUser ?? policy.roles
        });
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
      const compactedOutput = compactWorkflowContext(nextText, policy.intent);
      if (compactedOutput.compacted) {
        nextText = appendCompactionNotice(compactedOutput.text, compactedOutput.summary);
      } else if (compactedOutput.fallbackReason) {
        nextText = appendCompactionNotice(nextText, compactedOutput.fallbackReason);
      }

      if (summarizeBudget.action === "compact" || summarizeBudget.action === "truncate" || summarizeBudget.action === "halt") {
        nextText = applyBudgetAction(nextText, summarizeBudget.action, summarizeBudget.reason, getTruncateTokenLimit());
      }
      output.text = nextText;

      const baseline = finalizeBudgetRun(input.sessionID);
      if (baseline) {
        debugLog("text.complete.baseline_report", {
          sessionId: input.sessionID,
          intent: policy.intent,
          p50Tokens: baseline.p50Tokens,
          p95Tokens: baseline.p95Tokens,
          runs: baseline.runs
        });
      }

      debugLog("text.complete.processed", {
        sessionId: input.sessionID,
        roles: activeRoles,
        mcpProviders: policy.mcpProviders,
        staleSensitive: policy.staleSensitive,
        hadThreadNormalization: activeRoles.length > 1,
        mcpWarningsCount: policy.mcpWarnings.length
      });

      clearSessionBudgetState(input.sessionID);
    }
  };
};
