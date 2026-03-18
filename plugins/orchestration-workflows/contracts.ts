import { getSupervisorPolicy } from "./supervisor-config";
import type { DelegationPlan, Role } from "./types";

export const buildSystemInstruction = (
  roles: Role[],
  targets: Record<Role, number>,
  heartbeat: boolean,
  mcpProviders: string[],
  staleSensitive: boolean,
  delegationPlan: DelegationPlan | null = null
): string => {
  if (roles.length === 1) {
    const role = roles[0];
    const mcpNote = mcpProviders.length > 0
      ? `MCP allowed for: ${mcpProviders.join(", ")}.`
      : "MCP disabled (no provider mentioned).";

    const base = [
      `You are the ${role} persona.`,
      "Provide a complete, actionable response with tradeoffs and rationale.",
      "If confidence is low or cross-functional input is needed, emit one delegation marker line: <<DELEGATE:ROLE1,ROLE2>> (supported roles only).",
      "If delegating, continue immediately with a threaded discussion using format [n] ROLE: message, and close with your own role.",
      mcpNote,
      staleSensitive ? "Data may be stale; suggest /mcp if confidence is low." : "",
      "Do not prefix response with role label unless you are delegating into threaded mode."
    ].filter(Boolean).join("\n");

    if (delegationPlan) {
      return [
        base,
        `You are the delegation lead (${delegationPlan.leadRole}). You may delegate work to: ${delegationPlan.provenance.delegatedRoles.join(", ")}.`,
        "Emit <<DELEGATE:ROLE1,ROLE2>> when ready to fan out.",
        `Max parallel agents per wave: ${delegationPlan.maxParallelAgents}.`
      ].join("\n");
    }

    return base;
  }

  const leadRole = roles[0];
  const totalTurns = roles.reduce((sum, role) => sum + (targets[role] ?? 0), 0);
  const turnPlan = roles
    .filter((role) => targets[role] > 0)
    .map((role) => `${role}:${targets[role]}`)
    .join(" ");

  const mcpNote = mcpProviders.length > 0
    ? `MCP allowed for: ${mcpProviders.join(", ")}. Max ${getSupervisorPolicy().limits.mcp.defaultCallCap} calls.`
    : "MCP disabled (no provider mentioned).";

  const phasePlan = heartbeat
    ? [
      "Heartbeat phases:",
      "Phase 1 (Frame): each role gives initial stance, main concern, and missing info.",
      "Phase 2 (Challenge): each role reacts to at least one other role.",
      "Phase 3 (Synthesize): lead role closes with recommendation."
    ]
    : [];

  return [
    `Multi-agent discussion: ${roles.map((r) => `@${r}`).join(", ")}`,
    "",
    "Format: [n] ROLE: message (1-3 sentences per turn)",
    `Plan: ~${totalTurns} turns, weighted: ${turnPlan}`,
    `Lead (${leadRole}): opens and closes with recommendation`,
    "",
    ...phasePlan,
    mcpNote,
    staleSensitive ? "Data may be stale; one agent may suggest /mcp if needed." : "",
    "",
    "No markdown, no bullets, no narrator. Plain chat lines only."
  ].filter(Boolean).join("\n");
};

const buildUserEnforcement = (
  roles: Role[],
  targets: Record<Role, number>,
  heartbeat: boolean,
  mcpProviders: string[],
  staleSensitive: boolean
): string => {
  if (roles.length === 1) {
    return [
      "",
      "",
      "Format: plain prose, no role prefix, no markdown.",
      "Delegation (optional): if needed, emit <<DELEGATE:ROLE1,ROLE2>> then switch to [n] ROLE: message lines.",
      mcpProviders.length > 0 ? `MCP: ${mcpProviders.join(", ")} only.` : "MCP: disabled.",
      "Include concrete recommendations."
    ].join("\n");
  }

  const leadRole = roles[0];
  const turnPlan = roles
    .filter((role) => targets[role] > 0)
    .map((role) => `${role}:${targets[role]}`)
    .join(" ");

  const heartbeatNote = heartbeat
    ? "Heartbeat: Phase 1 Frame, Phase 2 Challenge (react to another role), Phase 3 Synthesize by lead."
    : "";

  return [
    "",
    "",
    `Format: [n] ROLE: message | Start with ${leadRole}: | Plan: ${turnPlan}`,
    heartbeatNote,
    mcpProviders.length > 0 ? `MCP: ${mcpProviders.join(", ")} only, max ${getSupervisorPolicy().limits.mcp.defaultCallCap} calls.` : "MCP: disabled.",
    staleSensitive ? "Suggest /mcp if data may be stale." : "",
    "No markdown. Plain lines only."
  ].filter(Boolean).join("\n");
};

export const enforceUserContract = (
  text: string,
  roles: Role[],
  targets: Record<Role, number>,
  heartbeat: boolean,
  mcpProviders: string[],
  staleSensitive: boolean
): string => {
  if (roles.length === 1) {
    return text;
  }

  if (
    text.includes("Format:")
    || text.includes("Heartbeat:")
    || text.includes("MCP:")
    || text.includes("No markdown. Plain lines only.")
  ) {
    return text;
  }

  return `${text}${buildUserEnforcement(roles, targets, heartbeat, mcpProviders, staleSensitive)}`;
};
