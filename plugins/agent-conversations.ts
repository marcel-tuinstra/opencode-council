import type { Plugin } from "@opencode-ai/plugin";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// =============================================================================
// Configuration Constants
// =============================================================================

/**
 * MCP call limits per turn.
 * - default: standard limit when no deep investigation is requested
 * - deep: expanded limit when user requests thorough/comprehensive analysis
 */
const MCP_CAPS = {
  default: 2,
  deep: 6
} as const;

/**
 * Turn counts by number of active roles and intent type.
 * Format: { [roleCount]: turnCount } or { [intent]: { [roleCount]: turnCount } }
 */
const TURN_COUNTS = {
  default: { 2: 8, 3: 10, 4: 12, 5: 12, max: 14 },
  backend: { 2: 8, 3: 10, 4: 10, max: 12 },
  marketing: { 2: 10, 3: 10, max: 12 }
} as const;

// =============================================================================
// Types
// =============================================================================

const SUPPORTED_ROLES = [
  "CTO",
  "DEV",
  "PO",
  "PM",
  "CEO",
  "MARKETING",
  "RESEARCH"
] as const;

type Role = (typeof SUPPORTED_ROLES)[number];
type Intent = "backend" | "design" | "marketing" | "roadmap" | "research" | "mixed";

type McpProviderConfig = {
  key: string;
  regex: RegExp;
  hint: string;
  toolPrefix: string;
};

type SessionPolicy = {
  roles: Role[];
  targets: Record<Role, number>;
  intent: Intent;
  mcpProviders: string[];
  mcpHints: string[];
  staleSensitive: boolean;
  allowDeepMcp: boolean;
  mcpCallCount: number;
  mcpTouched: Record<string, number>;
  mcpWarnings: string[];
};

type McpBlockResult = {
  blocked: boolean;
  warning?: string;
};

// =============================================================================
// Built-in Provider Patterns (fallback when not auto-detected)
// =============================================================================

const BUILTIN_PROVIDER_PATTERNS: McpProviderConfig[] = [
  {
    key: "sentry",
    regex: /\b(sentry|sentry\.io)\b/i,
    hint: "Sentry MCP (issues, traces, releases)",
    toolPrefix: "sentry_"
  },
  {
    key: "github",
    regex: /\b(github|github\.com)\b/i,
    hint: "GitHub MCP (PRs, commits, code context)",
    toolPrefix: "github_"
  },
  {
    key: "shortcut",
    regex: /\b(shortcut)\b/i,
    hint: "Shortcut MCP (stories, epics, milestones)",
    toolPrefix: "shortcut_"
  },
  {
    key: "nuxt",
    regex: /\b(nuxt|nuxt\s*ui|ui\.nuxt\.com)\b/i,
    hint: "Nuxt UI MCP (components, docs, examples)",
    toolPrefix: "nuxt-ui_"
  },
  {
    key: "jira",
    regex: /\b(jira|atlassian)\b/i,
    hint: "Jira MCP (issues, boards, sprints)",
    toolPrefix: "jira_"
  },
  {
    key: "confluence",
    regex: /\b(confluence|wiki)\b/i,
    hint: "Confluence MCP (pages, spaces, search)",
    toolPrefix: "confluence_"
  },
  {
    key: "linear",
    regex: /\b(linear)\b/i,
    hint: "Linear MCP (issues, projects, cycles)",
    toolPrefix: "linear_"
  },
  {
    key: "notion",
    regex: /\b(notion)\b/i,
    hint: "Notion MCP (pages, databases)",
    toolPrefix: "notion_"
  },
  {
    key: "slack",
    regex: /\b(slack)\b/i,
    hint: "Slack MCP (messages, channels)",
    toolPrefix: "slack_"
  },
  {
    key: "datadog",
    regex: /\b(datadog)\b/i,
    hint: "Datadog MCP (metrics, monitors, logs)",
    toolPrefix: "datadog_"
  }
];

// =============================================================================
// Runtime State
// =============================================================================

