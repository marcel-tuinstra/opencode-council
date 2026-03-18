import type { Role } from "./types";
import { createSupervisorReasonDetail, formatSupervisorReason } from "./reason-codes";
import { normalizeRole } from "./roles";

type DelegationExtractionResult = {
  roles: Role[];
  text: string;
  delegatedBy?: Role;
  delegatedRoles: Role[];
  delegationSource?: "agent-delegated";
};

type SupervisorDecisionProvenance = {
  requestedByUser?: readonly Role[];
  delegatedBy?: Role;
  delegatedRoles?: readonly Role[];
  addedByOrchestrator?: readonly Role[];
  waves?: readonly { wave: number; roles: Role[]; goal: string; dependsOn: number[] }[];
  maxParallelAgents?: number;
};

const DELEGATION_REGEX = /<<DELEGATE:([^>]+)>>/i;
const DELEGATION_REMOVAL_REGEX = /\s*<<DELEGATE:[^>]+>>\s*/gi;

const LEAKED_CONTROL_PREFIXES = [
  "Format: plain prose, no role prefix, no markdown.",
  "Delegation (optional): if needed, emit <<DELEGATE:ROLE1,ROLE2>> then switch to [n] ROLE: message lines.",
  "Format: [n] ROLE: message | Start with",
  "Heartbeat: Phase 1 Frame, Phase 2 Challenge (react to another role), Phase 3 Synthesize by lead.",
  "MCP:",
  "Suggest /mcp if data may be stale.",
  "Use the above message and context to generate a prompt and call the task tool with subagent:",
  "# Plan Mode - System Reminder",
  "CRITICAL: Plan mode ACTIVE",
  "No markdown. Plain lines only.",
  "ctrl+x",
  "ctrl+c",
  "view subagents",
];

const INLINE_LEAK_MARKERS = [
  "Format: [n] ROLE: message | Start with",
  "Format: plain prose, no role prefix, no markdown.",
  "Use the above message and context to generate a prompt and call the task tool with subagent:",
  "<system-reminder>",
  "# Plan Mode - System Reminder",
  "CRITICAL: Plan mode ACTIVE",
  "MCP: disabled.",
  "No markdown. Plain lines only."
];

const trimInlineLeakageTail = (text: string): string => {
  return text
    .split("\n")
    .map((line) => {
      let cutoff = -1;

      for (const marker of INLINE_LEAK_MARKERS) {
        const index = line.indexOf(marker);
        if (index > 0 && line.slice(0, index).trim().length > 0 && (cutoff < 0 || index < cutoff)) {
          cutoff = index;
        }
      }

      return cutoff >= 0 ? line.slice(0, cutoff).trimEnd() : line;
    })
    .join("\n");
};

export const stripControlLeakage = (text: string): string => {
  const withoutInlineTail = trimInlineLeakageTail(text);
  const withoutReminders = withoutInlineTail
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/Format:\s*\[n\]\s*ROLE:\s*message\s*\|\s*Start with[^\n]*(?:\n(?:Heartbeat:.*|MCP:.*|Suggest \/mcp.*|No markdown\..*))*/gi, "")
    .replace(/Format:\s*plain prose, no role prefix, no markdown\.(?:\n(?:Delegation .*|MCP:.*|Include concrete recommendations\.|No markdown\..*))*/gi, "")
    .replace(/Use the above message and context to generate a prompt and call the task tool with subagent:\s*[a-z]+/gi, "");
  const withoutCliHints = withoutReminders
    .replace(/^(?:ctrl\+[a-z](?:\s+\w+)*|view\s+subagents).*$/gmi, "");
  const lines = withoutCliHints.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return true;
    }
    return !LEAKED_CONTROL_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  });

  return filtered.join("\n").replace(/\n{2,}/g, "\n").trim();
};

export const extractDelegatedRoles = (text: string, leadRole: Role): DelegationExtractionResult => {
  const match = text.match(DELEGATION_REGEX);
  if (!match) {
    return { roles: [leadRole], text, delegatedRoles: [] };
  }

  const cleanedText = text.replace(DELEGATION_REMOVAL_REGEX, " ").replace(/\s+\n/g, "\n").trim();

  const delegated = match[1]
    .split(",")
    .map((role) => normalizeRole(role.trim()))
    .filter((role): role is Role => role !== null && role !== leadRole);

  const unique: Role[] = [];
  for (const role of delegated) {
    if (!unique.includes(role)) {
      unique.push(role);
    }
  }

  const capped = unique.slice(0, 3);
  return {
    roles: [leadRole, ...capped],
    text: cleanedText || text,
    delegatedBy: capped.length > 0 ? leadRole : undefined,
    delegatedRoles: capped,
    delegationSource: capped.length > 0 ? "agent-delegated" : undefined
  };
};

