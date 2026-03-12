import type { Role } from "./types";
import { normalizeRole } from "./roles";

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
  "No markdown. Plain lines only."
];

export const stripControlLeakage = (text: string): string => {
  const withoutReminders = text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
    .replace(/Format:\s*\[n\]\s*ROLE:\s*message\s*\|\s*Start with[^\n]*(?:\n(?:Heartbeat:.*|MCP:.*|Suggest \/mcp.*|No markdown\..*))*/gi, "")
    .replace(/Format:\s*plain prose, no role prefix, no markdown\.(?:\n(?:Delegation .*|MCP:.*|Include concrete recommendations\.|No markdown\..*))*/gi, "")
    .replace(/Use the above message and context to generate a prompt and call the task tool with subagent:\s*[a-z]+/gi, "");
  const lines = withoutReminders.split("\n");
  const filtered = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return true;
    }
    return !LEAKED_CONTROL_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
  });

  return filtered.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

export const extractDelegatedRoles = (text: string, leadRole: Role): { roles: Role[]; text: string } => {
  const match = text.match(DELEGATION_REGEX);
  if (!match) {
    return { roles: [leadRole], text };
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
    text: cleanedText || text
  };
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

  const missingList = missingProviders.join(", ");
  const notice = `Need at least one MCP check for: ${missingList} before final recommendation.`;

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

  const warningBlock = warnings.map((warning) => `[MCP] ${warning}`).join("\n");
  return `${text}\n\n---\n${warningBlock}`;
};

export const applyBudgetAction = (
  text: string,
  action: "compact" | "truncate" | "halt",
  reason: string,
  tokenLimit: number
): string => {
  if (action === "halt") {
    return `Output paused by orchestration budget governor: ${reason}. Retry with fewer roles, a narrower scope, or a deeper-investigation instruction with explicit budget override.`;
  }

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return text;
  }

  if (action === "compact") {
    const compacted = lines.slice(0, 8).join("\n");
    return `${compacted}\n\n[Budget] Compact mode enabled: ${reason}. Kept the highest-signal lines to stay within budget.`;
  }

  const maxChars = Math.max(40, tokenLimit * 4);
  if (text.length <= maxChars) {
    return `${text}\n\n[Budget] Truncation threshold reached: ${reason}.`;
  }

  const truncated = `${text.slice(0, maxChars).trimEnd()}...`;
  return `${truncated}\n\n[Budget] Output truncated: ${reason}.`;
};