let installedProviders: string[] | null = null;
let mcpProviderPatterns: McpProviderConfig[] = [];

const sessionPolicy = new Map<string, SessionPolicy>();
const systemInjectedForSession = new Set<string>();

// =============================================================================
// Constants and Regexes
// =============================================================================

const ROLE_ALIASES: Record<string, Role> = {
  cto: "CTO",
  dev: "DEV",
  developer: "DEV",
  po: "PO",
  pm: "PM",
  ceo: "CEO",
  marketing: "MARKETING",
  research: "RESEARCH"
};

const MENTION_REGEX = /@([A-Za-z][A-Za-z0-9_-]*)/g;
const MARKER_REGEX = /<<AGENT_CONVERSATIONS:([^>]+)>>/;
const MARKER_REMOVAL_REGEX = /\n*<<AGENT_CONVERSATIONS:[^>]+>>/g;
const MARKER_PREFIX = "<<AGENT_CONVERSATIONS:";
const MARKER_SUFFIX = ">>";

const DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(process.env.AGENT_CONVERSATIONS_DEBUG ?? "");

const STALE_SENSITIVE_REGEX =
  /\b(current|latest|today|this week|this month|recent|live|regression|incident|status|right now|fresh|up-to-date)\b/i;

const DEEP_MCP_REGEX =
  /\b(deeper|deep dive|thorough|comprehensive|full investigation|as needed|as much as needed|exhaustive)\b/i;

const INTENT_KEYWORDS: Record<Intent, RegExp[]> = {
  backend: [
    /api|latency|database|db|cache|query|service|backend|throughput|p95|p99|infra|performance/i,
    /timeout|retry|index|n\+1|scaling|server|endpoint|queue/i
  ],
  design: [
    /design|ux|ui|prototype|wireframe|usability|interaction|layout|visual|figma/i,
    /experience|journey|information architecture|a11y|accessibility/i
  ],
  marketing: [
    /marketing|positioning|messaging|campaign|launch|brand|audience|copy|narrative/i,
    /go-to-market|gtm|webinar|case study|ad|funnel|conversion/i
  ],
  roadmap: [
    /roadmap|milestone|quarter|timeline|deadline|planning|refinement|delivery|scope/i,
    /prioritization|dependency|release|backlog|estimate|resourcing/i
  ],
  research: [
    /research|interview|evidence|hypothesis|experiment|validate|confidence|survey/i,
    /competitive|benchmark|discovery|analysis|findings|insight/i
  ],
  mixed: []
};

const INTENT_ROLE_WEIGHTS: Record<Intent, Record<Role, number>> = {
  backend: {
    CTO: 5,
    DEV: 5,
    PM: 2,
    PO: 2,
    CEO: 1,
    MARKETING: 0,
    RESEARCH: 1
  },
  design: {
    CTO: 2,
    DEV: 2,
    PM: 4,
    PO: 4,
    CEO: 1,
    MARKETING: 3,
    RESEARCH: 3
  },
  marketing: {
    CTO: 1,
    DEV: 1,
    PM: 2,
    PO: 2,
    CEO: 4,
    MARKETING: 5,
    RESEARCH: 2
  },
  roadmap: {
    CTO: 3,
    DEV: 2,
    PM: 5,
    PO: 5,
    CEO: 4,
    MARKETING: 2,
    RESEARCH: 2
  },
  research: {
    CTO: 3,
    DEV: 3,
    PM: 2,
    PO: 2,
    CEO: 1,
    MARKETING: 1,
    RESEARCH: 5
  },
  mixed: {
    CTO: 2,
    DEV: 2,
    PM: 2,
    PO: 2,
    CEO: 2,
    MARKETING: 2,
    RESEARCH: 2
  }
};

// =============================================================================
// Debug Logging
// =============================================================================

const previewText = (text: string, max = 80) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
};