const formatProvenanceRoles = (roles: readonly Role[] | undefined, fallback = "none") => {
  if (!roles || roles.length === 0) {
    return fallback;
  }

  return roles.join(", ");
};

export const normalizeThreadOutput = (text: string, roles: Role[], targets: Record<Role, number>): string => {
  if (roles.length <= 1) {
    return text;
  }

  const active = new Set(roles);
  const matched: Array<{ role: Role; message: string }> = [];

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const match = line.match(/^(?:\[\d+\]\s*)?([A-Z]+):\s*(.+)$/);
    if (!match) {
      continue;
    }

    const normalized = normalizeRole(match[1]);
    if (!normalized || !active.has(normalized)) {
      continue;
    }

    const message = match[2].trim();
    if (!message) {
      continue;
    }

    matched.push({ role: normalized, message });
  }

  if (matched.length === 0) {
    return text;
  }

  const counts: Record<Role, number> = {
    CTO: 0,
    DEV: 0,
    FE: 0,
    BE: 0,
    UX: 0,
    PO: 0,
    PM: 0,
    CEO: 0,
    MARKETING: 0,
    RESEARCH: 0
  };

  const selected: Array<{ role: Role; message: string }> = [];
  for (const line of matched) {
    const quota = targets[line.role] ?? 0;
    if (quota <= 0) {
      continue;
    }
    if (counts[line.role] >= quota) {
      continue;
    }

    selected.push(line);
    counts[line.role] += 1;
  }

  if (selected.length === 0) {
    return text;
  }

  const lead = roles[0];
  const firstLeadIndex = selected.findIndex((line) => line.role === lead);
  if (firstLeadIndex > 0) {
    const [leadLine] = selected.splice(firstLeadIndex, 1);
    selected.unshift(leadLine);
  }

  const lastLeadIndex = (() => {
    for (let i = selected.length - 1; i >= 0; i -= 1) {
      if (selected[i].role === lead) {
        return i;
      }
    }
    return -1;
  })();

  if (lastLeadIndex >= 0 && lastLeadIndex < selected.length - 1) {
    const [leadLine] = selected.splice(lastLeadIndex, 1);
    selected.push(leadLine);
  }

  const numbered = selected.map((item, index) => `[${index + 1}] ${item.role}: ${item.message}`);
  return numbered.join("\n\n");
};

export const appendMcpSuggestion = (text: string, leadRole: Role, numbered: boolean): string => {
  if (/\/mcp\b/i.test(text)) {
    return text;
  }

  if (!numbered) {
    return `${text}\n\nIf confidence is low or the data may be stale, we can pull live context with \`/mcp\` before finalizing.`;
  }

  let maxTurn = 0;
  for (const match of text.matchAll(/\[(\d+)\]\s+[A-Z]+:/g)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > maxTurn) {
      maxTurn = parsed;
    }
  }

  const nextTurn = maxTurn > 0 ? maxTurn + 1 : 1;
  const line = `[${nextTurn}] ${leadRole}: If confidence is low or the data may be stale, we can pull live context with \`/mcp\` before finalizing.`;
  return `${text}\n\n${line}`;
};

export const appendMissingProviderNotice = (
  text: string,
  leadRole: Role,
  numbered: boolean,
  missingProviders: string[]
): string => {
  if (missingProviders.length === 0) {
    return text;
  }

  const notice = formatSupervisorReason(
    createSupervisorReasonDetail("blocked.missing-mcp-provider", { missingProviders })
  );

  if (!numbered) {
    return `${text}\n\n${notice}`;
  }

  let maxTurn = 0;
  for (const match of text.matchAll(/\[(\d+)\]\s+[A-Z]+:/g)) {
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > maxTurn) {
      maxTurn = parsed;
    }
  }

  const nextTurn = maxTurn > 0 ? maxTurn + 1 : 1;
  return `${text}\n\n[${nextTurn}] ${leadRole}: ${notice}`;
};

export const appendMcpWarnings = (text: string, warnings: string[]): string => {
  if (warnings.length === 0) {
    return text;
  }

  const warningBlock = warnings
    .map((warning) => formatSupervisorReason(createSupervisorReasonDetail("blocked.mcp-access", { actionReason: warning }), "[MCP]"))
    .join("\n");
  return `${text}\n\n---\n${warningBlock}`;
};

