import type { Role } from "./types";

export type SupervisorReasonCategory =
  | "route-selection"
  | "assignment"
  | "fallback"
  | "budget-escalation"
  | "approval-pause"
  | "governance-policy"
  | "blocked-action";

export type SupervisorReasonCode =
  | "route.intent-profile"
  | "route.lane-match"
  | "route.multi-role-thread"
  | "route.delegated-thread"
  | "assignment.sticky-session-owner"
  | "assignment.deterministic-owner"
  | "assignment.weighted-turns"
  | "fallback.missing-prerequisites"
  | "fallback.low-confidence"
  | "fallback.compaction-guardrail"
  | "fallback.compaction-critical-slots"
  | "fallback.compaction-continuity"
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
  | "approval.protected-path-review"
  | "approval.protected-path-denied"
  | "approval.protected-path-allowed"
  | "approval.governance-boundary"
  | "approval.resume-approved"
  | "approval.rejected-hold"
  | "governance.explicit-policy"
  | "governance.policy-default"
  | "governance.policy-missing"
  | "governance.policy-invalid"
  | "delegation.launch"
  | "provenance.delegated-wave"
  | "provenance.max-parallel"
  | "blocked.missing-mcp-provider"
  | "blocked.mcp-access"
  | "blocked.unknown-run"
  | "blocked.unknown-lane"
  | "blocked.unknown-session";

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
  missingPrerequisites?: readonly string[];
  actionReason?: string;
  intent?: string;
  path?: string;
  laneId?: string;
  owner?: string;
  confidence?: string;
  policyId?: string;
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
    case "route.intent-profile": {
      const path = context.path ?? "the default execution path";
      const intent = context.intent ? ` from the ${context.intent} intent profile` : "";
      return {
        code,
        category: "route-selection",
        short: "Intent profile selected the route.",
        explanation: `Routed this work unit to ${path}${intent}.`.trim()
      };
    }
    case "route.lane-match": {
      const laneId = context.laneId ?? "the selected lane";
      const path = context.path ? ` on the ${context.path} path` : "";
      return {
        code,
        category: "route-selection",
        short: "Lane matched for execution.",
        explanation: `Matched this work unit to ${laneId}${path} so the supervisor can continue deterministically.`
      };
    }
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
    case "assignment.sticky-session-owner": {
      const owner = context.owner ?? "the existing lane owner";
      return {
        code,
        category: "assignment",
        short: "Existing owner kept.",
        explanation: `Kept ${owner} assigned because the lane already has an attached runtime owner.`
      };
    }
    case "assignment.deterministic-owner": {
      const owner = context.owner ?? "the selected owner";
      return {
        code,
        category: "assignment",
        short: "Deterministic owner assigned.",
        explanation: `Assigned ${owner} with a stable deterministic selection so repeated routing keeps the same owner.`
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
    case "fallback.missing-prerequisites": {
      const prerequisites = context.missingPrerequisites?.join(", ") ?? "required prerequisites";
      return {
        code,
        category: "fallback",
        short: "Prerequisites still missing.",
        explanation: `Held execution on a safe fallback path because prerequisite references are still missing: ${prerequisites}.`
      };
    }
    case "fallback.low-confidence":
      return {
        code,
        category: "fallback",
        short: "Routing confidence is low.",
        explanation: context.confidence
          ? `Held execution on a safe fallback path because routing confidence stayed ${context.confidence}.`
          : "Held execution on a safe fallback path because routing confidence stayed too low."
      };
    case "fallback.compaction-guardrail":
      return {
        code,
        category: "fallback",
        short: "Compaction skipped.",
        explanation: "Full context kept because compaction would not save enough space."
      };
    case "fallback.compaction-critical-slots":
      return {
        code,
        category: "fallback",
        short: "Compaction kept key signal.",
        explanation: "Full context kept because compaction would hide goals, constraints, blockers, or next steps."
      };
    case "fallback.compaction-continuity":
      return {
        code,
        category: "fallback",
        short: "Compaction kept recent context.",
        explanation: "Full context kept because compaction would hide the latest working context."
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
    case "approval.protected-path-review":
      return {
        code,
        category: "approval-pause",
        short: "Protected paths need review.",
        explanation: "Paused for human approval because one or more changed paths matched a protected-path rule that requires review and audit evidence."
      };
    case "approval.protected-path-denied":
      return {
        code,
        category: "blocked-action",
        short: "Protected paths denied.",
        explanation: "Blocked the action because one or more changed paths matched a protected-path rule that does not allow autonomous writes or merges."
      };
    case "approval.protected-path-allowed":
      return {
        code,
        category: "approval-pause",
        short: "Protected-path checks passed.",
        explanation: "Allowed the action because every changed path stayed inside the currently allowed protected-path policy scope."
      };
    case "approval.governance-boundary": {
      const boundary = context.path ?? "governance";
      const action = context.actionReason ?? "the requested action";
      return {
        code,
        category: "approval-pause",
        short: "Governance boundary requires approval.",
        explanation: `Paused at the ${boundary} governance boundary until a human approves ${action}.`
      };
    }
    case "approval.resume-approved": {
      const boundary = context.path ?? "governance";
      const action = context.actionReason ?? "the requested action";
      return {
        code,
        category: "approval-pause",
        short: "Human approval received.",
        explanation: `Resumed only after an explicit human approval event cleared ${action} at the ${boundary} governance boundary.`
      };
    }
    case "approval.rejected-hold": {
      const boundary = context.path ?? "governance";
      const action = context.actionReason ?? "the requested action";
      return {
        code,
        category: "approval-pause",
        short: "Approval rejected.",
        explanation: `Kept execution paused because human review rejected ${action} at the ${boundary} governance boundary.`
      };
    }
    case "governance.explicit-policy": {
      const checkpoint = context.path ?? "checkpoint";
      const outcome = context.actionReason ?? "accept";
      const ruleSummary = context.policyId ? ` Matched rules: ${context.policyId}.` : "";
      return {
        code,
        category: "governance-policy",
        short: "Explicit governance policy matched.",
        explanation: `Applied explicit governance policy at ${checkpoint} and routed the checkpoint to ${outcome}.${ruleSummary}`.trim()
      };
    }
    case "governance.policy-default": {
      const checkpoint = context.path ?? "checkpoint";
      const outcome = context.actionReason ?? "accept";
      return {
        code,
        category: "governance-policy",
        short: "Checkpoint default applied.",
        explanation: `No explicit governance rule matched at ${checkpoint}, so the configured default routed the checkpoint to ${outcome}.`
      };
    }
    case "governance.policy-missing": {
      const checkpoint = context.path ?? "checkpoint";
      const outcome = context.actionReason ?? "accept";
      return {
        code,
        category: "governance-policy",
        short: "Governance policy missing.",
        explanation: `No governance policy is configured for ${checkpoint}, so the evaluator failed open to ${outcome} and recorded a warning.`
      };
    }
    case "governance.policy-invalid": {
      const checkpoint = context.path ?? "supervisor policy";
      const outcome = context.actionReason ?? "safe defaults";
      const ruleSummary = context.policyId ? ` Diagnostics: ${context.policyId}.` : "";
      return {
        code,
        category: "governance-policy",
        short: "Supervisor policy invalid.",
        explanation: `The ${checkpoint} configuration is invalid, so the runtime failed safe to ${outcome}.${ruleSummary}`.trim()
      };
    }
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
    case "blocked.unknown-run":
      return {
        code,
        category: "blocked-action",
        short: "Supervisor run not found.",
        explanation: context.actionReason
          ? `Blocked the workflow action because the supervisor run could not be found: ${context.actionReason}.`
          : "Blocked the workflow action because the supervisor run could not be found."
      };
    case "blocked.unknown-lane":
      return {
        code,
        category: "blocked-action",
        short: "Lane not found.",
        explanation: context.actionReason
          ? `Blocked the workflow action because the lane could not be found: ${context.actionReason}.`
          : "Blocked the workflow action because the lane could not be found."
      };
    case "blocked.unknown-session":
      return {
        code,
        category: "blocked-action",
        short: "Session not found.",
        explanation: context.actionReason
          ? `Blocked the workflow action because the runtime session could not be found: ${context.actionReason}.`
          : "Blocked the workflow action because the runtime session could not be found."
      };
    case "delegation.launch":
      return {
        code,
        category: "route-selection",
        short: "Delegation launch.",
        explanation: context.leadRole
          ? `Delegated launch by ${context.leadRole}: ${formatRoleList(context.roles ?? [])}.`
          : "Delegated launch to downstream agents."
      };
    case "provenance.delegated-wave":
      return {
        code,
        category: "assignment",
        short: "Delegated wave.",
        explanation: context.leadRole
          ? `Delegated wave by ${context.leadRole}: ${formatRoleList(context.roles ?? [])}.`
          : "Delegated wave to downstream agents."
      };
    case "provenance.max-parallel":
      return {
        code,
        category: "assignment",
        short: "Max parallel agents.",
        explanation: context.usagePercent !== undefined
          ? `Max parallel agents: ${context.usagePercent}.`
          : "Max parallel agents constraint applied."
      };
  }
};

export const formatSupervisorReason = (
  detail: SupervisorReasonDetail,
  prefix = "[Supervisor]"
): string => `${prefix} ${detail.code}: ${detail.explanation}`;