const debugLog = (event: string, details?: Record<string, unknown>) => {
  if (!DEBUG_ENABLED) {
    return;
  }

  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[agent-conversations] ${event}${payload}`);
};

// =============================================================================
// Runtime MCP Provider Detection
// =============================================================================

/**
 * Reads OpenCode config and returns installed MCP provider keys.
 * Falls back to empty array if config cannot be read.
 */
const loadInstalledProviders = async (): Promise<string[]> => {
  try {
    const configPath = join(homedir(), ".config", "opencode", "config.json");
    const content = await readFile(configPath, "utf-8");
    const config = JSON.parse(content);
    const mcpKeys = Object.keys(config.mcp ?? {});
    debugLog("providers.loaded", { providers: mcpKeys, source: configPath });
    return mcpKeys;
  } catch (error) {
    debugLog("providers.load_failed", { error: String(error) });
    return [];
  }
};

/**
 * Initializes MCP provider patterns based on installed providers.
 * Combines runtime detection with built-in patterns.
 */
const initializeProviderPatterns = async (): Promise<void> => {
  if (installedProviders !== null) {
    return; // Already initialized
  }

  installedProviders = await loadInstalledProviders();

  // Start with patterns for installed providers that have built-in configs
  const patterns: McpProviderConfig[] = [];
  const seen = new Set<string>();

  for (const providerKey of installedProviders) {
    const builtin = BUILTIN_PROVIDER_PATTERNS.find((p) => p.key === providerKey);
    if (builtin) {
      patterns.push(builtin);
      seen.add(providerKey);
    } else {
      // Create a dynamic pattern for unknown providers
      patterns.push({
        key: providerKey,
        regex: new RegExp(`\\b(${providerKey})\\b`, "i"),
        hint: `${providerKey} MCP`,
        toolPrefix: `${providerKey}_`
      });
      seen.add(providerKey);
    }
  }

  // Add remaining built-in patterns that weren't installed (for forward compatibility)
  for (const builtin of BUILTIN_PROVIDER_PATTERNS) {
    if (!seen.has(builtin.key)) {
      patterns.push(builtin);
    }
  }

  mcpProviderPatterns = patterns;
  debugLog("providers.patterns_initialized", {
    installed: installedProviders,
    totalPatterns: patterns.length
  });
};

/**
 * Checks if a provider is actually installed.
 */
const isProviderInstalled = (providerKey: string): boolean => {
  return installedProviders?.includes(providerKey) ?? false;
};

// =============================================================================
// Role Detection
// =============================================================================

const isSupportedRole = (role: string): role is Role => {
  return SUPPORTED_ROLES.includes(role as Role);
};

const replaceWithSpaces = (value: string) => " ".repeat(value.length);

const stripCodeSegments = (text: string) => {
  return text
    .replace(/```[\s\S]*?```/g, (segment) => replaceWithSpaces(segment))
    .replace(/`[^`]*`/g, (segment) => replaceWithSpaces(segment));
};

const normalizeRole = (raw: string): Role | null => {
  const lowered = raw.toLowerCase();
  if (ROLE_ALIASES[lowered]) {
    return ROLE_ALIASES[lowered];
  }

  const upper = raw.toUpperCase();
  return isSupportedRole(upper) ? upper : null;
};

const detectRolesFromMentions = (text: string): Role[] => {
  const sanitizedText = stripCodeSegments(text);
  const detected = new Set<Role>();

  for (const match of sanitizedText.matchAll(MENTION_REGEX)) {
    const fullMatch = match[0];
    const mentionStart = match.index ?? -1;
    const mentionEnd = mentionStart + fullMatch.length;
    const nextChar = mentionEnd >= 0 ? (sanitizedText[mentionEnd] ?? "") : "";
    const prevChar = mentionStart > 0 ? (sanitizedText[mentionStart - 1] ?? "") : "";

    if (prevChar && /[A-Za-z0-9_./\\-]/.test(prevChar)) {
      continue;
    }

    if (nextChar === "/" || nextChar === "." || nextChar === "\\") {
      continue;
    }

    const role = normalizeRole(match[1]);
    if (role) {
      detected.add(role);
    }
  }

  return Array.from(detected);
};

