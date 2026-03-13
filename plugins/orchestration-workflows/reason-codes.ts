import type { Role } from "./types";

export type SupervisorReasonCategory =
  | "route-selection"
  | "assignment"
  | "fallback"
  | "budget-escalation"
  | "approval-pause"
  | "blocked-action";

export type SupervisorReasonCode =
  | "route.multi-role-thread"
  | "route.delegated-thread"
  | "assignment.weighted-turns"
  | "fallback.compaction-guardrail"
  | "fallback.compaction-critical-slots"
  | "budget.warning-threshold"
  | "budget.escalation-required"
  | "budget.hard-stop"
  | "budget.output-compact"
  | "budget.output-truncate"
  | "budget.output-halt"
  | "approval.manual-review-default"
  | "approval.service-critical-review"
  | "approval.blocked-path-review"
  | "approval.eligible-path-review"
  | "approval.auto-merge-allowed"
  | "blocked.missing-mcp-provider"
  | "blocked.mcp-access";

export type SupervisorReasonDetail = {
  code: SupervisorReasonCode;
  category: SupervisorReasonCategory;
  short: string;
  explanation: string;
};

type SupervisorReasonContext = {
  leadRole?: Role;
  roles?: readonly Role[];
  targets?: Partial<Record<Role, number>>;
  usagePercent?: number;
  missingProviders?: readonly string[];
  actionReason?: string;
};

const formatRoleList = (roles: readonly Role[]): string => roles.join(", ");

const formatTurnPlan = (targets: Partial<Record<Role, number>>, roles: readonly Role[]): string => roles
  .filter((role) => (targets[role] ?? 0) > 0)
  .map((role) => `${role}:${targets[role]}`)
  .join(" ");

export const createSupervisorReasonDetail = (
  code: SupervisorReasonCode,
  context: SupervisorReasonContext = {}
): SupervisorReasonDetail => {
  switch (code) {
    case "route.multi-role-thread": {
      const roles = context.roles ?? [];
      return {
        code,
        category: "route-selection",
        short: "Multi-role thread selected.",
        explanation: roles.length > 0
          ? `Routed this checkpoint through a threaded discussion because multiple roles stayed active: ${formatRoleList(roles)}.`
          : "Routed this checkpoint through a threaded discussion because multiple roles stayed active."
      };
    }
    case "route.delegated-thread": {
      const roles = context.roles ?? [];
      return {
        code,
        category: "route-selection",
        short: "Delegation expanded the route.",
        explanation: roles.length > 0
          ? `Expanded a single-role response into a threaded route after delegation activated: ${formatRoleList(roles)}.`
          : "Expanded a single-role response into a threaded route after delegation activated additional roles."
      };
    }
    case "assignment.weighted-turns": {
      const roles = context.roles ?? [];
      const plan = context.targets && roles.length > 0 ? formatTurnPlan(context.targets, roles) : "";
      const lead = context.leadRole ? ` Lead ${context.leadRole} opens and closes.` : "";
      return {
        code,
        category: "assignment",
        short: "Weighted turn plan assigned.",
        explanation: plan
          ? `Assigned turns with the weighted plan ${plan}.${lead}`.trim()
          : `Assigned turns with the detected role weighting.${lead}`.trim()
      };
    }
    case "fallback.compaction-guardrail":
      return {
        code,
        category: "fallback",
        short: "Compaction skipped.",
        explanation: "Skipped compaction because the reduction guardrail was not met, so the full checkpoint stayed intact."
      };
    case "fallback.compaction-critical-slots":
      return {
        code,
        category: "fallback",
        short: "Compaction fallback preserved signal.",
        explanation: "Skipped compaction because it would have dropped critical goal, constraint, blocker, or open-action context."
      };
    case "budget.warning-threshold":
      return {
        code,
        category: "budget-escalation",
        short: "Budget warning threshold crossed.",
        explanation: `Budget usage reached ${context.usagePercent}% and stayed in warning mode, so execution can continue under watch.`
      };
    case "budget.escalation-required":
      return {
        code,
        category: "budget-escalation",
        short: "Budget escalation required.",
        explanation: `Budget usage reached ${context.usagePercent}% and now requires checkpoint review before more automation continues.`
      };
    case "budget.hard-stop":
      return {
        code,
        category: "budget-escalation",
        short: "Budget hard stop triggered.",
        explanation: `Budget usage reached ${context.usagePercent}% and hit the configured hard stop, so automation pauses here.`
      };
    case "budget.output-compact":
      return {
        code,
        category: "budget-escalation",
        short: "Output compacted for budget.",
        explanation: context.actionReason
          ? `Compacted the checkpoint output to stay within budget: ${context.actionReason}.`
          : "Compacted the checkpoint output to stay within budget."
      };
    case "budget.output-truncate":
      return {
        code,
        category: "budget-escalation",
        short: "Output truncated for budget.",
        explanation: context.actionReason
          ? `Truncated the checkpoint output to stay within budget: ${context.actionReason}.`
          : "Truncated the checkpoint output to stay within budget."
      };
    case "budget.output-halt":
      return {
        code,
        category: "budget-escalation",
        short: "Output paused for budget.",
        explanation: context.actionReason
          ? `Paused the checkpoint output because the budget governor blocked more output: ${context.actionReason}.`
          : "Paused the checkpoint output because the budget governor blocked more output."
      };
    case "approval.manual-review-default":
      return {
        code,
        category: "approval-pause",
        short: "Manual review is still the default.",
        explanation: "Paused for human approval because the repository keeps merge decisions in manual review mode by default."
      };
    case "approval.service-critical-review":
      return {
        code,
        category: "approval-pause",
        short: "Service-critical change needs review.",
        explanation: "Paused for human approval because service-critical changes are not allowed to auto-merge without an explicit opt-in."
      };
    case "approval.blocked-path-review":
      return {
        code,
        category: "approval-pause",
        short: "Blocked paths need review.",
        explanation: "Paused for human approval because one or more changed paths are explicitly blocked from auto-merge."
      };
    case "approval.eligible-path-review":
      return {
        code,
        category: "approval-pause",
        short: "Path policy needs review.",
        explanation: "Paused for human approval because one or more changed paths fell outside the configured auto-merge scope."
      };
    case "approval.auto-merge-allowed":
      return {
        code,
        category: "approval-pause",
        short: "Auto-merge checks passed.",
        explanation: "Allowed auto-merge because criticality, path, and opt-in policy checks all passed."
      };
    case "blocked.missing-mcp-provider": {
      const providers = context.missingProviders?.join(", ") ?? "the required providers";
      return {
        code,
        category: "blocked-action",
        short: "Required MCP check still missing.",
        explanation: `Blocked the final recommendation until at least one MCP check covers: ${providers}.`
      };
    }
    case "blocked.mcp-access":
      return {
        code,
        category: "blocked-action",
        short: "MCP access blocked.",
        explanation: context.actionReason
          ? `Blocked the MCP action: ${context.actionReason}.`
          : "Blocked the MCP action because it did not satisfy the current policy."
      };
  }
};

export const formatSupervisorReason = (
  detail: SupervisorReasonDetail,
  prefix = "[Supervisor]"
): string => `${prefix} ${detail.code}: ${detail.explanation}`;