export const applyBudgetAction = (
  text: string,
  action: "compact" | "truncate" | "halt",
  reason: string,
  tokenLimit: number
): string => {
  if (action === "halt") {
    const detail = createSupervisorReasonDetail("budget.output-halt", { actionReason: reason });
    return `${formatSupervisorReason(detail)} Retry with fewer roles, a narrower scope, or a deeper-investigation instruction with explicit budget override.`;
  }

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return text;
  }

  if (action === "compact") {
    const compacted = lines.slice(0, 8).join("\n");
    return `${compacted}\n\n${formatSupervisorReason(createSupervisorReasonDetail("budget.output-compact", { actionReason: reason }))}`;
  }

  const maxChars = Math.max(40, tokenLimit * 4);
  if (text.length <= maxChars) {
    return `${text}\n\n${formatSupervisorReason(createSupervisorReasonDetail("budget.output-truncate", { actionReason: reason }))}`;
  }

  const truncated = `${text.slice(0, maxChars).trimEnd()}...`;
  return `${truncated}\n\n${formatSupervisorReason(createSupervisorReasonDetail("budget.output-truncate", { actionReason: reason }))}`;
};

const rewriteOrchestratorNarration = (
  text: string,
  delegatedBy: Role,
  delegatedRoles: readonly Role[]
): string => {
  const lines = text.split("\n");
  const rewritten: string[] = [];
  let injectedLaunchLine = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      !trimmed ||
      /^\[?\d+\]?\s*[A-Z]+:/.test(trimmed) ||
      /^Task\s+[A-Z]:/i.test(trimmed) ||
      /^Task\s+[A-Z]+\s/i.test(trimmed)
    ) {
      rewritten.push(line);
      continue;
    }
    if (!injectedLaunchLine) {
      rewritten.push(`[Supervisor] delegation.launch: delegated launch by ${delegatedBy}: ${delegatedRoles.join(", ")}.`);
      injectedLaunchLine = true;
    }
  }

  return rewritten.join("\n");
};

export const appendSupervisorDecisionNotes = (
  text: string,
  roles: Role[],
  targets: Record<Role, number>,
  route: "multi-role-thread" | "delegated-thread",
  provenance: SupervisorDecisionProvenance = {}
): string => {
  if (roles.length <= 1) {
    return text;
  }

  const processedText = (route === "delegated-thread" && provenance.delegatedBy && provenance.delegatedRoles?.length)
    ? rewriteOrchestratorNarration(text, provenance.delegatedBy, provenance.delegatedRoles)
    : text;

  const routeCode = route === "delegated-thread" ? "route.delegated-thread" : "route.multi-role-thread";
  const routeLine = formatSupervisorReason(createSupervisorReasonDetail(routeCode, { roles }));
  const assignmentLine = formatSupervisorReason(createSupervisorReasonDetail("assignment.weighted-turns", {
    leadRole: roles[0],
    roles,
    targets
  }));

  const provenanceLines: string[] = [];
  if (provenance.requestedByUser && provenance.requestedByUser.length > 0) {
    provenanceLines.push(
      `[Supervisor] provenance.requested-by-user: requested by user: ${formatProvenanceRoles(provenance.requestedByUser)}.`
    );
  }

  if (provenance.delegatedBy && provenance.delegatedRoles && provenance.delegatedRoles.length > 0) {
    const effectiveWaves = provenance.waves && provenance.waves.length > 0
      ? provenance.waves
      : [{ wave: 1, roles: [...provenance.delegatedRoles] as Role[], goal: "", dependsOn: [] as number[] }];

    for (const wave of effectiveWaves) {
      const waveRoles = wave.roles.length > 0 ? wave.roles.join(", ") : formatProvenanceRoles(provenance.delegatedRoles);
      provenanceLines.push(
        `[Supervisor] provenance.delegated-wave: delegated wave ${wave.wave} by ${provenance.delegatedBy}: ${waveRoles}.`
      );
    }
  }

  if (provenance.addedByOrchestrator && provenance.addedByOrchestrator.length > 0) {
    provenanceLines.push(
      `[Supervisor] provenance.orchestrator-additions: added by orchestrator: ${formatProvenanceRoles(provenance.addedByOrchestrator)}.`
    );
  }

  if (provenance.maxParallelAgents !== undefined && provenance.maxParallelAgents > 0) {
    provenanceLines.push(
      `[Supervisor] provenance.max-parallel: max parallel agents: ${provenance.maxParallelAgents}.`
    );
  }

  return `${processedText}\n\n---\n${routeLine}\n${assignmentLine}${provenanceLines.length > 0 ? `\n${provenanceLines.join("\n")}` : ""}`;
};