const parseRolesFromMarker = (text: string): Role[] | null => {
  const match = text.match(MARKER_REGEX);
  if (!match) {
    return null;
  }

  const roles = match[1]
    .split(",")
    .map((role) => role.trim())
    .map((role) => normalizeRole(role))
    .filter((role): role is Role => role !== null);

  return roles.length > 0 ? roles : null;
};

const detectRolesFromText = (text: string): Role[] | null => {
  const markerRoles = parseRolesFromMarker(text);
  if (markerRoles && markerRoles.length > 0) {
    return markerRoles;
  }

  const mentionRoles = detectRolesFromMentions(text);
  return mentionRoles.length > 0 ? mentionRoles : null;
};

// =============================================================================
// Intent Detection
// =============================================================================

const detectIntent = (text: string): Intent => {
  const scores: Record<Intent, number> = {
    backend: 0,
    design: 0,
    marketing: 0,
    roadmap: 0,
    research: 0,
    mixed: 0
  };

  for (const intent of Object.keys(INTENT_KEYWORDS) as Intent[]) {
    if (intent === "mixed") {
      continue;
    }
    for (const regex of INTENT_KEYWORDS[intent]) {
      if (regex.test(text)) {
        scores[intent] += 1;
      }
    }
  }

  let best: Intent = "mixed";
  let bestScore = 0;
  for (const intent of ["backend", "design", "marketing", "roadmap", "research"] as Intent[]) {
    if (scores[intent] > bestScore) {
      best = intent;
      bestScore = scores[intent];
    }
  }

  return bestScore > 0 ? best : "mixed";
};

// =============================================================================
// Turn Calculation
// =============================================================================

const getTotalTurns = (roles: Role[], intent: Intent): number => {
  if (roles.length <= 1) {
    return 0;
  }

  const roleCount = roles.length;
  const intentConfig = TURN_COUNTS[intent as keyof typeof TURN_COUNTS] ?? TURN_COUNTS.default;
  const defaultConfig = TURN_COUNTS.default;

  // Check intent-specific config first, then fall back to default
  if (roleCount in intentConfig) {
    return intentConfig[roleCount as keyof typeof intentConfig] as number;
  }
  if (roleCount in defaultConfig) {
    return defaultConfig[roleCount as keyof typeof defaultConfig] as number;
  }

  // Use max for large role counts
  return (intentConfig as { max?: number }).max ?? defaultConfig.max;
};

const buildTurnTargets = (roles: Role[], sourceText: string): Record<Role, number> => {
  const targets = {
    CTO: 0,
    DEV: 0,
    PO: 0,
    PM: 0,
    CEO: 0,
    MARKETING: 0,
    RESEARCH: 0
  } satisfies Record<Role, number>;

  if (roles.length <= 1) {
    return targets;
  }

  const intent = detectIntent(sourceText);
  const totalTurns = getTotalTurns(roles, intent);
  const weights = INTENT_ROLE_WEIGHTS[intent];
  const lead = roles[0];

  const mins = new Map<Role, number>();
  for (const role of roles) {
    const weight = weights[role];
    if (role === lead) {
      mins.set(role, 2);
      continue;
    }
    mins.set(role, weight > 0 ? 1 : 0);
  }

  let minSum = 0;
  for (const role of roles) {
    minSum += mins.get(role) ?? 0;
  }

  if (minSum > totalTurns) {
    for (let i = roles.length - 1; i >= 0 && minSum > totalTurns; i -= 1) {
      const role = roles[i];
      if (role === lead) {
        continue;
      }
      const current = mins.get(role) ?? 0;
      if (current > 0) {
        mins.set(role, current - 1);
        minSum -= 1;
      }
    }
  }

  for (const role of roles) {
    targets[role] = mins.get(role) ?? 0;
  }

  const remaining = totalTurns - minSum;
  if (remaining <= 0) {
    return targets;
  }

  const effectiveWeights = new Map<Role, number>();
  let weightSum = 0;
  for (const role of roles) {
    const weight = Math.max(0, weights[role] + (role === lead ? 1 : 0));
    effectiveWeights.set(role, weight);
    weightSum += weight;
  }

  if (weightSum <= 0) {
    targets[lead] += remaining;
    return targets;
  }

  const fractions: Array<{ role: Role; fraction: number }> = [];
  let assigned = 0;
  for (const role of roles) {
    const exact = (remaining * (effectiveWeights.get(role) ?? 0)) / weightSum;
    const whole = Math.floor(exact);
    targets[role] += whole;
    assigned += whole;
    fractions.push({ role, fraction: exact - whole });
  }

  fractions.sort((a, b) => b.fraction - a.fraction);
  let extra = remaining - assigned;
  let index = 0;
  while (extra > 0 && fractions.length > 0) {
    const role = fractions[index % fractions.length].role;
    targets[role] += 1;
    extra -= 1;
    index += 1;
  }

  return targets;
};

