import { MCP_CAPS } from "./constants";
import type { Role } from "./types";

export const buildSystemInstruction = (
  roles: Role[],
  targets: Record<Role, number>,
  mcpProviders: string[],
  staleSensitive: boolean
): string => {
  if (roles.length === 1) {
    const role = roles[0];
    const mcpNote = mcpProviders.length > 0
      ? `MCP allowed for: ${mcpProviders.join(", ")}.`
      : "MCP disabled (no provider mentioned).";

    return [
      `You are the ${role} persona.`,
      "Provide a complete, actionable response with tradeoffs and rationale.",
      mcpNote,
      staleSensitive ? "Data may be stale; suggest /mcp if confidence is low." : "",
      "Do not prefix response with role label."
    ].filter(Boolean).join("\n");
  }

  const leadRole = roles[0];
  const totalTurns = roles.reduce((sum, role) => sum + (targets[role] ?? 0), 0);
  const turnPlan = roles
    .filter((role) => targets[role] > 0)
    .map((role) => `${role}:${targets[role]}`)
    .join(" ");

  const mcpNote = mcpProviders.length > 0
    ? `MCP allowed for: ${mcpProviders.join(", ")}. Max ${MCP_CAPS.default} calls.`
    : "MCP disabled (no provider mentioned).";

  return [
    `Multi-agent discussion: ${roles.map((r) => `@${r}`).join(", ")}`,
    "",
    "Format: [n] ROLE: message (1-3 sentences per turn)",
    `Plan: ~${totalTurns} turns, weighted: ${turnPlan}`,
    `Lead (${leadRole}): opens and closes with recommendation`,
    "",
    mcpNote,
    staleSensitive ? "Data may be stale; one agent may suggest /mcp if needed." : "",
    "",
    "No markdown, no bullets, no narrator. Plain chat lines only."
  ].filter(Boolean).join("\n");
};

const buildUserEnforcement = (
  roles: Role[],
  targets: Record<Role, number>,
  mcpProviders: string[],
  staleSensitive: boolean
): string => {
  if (roles.length === 1) {
    return [
      "",
      "",
      "Format: plain prose, no role prefix, no markdown.",
      mcpProviders.length > 0 ? `MCP: ${mcpProviders.join(", ")} only.` : "MCP: disabled.",
      "Include concrete recommendations."
    ].join("\n");
  }

  const leadRole = roles[0];
  const turnPlan = roles
    .filter((role) => targets[role] > 0)
    .map((role) => `${role}:${targets[role]}`)
    .join(" ");

  return [
    "",
    "",
    `Format: [n] ROLE: message | Start with ${leadRole}: | Plan: ${turnPlan}`,
    mcpProviders.length > 0 ? `MCP: ${mcpProviders.join(", ")} only, max ${MCP_CAPS.default} calls.` : "MCP: disabled.",
    staleSensitive ? "Suggest /mcp if data may be stale." : "",
    "No markdown. Plain lines only."
  ].filter(Boolean).join("\n");
};

export const enforceUserContract = (
  text: string,
  roles: Role[],
  targets: Record<Role, number>,
  mcpProviders: string[],
  staleSensitive: boolean
): string => {
  if (text.includes("Format:")) {
    return text;
  }

  return `${text}${buildUserEnforcement(roles, targets, mcpProviders, staleSensitive)}`;
};
