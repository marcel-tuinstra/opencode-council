import type { Role } from "./types";
import { normalizeRole } from "./roles";

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