// =============================================================================
// MCP Provider Detection
// =============================================================================

const detectMcpProviders = (text: string): string[] => {
  const providers: string[] = [];
  const seen = new Set<string>();

  for (const provider of mcpProviderPatterns) {
    if (provider.regex.test(text) && !seen.has(provider.key)) {
      providers.push(provider.key);
      seen.add(provider.key);
    }
  }

  return providers;
};

const buildMcpHints = (providers: string[]): string[] => {
  return mcpProviderPatterns
    .filter((provider) => providers.includes(provider.key))
    .map((provider) => provider.hint);
};

const providerFromToolName = (tool: string): string | null => {
  for (const provider of mcpProviderPatterns) {
    if (tool.startsWith(provider.toolPrefix)) {
      return provider.key;
    }
  }
  return null;
};

const getMissingProviders = (policy: SessionPolicy): string[] => {
  return policy.mcpProviders.filter((provider) => !(policy.mcpTouched[provider] && policy.mcpTouched[provider] > 0));
};

// =============================================================================
// Graceful MCP Blocking
// =============================================================================

/**
 * Checks if an MCP call should be blocked, returning a warning instead of throwing.
 * Returns { blocked: false } if the call is allowed.
 * Returns { blocked: true, warning: "..." } if blocked.
 */
const checkMcpAccess = (tool: string, policy: SessionPolicy): McpBlockResult => {
  const provider = providerFromToolName(tool);

  if (!provider) {
    return { blocked: false };
  }

  // Check if provider is installed
  if (!isProviderInstalled(provider)) {
    return {
      blocked: true,
      warning: `MCP provider '${provider}' is not installed. Install it in ~/.config/opencode/config.json to use.`
    };
  }

  // Check if no providers were mentioned
  if (policy.mcpProviders.length === 0) {
    return {
      blocked: true,
      warning: `MCP blocked: no provider explicitly mentioned in prompt. Mention '${provider}' to enable.`
    };
  }

  // Check if this specific provider was mentioned
  if (!policy.mcpProviders.includes(provider)) {
    return {
      blocked: true,
      warning: `MCP provider '${provider}' not mentioned in prompt. Only these are allowed: ${policy.mcpProviders.join(", ")}.`
    };
  }

  // Check multi-provider fairness rule
  if (policy.mcpProviders.length > 1) {
    const missing = getMissingProviders(policy);
    if (missing.length > 0 && !missing.includes(provider)) {
      return {
        blocked: true,
        warning: `MCP provider '${provider}' temporarily blocked. Check these first: ${missing.join(", ")}.`
      };
    }
  }

  // Check call limit
  const cap = policy.allowDeepMcp ? MCP_CAPS.deep : MCP_CAPS.default;
  if (policy.mcpCallCount >= cap) {
    return {
      blocked: true,
      warning: `MCP call limit (${cap}) reached. Ask for "deeper investigation" to increase limit.`
    };
  }

  return { blocked: false };
};

// =============================================================================
// System Prompt Building (Simplified)
// =============================================================================

const buildSystemInstruction = (
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

const enforceUserContract = (
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

// =============================================================================
// Output Normalization
// =============================================================================

const normalizeThreadOutput = (text: string, roles: Role[], targets: Record<Role, number>): string => {
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

const appendMcpSuggestion = (text: string, leadRole: Role, numbered: boolean): string => {
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

const appendMissingProviderNotice = (
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

const appendMcpWarnings = (text: string, warnings: string[]): string => {
  if (warnings.length === 0) {
    return text;
  }

  const warningBlock = warnings.map((w) => `[MCP] ${w}`).join("\n");
  return `${text}\n\n---\n${warningBlock}`;
};

// =============================================================================
// Plugin Export
// =============================================================================

export const AgentConversations: Plugin = async () => {
  // Initialize provider patterns on plugin load
  await initializeProviderPatterns();

  return {
    "tui.prompt.append": async ({ input }) => {
      const roles = detectRolesFromMentions(input);
      if (roles.length === 0) {
        debugLog("tui.prompt.append.no_roles", {
          preview: previewText(input)
        });
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
        sessionPolicy.delete(message.info.sessionID);
        systemInjectedForSession.delete(message.info.sessionID);
        debugLog("messages.transform.policy_cleared", {
          sessionID: message.info.sessionID,
          reason: "no_roles_detected"
        });
        return;
      }

      const intent = detectIntent(sourceText);
      const targets = buildTurnTargets(roles, sourceText);
      const mcpProviders = detectMcpProviders(sourceText);
      const mcpHints = buildMcpHints(mcpProviders);
      const staleSensitive = STALE_SENSITIVE_REGEX.test(sourceText);
      const allowDeepMcp = DEEP_MCP_REGEX.test(sourceText);

      for (const part of message.parts) {
        if (part.type === "text") {
          part.text = enforceUserContract(part.text, roles, targets, mcpProviders, staleSensitive);
        }
      }

      sessionPolicy.set(message.info.sessionID, {
        roles,
        targets,
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
        debugLog("system.transform.no_roles", {
          sessionID: input.sessionID
        });
        return;
      }

      const targets = policy?.targets ?? buildTurnTargets(roles, "");
      const mcpProviders = policy?.mcpProviders ?? [];
      const staleSensitive = policy?.staleSensitive ?? false;

      output.system.push(buildSystemInstruction(roles, targets, mcpProviders, staleSensitive));
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
        // Graceful handling: collect warning instead of throwing
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

        // Still throw to prevent the call, but with a cleaner message
        throw new Error(result.warning ?? "MCP call blocked.");
      }

      // Allow the call
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
        debugLog("text.complete.skip_no_policy", {
          sessionID: input.sessionID
        });
        return;
      }

      let nextText = output.text;

      if (policy.roles.length > 1) {
        nextText = normalizeThreadOutput(nextText, policy.roles, policy.targets);
      }

      if (policy.mcpProviders.length > 1) {
        const missingProviders = getMissingProviders(policy);
        if (missingProviders.length > 0) {
          nextText = appendMissingProviderNotice(nextText, policy.roles[0], policy.roles.length > 1, missingProviders);
        }
      }

      const shouldSuggestMcp = policy.staleSensitive && policy.mcpProviders.length === 0;
      if (shouldSuggestMcp) {
        nextText = appendMcpSuggestion(nextText, policy.roles[0], policy.roles.length > 1);
      }

      // Append any MCP warnings that were collected
      nextText = appendMcpWarnings(nextText, policy.mcpWarnings);

      output.text = nextText;

      debugLog("text.complete.processed", {
        sessionID: input.sessionID,
        roles: policy.roles,
        mcpProviders: policy.mcpProviders,
        staleSensitive: policy.staleSensitive,
        hadThreadNormalization: policy.roles.length > 1,
        mcpWarningsCount: policy.mcpWarnings.length
      });
    }
  };
};
