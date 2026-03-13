import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { debugLog } from "./debug";
import type { Intent, Role } from "./types";

type RepoRiskTier = "small-high-risk" | "medium-moderate-risk" | "large-mature";
type MergeMode = "manual" | "auto-merge";

export type SupervisorProviderPatternInput = {
  key: string;
  pattern: string;
  hint: string;
  toolPrefix: string;
};

export type SupervisorProviderPattern = {
  key: string;
  regex: RegExp;
  hint: string;
  toolPrefix: string;
};

export type SupervisorExecutionPath = "execute" | "coordinate" | "investigate" | "safe-hold";

export type SupervisorRoutingIntentProfileInput = {
  path?: SupervisorExecutionPath;
  leadRole?: Role;
  fallbackLeadRole?: Role;
};

export type SupervisorRoutingIntentProfile = {
  path: SupervisorExecutionPath;
  leadRole: Role;
  fallbackLeadRole: Role;
};

export type SupervisorPolicyDiagnostics = {
  path: string;
  message: string;
};

export type SupervisorPolicyInput = {
  profile?: string;
  roleAliases?: Record<string, string>;
  providers?: {
    patterns?: SupervisorProviderPatternInput[];
  };
  limits?: {
    lanes?: {
      activeCapsByTier?: Partial<Record<RepoRiskTier, number>>;
      maxConcurrentCodeChanges?: number;
      maxOpenPullRequests?: number;
    };
    worktrees?: {
      maxActive?: number;
    };
    sessions?: {
      maxPerWorktree?: number;
    };
    mcp?: {
      defaultCallCap?: number;
      deepCallCap?: number;
    };
  };
  approvalGates?: {
    escalationMode?: "ask-first";
    mergeMode?: MergeMode;
    allowServiceCriticalAutoMerge?: boolean;
    boundaries?: {
      merge?: boolean;
      release?: boolean;
      destructive?: boolean;
      securitySensitive?: boolean;
      budgetExceptions?: boolean;
      automationWidening?: boolean;
    };
  };
  budget?: {
    runtime?: {
      softRunTokens?: number;
      hardRunTokens?: number;
      softStepTokens?: number;
      hardStepTokens?: number;
      truncateAtTokens?: number;
      costPer1kTokensUsd?: number;
      stepExecutionTokenCost?: number;
    };
    governance?: {
      warningThresholdPercents?: number[];
      escalationThresholdPercent?: number;
      hardStopEnabled?: boolean;
      hardStopThresholdPercent?: number;
    };
  };
  routing?: {
    minimumSignalScore?: number;
    intentProfiles?: Partial<Record<Intent, SupervisorRoutingIntentProfileInput>>;
  };
  compaction?: Partial<Record<Intent, {
    triggerTokens?: number;
    targetTokens?: number;
    retainRecentLines?: number;
  }>>;
};

export type ResolvedSupervisorPolicy = {
  profile: "v1-safe";
  roleAliases: Record<string, Role>;
  providers: {
    patterns: SupervisorProviderPattern[];
  };
  limits: {
    lanes: {
      activeCapsByTier: Record<RepoRiskTier, number>;
      maxConcurrentCodeChanges: number;
      maxOpenPullRequests: number;
    };
    worktrees: {
      maxActive: number;
    };
    sessions: {
      maxPerWorktree: number;
    };
    mcp: {
      defaultCallCap: number;
      deepCallCap: number;
    };
  };
  approvalGates: {
    escalationMode: "ask-first";
    mergeMode: MergeMode;
    allowServiceCriticalAutoMerge: boolean;
    boundaries: {
      merge: boolean;
      release: boolean;
      destructive: boolean;
      securitySensitive: boolean;
      budgetExceptions: boolean;
      automationWidening: boolean;
    };
  };
  budget: {
    runtime: {
      softRunTokens: number;
      hardRunTokens: number;
      softStepTokens: number;
      hardStepTokens: number;
      truncateAtTokens: number;
      costPer1kTokensUsd: number;
      stepExecutionTokenCost: number;
    };
    governance: {
      warningThresholdPercents: number[];
      escalationThresholdPercent: number;
      hardStopEnabled: boolean;
      hardStopThresholdPercent: number;
    };
  };
  routing: {
    minimumSignalScore: number;
    intentProfiles: Record<Intent, SupervisorRoutingIntentProfile>;
  };
  compaction: Record<Intent, {
    triggerTokens: number;
    targetTokens: number;
    retainRecentLines: number;
  }>;
};

export type SupervisorPolicyLoadResult = {
  config: ResolvedSupervisorPolicy;
  diagnostics: SupervisorPolicyDiagnostics[];
  source: string;
  valid: boolean;
};

const SUPPORTED_REPO_RISK_TIERS: RepoRiskTier[] = [
  "small-high-risk",
  "medium-moderate-risk",
  "large-mature"
];

const DEFAULT_PROVIDER_PATTERNS: SupervisorProviderPatternInput[] = [
  { key: "sentry", pattern: "\\b(sentry(?:\\.io)?|sentry\\s+mcp)\\b", hint: "Sentry MCP (issues, traces, releases)", toolPrefix: "sentry_" },
  { key: "github", pattern: "\\b(github(?:\\.com)?|gh|gh\\s+cli|github\\s+mcp)\\b", hint: "GitHub MCP (PRs, commits, code context)", toolPrefix: "github_" },
  { key: "shortcut", pattern: "\\b(shortcut(?:\\.com)?|clubhouse(?:\\.io)?|shortcut\\s+mcp)\\b", hint: "Shortcut MCP (stories, epics, milestones)", toolPrefix: "shortcut_" },
  { key: "nuxt", pattern: "\\b(nuxt(?:\\s*ui)?|nuxt-ui|ui\\.nuxt\\.com|nuxt\\s+ui\\s+mcp)\\b", hint: "Nuxt UI MCP (components, docs, examples)", toolPrefix: "nuxt-ui_" },
  { key: "jira", pattern: "\\b(jira|jira\\s+software|atlassian\\s+jira|jira\\s+mcp)\\b", hint: "Jira MCP (issues, boards, sprints)", toolPrefix: "jira_" },
  { key: "confluence", pattern: "\\b(confluence|atlassian\\s+wiki|confluence\\s+mcp)\\b", hint: "Confluence MCP (pages, spaces, search)", toolPrefix: "confluence_" },
  { key: "linear", pattern: "\\b(linear(?:\\.app)?|linear\\s+mcp)\\b", hint: "Linear MCP (issues, projects, cycles)", toolPrefix: "linear_" },
  { key: "notion", pattern: "\\b(notion(?:\\.so)?|notion\\s+mcp)\\b", hint: "Notion MCP (pages, databases)", toolPrefix: "notion_" },
  { key: "slack", pattern: "\\b(slack|slack\\s+mcp)\\b", hint: "Slack MCP (messages, channels)", toolPrefix: "slack_" },
  { key: "datadog", pattern: "\\b(datadog|ddog|datadog\\s+mcp)\\b", hint: "Datadog MCP (metrics, monitors, logs)", toolPrefix: "datadog_" }
];

const DEFAULT_POLICY_INPUT: SupervisorPolicyInput = {
  profile: "v1-safe",
  roleAliases: {
    cto: "CTO",
    dev: "DEV",
    developer: "DEV",
    po: "PO",
    pm: "PM",
    ceo: "CEO",
    marketing: "MARKETING",
    research: "RESEARCH"
  },
  providers: {
    patterns: DEFAULT_PROVIDER_PATTERNS
  },
  limits: {
    lanes: {
      activeCapsByTier: {
        "small-high-risk": 2,
        "medium-moderate-risk": 3,
        "large-mature": 4
      },
      maxConcurrentCodeChanges: 1,
      maxOpenPullRequests: 1
    },
    worktrees: {
      maxActive: 1
    },
    sessions: {
      maxPerWorktree: 1
    },
    mcp: {
      defaultCallCap: 2,
      deepCallCap: 6
    }
  },
  approvalGates: {
    escalationMode: "ask-first",
    mergeMode: "manual",
    allowServiceCriticalAutoMerge: false,
    boundaries: {
      merge: true,
      release: true,
      destructive: true,
      securitySensitive: true,
      budgetExceptions: true,
      automationWidening: true
    }
  },
  budget: {
    runtime: {
      softRunTokens: 6400,
      hardRunTokens: 8400,
      softStepTokens: 2800,
      hardStepTokens: 4000,
      truncateAtTokens: 1400,
      costPer1kTokensUsd: 0.002,
      stepExecutionTokenCost: 120
    },
    governance: {
      warningThresholdPercents: [80, 100, 120],
      escalationThresholdPercent: 120,
      hardStopEnabled: false,
      hardStopThresholdPercent: 131.25
    }
  },
  routing: {
    minimumSignalScore: 2,
    intentProfiles: {
      backend: { path: "execute", leadRole: "DEV", fallbackLeadRole: "CTO" },
      design: { path: "coordinate", leadRole: "PM", fallbackLeadRole: "CTO" },
      marketing: { path: "coordinate", leadRole: "MARKETING", fallbackLeadRole: "PM" },
      roadmap: { path: "coordinate", leadRole: "PM", fallbackLeadRole: "CTO" },
      research: { path: "investigate", leadRole: "RESEARCH", fallbackLeadRole: "CTO" },
      mixed: { path: "execute", leadRole: "CTO", fallbackLeadRole: "PM" }
    }
  },
  compaction: {
    backend: { triggerTokens: 700, targetTokens: 420, retainRecentLines: 3 },
    design: { triggerTokens: 760, targetTokens: 460, retainRecentLines: 3 },
    marketing: { triggerTokens: 640, targetTokens: 380, retainRecentLines: 2 },
    roadmap: { triggerTokens: 780, targetTokens: 460, retainRecentLines: 3 },
    research: { triggerTokens: 760, targetTokens: 440, retainRecentLines: 3 },
    mixed: { triggerTokens: 720, targetTokens: 430, retainRecentLines: 3 }
  }
};

export const DEFAULT_SUPERVISOR_POLICY_PATH = ".opencode/supervisor-policy.json";
export const DEFAULT_SUPERVISOR_PROFILE = "v1-safe" as const;
export const DEFAULT_SUPERVISOR_ROLE_ALIASES = Object.freeze({ ...DEFAULT_POLICY_INPUT.roleAliases }) as Readonly<Record<string, Role>>;
export const DEFAULT_SUPERVISOR_LIMITS = Object.freeze({
  lanes: Object.freeze({
    activeCapsByTier: Object.freeze({
      "small-high-risk": DEFAULT_POLICY_INPUT.limits!.lanes!.activeCapsByTier!["small-high-risk"]!,
      "medium-moderate-risk": DEFAULT_POLICY_INPUT.limits!.lanes!.activeCapsByTier!["medium-moderate-risk"]!,
      "large-mature": DEFAULT_POLICY_INPUT.limits!.lanes!.activeCapsByTier!["large-mature"]!
    }),
    maxConcurrentCodeChanges: DEFAULT_POLICY_INPUT.limits!.lanes!.maxConcurrentCodeChanges!,
    maxOpenPullRequests: DEFAULT_POLICY_INPUT.limits!.lanes!.maxOpenPullRequests!
  }),
  worktrees: Object.freeze({
    maxActive: DEFAULT_POLICY_INPUT.limits!.worktrees!.maxActive!
  }),
  sessions: Object.freeze({
    maxPerWorktree: DEFAULT_POLICY_INPUT.limits!.sessions!.maxPerWorktree!
  }),
  mcp: Object.freeze({
    defaultCallCap: DEFAULT_POLICY_INPUT.limits!.mcp!.defaultCallCap!,
    deepCallCap: DEFAULT_POLICY_INPUT.limits!.mcp!.deepCallCap!
  })
});
export const DEFAULT_SUPERVISOR_APPROVAL_GATES = Object.freeze({ ...DEFAULT_POLICY_INPUT.approvalGates }) as Readonly<ResolvedSupervisorPolicy["approvalGates"]>;
export const DEFAULT_SUPERVISOR_BUDGET = Object.freeze({
  runtime: Object.freeze({
    softRunTokens: DEFAULT_POLICY_INPUT.budget!.runtime!.softRunTokens!,
    hardRunTokens: DEFAULT_POLICY_INPUT.budget!.runtime!.hardRunTokens!,
    softStepTokens: DEFAULT_POLICY_INPUT.budget!.runtime!.softStepTokens!,
    hardStepTokens: DEFAULT_POLICY_INPUT.budget!.runtime!.hardStepTokens!,
    truncateAtTokens: DEFAULT_POLICY_INPUT.budget!.runtime!.truncateAtTokens!,
    costPer1kTokensUsd: DEFAULT_POLICY_INPUT.budget!.runtime!.costPer1kTokensUsd!,
    stepExecutionTokenCost: DEFAULT_POLICY_INPUT.budget!.runtime!.stepExecutionTokenCost!
  }),
  governance: Object.freeze({
    escalationThresholdPercent: DEFAULT_POLICY_INPUT.budget!.governance!.escalationThresholdPercent!,
    hardStopEnabled: DEFAULT_POLICY_INPUT.budget!.governance!.hardStopEnabled!,
    hardStopThresholdPercent: DEFAULT_POLICY_INPUT.budget!.governance!.hardStopThresholdPercent!,
    warningThresholdPercents: [...DEFAULT_POLICY_INPUT.budget!.governance!.warningThresholdPercents!]
  })
});
export const DEFAULT_SUPERVISOR_ROUTING = Object.freeze({
  minimumSignalScore: DEFAULT_POLICY_INPUT.routing!.minimumSignalScore!,
  intentProfiles: Object.freeze({
    backend: Object.freeze({ ...DEFAULT_POLICY_INPUT.routing!.intentProfiles!.backend }),
    design: Object.freeze({ ...DEFAULT_POLICY_INPUT.routing!.intentProfiles!.design }),
    marketing: Object.freeze({ ...DEFAULT_POLICY_INPUT.routing!.intentProfiles!.marketing }),
    roadmap: Object.freeze({ ...DEFAULT_POLICY_INPUT.routing!.intentProfiles!.roadmap }),
    research: Object.freeze({ ...DEFAULT_POLICY_INPUT.routing!.intentProfiles!.research }),
    mixed: Object.freeze({ ...DEFAULT_POLICY_INPUT.routing!.intentProfiles!.mixed })
  })
}) as Readonly<ResolvedSupervisorPolicy["routing"]>;
export const DEFAULT_SUPERVISOR_COMPACTION = Object.freeze({
  backend: Object.freeze({ ...DEFAULT_POLICY_INPUT.compaction!.backend }),
  design: Object.freeze({ ...DEFAULT_POLICY_INPUT.compaction!.design }),
  marketing: Object.freeze({ ...DEFAULT_POLICY_INPUT.compaction!.marketing }),
  roadmap: Object.freeze({ ...DEFAULT_POLICY_INPUT.compaction!.roadmap }),
  research: Object.freeze({ ...DEFAULT_POLICY_INPUT.compaction!.research }),
  mixed: Object.freeze({ ...DEFAULT_POLICY_INPUT.compaction!.mixed })
}) as Readonly<ResolvedSupervisorPolicy["compaction"]>;

let cachedPolicyResult: SupervisorPolicyLoadResult | null = null;

const cloneDefaultPolicy = (): ResolvedSupervisorPolicy => ({
  profile: DEFAULT_SUPERVISOR_PROFILE,
  roleAliases: { ...DEFAULT_SUPERVISOR_ROLE_ALIASES },
  providers: {
    patterns: DEFAULT_PROVIDER_PATTERNS.map(compileProviderPattern)
  },
  limits: {
    lanes: {
      activeCapsByTier: {
        "small-high-risk": DEFAULT_SUPERVISOR_LIMITS.lanes.activeCapsByTier["small-high-risk"],
        "medium-moderate-risk": DEFAULT_SUPERVISOR_LIMITS.lanes.activeCapsByTier["medium-moderate-risk"],
        "large-mature": DEFAULT_SUPERVISOR_LIMITS.lanes.activeCapsByTier["large-mature"]
      },
      maxConcurrentCodeChanges: DEFAULT_SUPERVISOR_LIMITS.lanes.maxConcurrentCodeChanges,
      maxOpenPullRequests: DEFAULT_SUPERVISOR_LIMITS.lanes.maxOpenPullRequests
    },
    worktrees: {
      maxActive: DEFAULT_SUPERVISOR_LIMITS.worktrees.maxActive
    },
    sessions: {
      maxPerWorktree: DEFAULT_SUPERVISOR_LIMITS.sessions.maxPerWorktree
    },
    mcp: {
      defaultCallCap: DEFAULT_SUPERVISOR_LIMITS.mcp.defaultCallCap,
      deepCallCap: DEFAULT_SUPERVISOR_LIMITS.mcp.deepCallCap
    }
  },
  approvalGates: {
    escalationMode: DEFAULT_SUPERVISOR_APPROVAL_GATES.escalationMode,
    mergeMode: DEFAULT_SUPERVISOR_APPROVAL_GATES.mergeMode,
    allowServiceCriticalAutoMerge: DEFAULT_SUPERVISOR_APPROVAL_GATES.allowServiceCriticalAutoMerge,
    boundaries: {
      merge: DEFAULT_SUPERVISOR_APPROVAL_GATES.boundaries.merge,
      release: DEFAULT_SUPERVISOR_APPROVAL_GATES.boundaries.release,
      destructive: DEFAULT_SUPERVISOR_APPROVAL_GATES.boundaries.destructive,
      securitySensitive: DEFAULT_SUPERVISOR_APPROVAL_GATES.boundaries.securitySensitive,
      budgetExceptions: DEFAULT_SUPERVISOR_APPROVAL_GATES.boundaries.budgetExceptions,
      automationWidening: DEFAULT_SUPERVISOR_APPROVAL_GATES.boundaries.automationWidening
    }
  },
  budget: {
    runtime: {
      softRunTokens: DEFAULT_SUPERVISOR_BUDGET.runtime.softRunTokens,
      hardRunTokens: DEFAULT_SUPERVISOR_BUDGET.runtime.hardRunTokens,
      softStepTokens: DEFAULT_SUPERVISOR_BUDGET.runtime.softStepTokens,
      hardStepTokens: DEFAULT_SUPERVISOR_BUDGET.runtime.hardStepTokens,
      truncateAtTokens: DEFAULT_SUPERVISOR_BUDGET.runtime.truncateAtTokens,
      costPer1kTokensUsd: DEFAULT_SUPERVISOR_BUDGET.runtime.costPer1kTokensUsd,
      stepExecutionTokenCost: DEFAULT_SUPERVISOR_BUDGET.runtime.stepExecutionTokenCost
    },
    governance: {
      escalationThresholdPercent: DEFAULT_SUPERVISOR_BUDGET.governance.escalationThresholdPercent,
      hardStopEnabled: DEFAULT_SUPERVISOR_BUDGET.governance.hardStopEnabled,
      hardStopThresholdPercent: DEFAULT_SUPERVISOR_BUDGET.governance.hardStopThresholdPercent,
      warningThresholdPercents: [...DEFAULT_SUPERVISOR_BUDGET.governance.warningThresholdPercents]
    }
  },
  routing: {
    minimumSignalScore: DEFAULT_SUPERVISOR_ROUTING.minimumSignalScore,
    intentProfiles: {
      backend: { ...DEFAULT_SUPERVISOR_ROUTING.intentProfiles.backend },
      design: { ...DEFAULT_SUPERVISOR_ROUTING.intentProfiles.design },
      marketing: { ...DEFAULT_SUPERVISOR_ROUTING.intentProfiles.marketing },
      roadmap: { ...DEFAULT_SUPERVISOR_ROUTING.intentProfiles.roadmap },
      research: { ...DEFAULT_SUPERVISOR_ROUTING.intentProfiles.research },
      mixed: { ...DEFAULT_SUPERVISOR_ROUTING.intentProfiles.mixed }
    }
  },
  compaction: {
    backend: { ...DEFAULT_SUPERVISOR_COMPACTION.backend },
    design: { ...DEFAULT_SUPERVISOR_COMPACTION.design },
    marketing: { ...DEFAULT_SUPERVISOR_COMPACTION.marketing },
    roadmap: { ...DEFAULT_SUPERVISOR_COMPACTION.roadmap },
    research: { ...DEFAULT_SUPERVISOR_COMPACTION.research },
    mixed: { ...DEFAULT_SUPERVISOR_COMPACTION.mixed }
  }
});

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isSupportedRole = (value: string): value is Role => {
  return ["CTO", "DEV", "PO", "PM", "CEO", "MARKETING", "RESEARCH"].includes(value);
};

const isSupportedExecutionPath = (value: string): value is SupervisorExecutionPath => {
  return ["execute", "coordinate", "investigate", "safe-hold"].includes(value);
};

const compileProviderPattern = (pattern: SupervisorProviderPatternInput): SupervisorProviderPattern => ({
  key: pattern.key,
  regex: new RegExp(pattern.pattern, "i"),
  hint: pattern.hint,
  toolPrefix: pattern.toolPrefix
});

const pushDiagnostic = (
  diagnostics: SupervisorPolicyDiagnostics[],
  path: string,
  message: string
) => {
  diagnostics.push({ path, message });
};

const readPositiveNumber = (
  value: unknown,
  fallback: number,
  diagnostics: SupervisorPolicyDiagnostics[],
  path: string
): number => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    pushDiagnostic(diagnostics, path, `Expected a positive number, received ${String(value)}.`);
    return fallback;
  }

  return value;
};

const readPositiveInteger = (
  value: unknown,
  fallback: number,
  diagnostics: SupervisorPolicyDiagnostics[],
  path: string
): number => {
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    pushDiagnostic(diagnostics, path, `Expected a positive integer, received ${String(value)}.`);
    return fallback;
  }

  return value;
};

export const resolveSupervisorPolicy = (
  input?: unknown,
  source = "defaults"
): SupervisorPolicyLoadResult => {
  const diagnostics: SupervisorPolicyDiagnostics[] = [];
  const config = cloneDefaultPolicy();

  if (input === undefined) {
    return { config, diagnostics, source, valid: true };
  }

  if (!isRecord(input)) {
    pushDiagnostic(diagnostics, "config", "Expected the policy file to contain a JSON object.");
    return { config, diagnostics, source, valid: false };
  }

  if (input.profile !== undefined && input.profile !== DEFAULT_SUPERVISOR_PROFILE) {
    pushDiagnostic(diagnostics, "profile", `Unsupported profile '${String(input.profile)}'; falling back to '${DEFAULT_SUPERVISOR_PROFILE}'.`);
  }

  if (input.roleAliases !== undefined) {
    if (!isRecord(input.roleAliases)) {
      pushDiagnostic(diagnostics, "roleAliases", "Expected roleAliases to be an object of alias-to-role mappings.");
    } else {
      for (const [alias, roleValue] of Object.entries(input.roleAliases)) {
        if (typeof roleValue !== "string" || !isSupportedRole(roleValue)) {
          pushDiagnostic(diagnostics, `roleAliases.${alias}`, `Unsupported role '${String(roleValue)}'.`);
          continue;
        }
        config.roleAliases[alias.toLowerCase()] = roleValue;
      }
    }
  }

  if (input.providers !== undefined) {
    if (!isRecord(input.providers)) {
      pushDiagnostic(diagnostics, "providers", "Expected providers to be an object.");
    } else if (input.providers.patterns !== undefined) {
      if (!Array.isArray(input.providers.patterns)) {
        pushDiagnostic(diagnostics, "providers.patterns", "Expected providers.patterns to be an array.");
      } else {
        const compiledPatterns: SupervisorProviderPattern[] = [];
        for (const [index, entry] of input.providers.patterns.entries()) {
          if (!isRecord(entry)) {
            pushDiagnostic(diagnostics, `providers.patterns.${index}`, "Expected each provider pattern to be an object.");
            continue;
          }

          const { key, pattern, hint, toolPrefix } = entry;
          if (typeof key !== "string" || !key.trim()) {
            pushDiagnostic(diagnostics, `providers.patterns.${index}.key`, "Expected a non-empty key.");
            continue;
          }
          if (typeof pattern !== "string" || !pattern.trim()) {
            pushDiagnostic(diagnostics, `providers.patterns.${index}.pattern`, "Expected a non-empty regex pattern string.");
            continue;
          }
          if (typeof hint !== "string" || !hint.trim()) {
            pushDiagnostic(diagnostics, `providers.patterns.${index}.hint`, "Expected a non-empty hint string.");
            continue;
          }
          if (typeof toolPrefix !== "string" || !toolPrefix.trim()) {
            pushDiagnostic(diagnostics, `providers.patterns.${index}.toolPrefix`, "Expected a non-empty toolPrefix string.");
            continue;
          }

          try {
            compiledPatterns.push(compileProviderPattern({ key, pattern, hint, toolPrefix }));
          } catch (error) {
            pushDiagnostic(diagnostics, `providers.patterns.${index}.pattern`, `Invalid regex: ${String(error)}.`);
          }
        }

        if (compiledPatterns.length > 0) {
          config.providers.patterns = compiledPatterns;
        }
      }
    }
  }

  if (input.limits !== undefined) {
    if (!isRecord(input.limits)) {
      pushDiagnostic(diagnostics, "limits", "Expected limits to be an object.");
    } else {
      const lanes = input.limits.lanes;
      if (lanes !== undefined) {
        if (!isRecord(lanes)) {
          pushDiagnostic(diagnostics, "limits.lanes", "Expected limits.lanes to be an object.");
        } else {
          const activeCapsByTier = lanes.activeCapsByTier;
          if (activeCapsByTier !== undefined) {
            if (!isRecord(activeCapsByTier)) {
              pushDiagnostic(diagnostics, "limits.lanes.activeCapsByTier", "Expected activeCapsByTier to be an object.");
            } else {
              for (const tier of SUPPORTED_REPO_RISK_TIERS) {
                config.limits.lanes.activeCapsByTier[tier] = readPositiveInteger(
                  activeCapsByTier[tier],
                  config.limits.lanes.activeCapsByTier[tier],
                  diagnostics,
                  `limits.lanes.activeCapsByTier.${tier}`
                );
              }
            }
          }

          config.limits.lanes.maxConcurrentCodeChanges = readPositiveInteger(
            lanes.maxConcurrentCodeChanges,
            config.limits.lanes.maxConcurrentCodeChanges,
            diagnostics,
            "limits.lanes.maxConcurrentCodeChanges"
          );
          config.limits.lanes.maxOpenPullRequests = readPositiveInteger(
            lanes.maxOpenPullRequests,
            config.limits.lanes.maxOpenPullRequests,
            diagnostics,
            "limits.lanes.maxOpenPullRequests"
          );
        }
      }

      const worktrees = input.limits.worktrees;
      if (worktrees !== undefined) {
        if (!isRecord(worktrees)) {
          pushDiagnostic(diagnostics, "limits.worktrees", "Expected limits.worktrees to be an object.");
        } else {
          config.limits.worktrees.maxActive = readPositiveInteger(
            worktrees.maxActive,
            config.limits.worktrees.maxActive,
            diagnostics,
            "limits.worktrees.maxActive"
          );
        }
      }

      const sessions = input.limits.sessions;
      if (sessions !== undefined) {
        if (!isRecord(sessions)) {
          pushDiagnostic(diagnostics, "limits.sessions", "Expected limits.sessions to be an object.");
        } else {
          config.limits.sessions.maxPerWorktree = readPositiveInteger(
            sessions.maxPerWorktree,
            config.limits.sessions.maxPerWorktree,
            diagnostics,
            "limits.sessions.maxPerWorktree"
          );
        }
      }

      const mcp = input.limits.mcp;
      if (mcp !== undefined) {
        if (!isRecord(mcp)) {
          pushDiagnostic(diagnostics, "limits.mcp", "Expected limits.mcp to be an object.");
        } else {
          config.limits.mcp.defaultCallCap = readPositiveInteger(
            mcp.defaultCallCap,
            config.limits.mcp.defaultCallCap,
            diagnostics,
            "limits.mcp.defaultCallCap"
          );
          config.limits.mcp.deepCallCap = readPositiveInteger(
            mcp.deepCallCap,
            config.limits.mcp.deepCallCap,
            diagnostics,
            "limits.mcp.deepCallCap"
          );
        }
      }
    }
  }

  if (input.approvalGates !== undefined) {
    if (!isRecord(input.approvalGates)) {
      pushDiagnostic(diagnostics, "approvalGates", "Expected approvalGates to be an object.");
    } else {
      if (input.approvalGates.escalationMode !== undefined && input.approvalGates.escalationMode !== "ask-first") {
        pushDiagnostic(diagnostics, "approvalGates.escalationMode", "Only 'ask-first' is supported in the v1-safe profile.");
      }

      if (input.approvalGates.mergeMode !== undefined) {
        if (input.approvalGates.mergeMode === "manual" || input.approvalGates.mergeMode === "auto-merge") {
          config.approvalGates.mergeMode = input.approvalGates.mergeMode;
        } else {
          pushDiagnostic(diagnostics, "approvalGates.mergeMode", `Unsupported mergeMode '${String(input.approvalGates.mergeMode)}'.`);
        }
      }

      if (input.approvalGates.allowServiceCriticalAutoMerge !== undefined) {
        if (typeof input.approvalGates.allowServiceCriticalAutoMerge === "boolean") {
          config.approvalGates.allowServiceCriticalAutoMerge = input.approvalGates.allowServiceCriticalAutoMerge;
        } else {
          pushDiagnostic(diagnostics, "approvalGates.allowServiceCriticalAutoMerge", "Expected a boolean value.");
        }
      }

      if (input.approvalGates.boundaries !== undefined) {
        if (!isRecord(input.approvalGates.boundaries)) {
          pushDiagnostic(diagnostics, "approvalGates.boundaries", "Expected approvalGates.boundaries to be an object.");
        } else {
          const boundaryEntries = [
            ["merge", "merge"],
            ["release", "release"],
            ["destructive", "destructive"],
            ["securitySensitive", "securitySensitive"],
            ["budgetExceptions", "budgetExceptions"],
            ["automationWidening", "automationWidening"]
          ] as const;

          for (const [inputKey, configKey] of boundaryEntries) {
            const value = input.approvalGates.boundaries[inputKey];
            if (value === undefined) {
              continue;
            }

            if (typeof value === "boolean") {
              config.approvalGates.boundaries[configKey] = value;
            } else {
              pushDiagnostic(diagnostics, `approvalGates.boundaries.${inputKey}`, "Expected a boolean value.");
            }
          }
        }
      }
    }
  }

  if (input.budget !== undefined) {
    if (!isRecord(input.budget)) {
      pushDiagnostic(diagnostics, "budget", "Expected budget to be an object.");
    } else {
      const runtime = input.budget.runtime;
      if (runtime !== undefined) {
        if (!isRecord(runtime)) {
          pushDiagnostic(diagnostics, "budget.runtime", "Expected budget.runtime to be an object.");
        } else {
          config.budget.runtime.softRunTokens = readPositiveInteger(runtime.softRunTokens, config.budget.runtime.softRunTokens, diagnostics, "budget.runtime.softRunTokens");
          config.budget.runtime.hardRunTokens = readPositiveInteger(runtime.hardRunTokens, config.budget.runtime.hardRunTokens, diagnostics, "budget.runtime.hardRunTokens");
          config.budget.runtime.softStepTokens = readPositiveInteger(runtime.softStepTokens, config.budget.runtime.softStepTokens, diagnostics, "budget.runtime.softStepTokens");
          config.budget.runtime.hardStepTokens = readPositiveInteger(runtime.hardStepTokens, config.budget.runtime.hardStepTokens, diagnostics, "budget.runtime.hardStepTokens");
          config.budget.runtime.truncateAtTokens = readPositiveInteger(runtime.truncateAtTokens, config.budget.runtime.truncateAtTokens, diagnostics, "budget.runtime.truncateAtTokens");
          config.budget.runtime.costPer1kTokensUsd = readPositiveNumber(runtime.costPer1kTokensUsd, config.budget.runtime.costPer1kTokensUsd, diagnostics, "budget.runtime.costPer1kTokensUsd");
          config.budget.runtime.stepExecutionTokenCost = readPositiveInteger(runtime.stepExecutionTokenCost, config.budget.runtime.stepExecutionTokenCost, diagnostics, "budget.runtime.stepExecutionTokenCost");
        }
      }

      const governance = input.budget.governance;
      if (governance !== undefined) {
        if (!isRecord(governance)) {
          pushDiagnostic(diagnostics, "budget.governance", "Expected budget.governance to be an object.");
        } else {
          if (governance.warningThresholdPercents !== undefined) {
            if (!Array.isArray(governance.warningThresholdPercents)) {
              pushDiagnostic(diagnostics, "budget.governance.warningThresholdPercents", "Expected an array of positive numbers.");
            } else {
              const normalized = governance.warningThresholdPercents
                .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
                .map((value) => Number(value.toFixed(2)));
              if (normalized.length === 0) {
                pushDiagnostic(diagnostics, "budget.governance.warningThresholdPercents", "Expected at least one positive warning threshold.");
              } else {
                config.budget.governance.warningThresholdPercents = [...new Set(normalized)].sort((a, b) => a - b);
              }
            }
          }

          config.budget.governance.escalationThresholdPercent = readPositiveNumber(
            governance.escalationThresholdPercent,
            config.budget.governance.escalationThresholdPercent,
            diagnostics,
            "budget.governance.escalationThresholdPercent"
          );
          config.budget.governance.hardStopThresholdPercent = readPositiveNumber(
            governance.hardStopThresholdPercent,
            config.budget.governance.hardStopThresholdPercent,
            diagnostics,
            "budget.governance.hardStopThresholdPercent"
          );

          if (governance.hardStopEnabled !== undefined) {
            if (typeof governance.hardStopEnabled === "boolean") {
              config.budget.governance.hardStopEnabled = governance.hardStopEnabled;
            } else {
              pushDiagnostic(diagnostics, "budget.governance.hardStopEnabled", "Expected a boolean value.");
            }
          }

          if (config.budget.governance.hardStopThresholdPercent < config.budget.governance.escalationThresholdPercent) {
            pushDiagnostic(
              diagnostics,
              "budget.governance.hardStopThresholdPercent",
              "Hard-stop threshold must be greater than or equal to the escalation threshold; using defaults for both values."
            );
            config.budget.governance.escalationThresholdPercent = DEFAULT_SUPERVISOR_BUDGET.governance.escalationThresholdPercent;
            config.budget.governance.hardStopThresholdPercent = DEFAULT_SUPERVISOR_BUDGET.governance.hardStopThresholdPercent;
          }
        }
      }
    }
  }

  if (input.routing !== undefined) {
    if (!isRecord(input.routing)) {
      pushDiagnostic(diagnostics, "routing", "Expected routing to be an object.");
    } else {
      config.routing.minimumSignalScore = readPositiveInteger(
        input.routing.minimumSignalScore,
        config.routing.minimumSignalScore,
        diagnostics,
        "routing.minimumSignalScore"
      );

      if (input.routing.intentProfiles !== undefined) {
        if (!isRecord(input.routing.intentProfiles)) {
          pushDiagnostic(diagnostics, "routing.intentProfiles", "Expected routing.intentProfiles to be an object.");
        } else {
          for (const intent of Object.keys(config.routing.intentProfiles) as Intent[]) {
            const override = input.routing.intentProfiles[intent];
            if (override === undefined) {
              continue;
            }

            if (!isRecord(override)) {
              pushDiagnostic(diagnostics, `routing.intentProfiles.${intent}`, "Expected each routing profile to be an object.");
              continue;
            }

            if (override.path !== undefined) {
              if (typeof override.path === "string" && isSupportedExecutionPath(override.path)) {
                config.routing.intentProfiles[intent].path = override.path;
              } else {
                pushDiagnostic(diagnostics, `routing.intentProfiles.${intent}.path`, `Unsupported execution path '${String(override.path)}'.`);
              }
            }

            if (override.leadRole !== undefined) {
              if (typeof override.leadRole === "string" && isSupportedRole(override.leadRole)) {
                config.routing.intentProfiles[intent].leadRole = override.leadRole;
              } else {
                pushDiagnostic(diagnostics, `routing.intentProfiles.${intent}.leadRole`, `Unsupported role '${String(override.leadRole)}'.`);
              }
            }

            if (override.fallbackLeadRole !== undefined) {
              if (typeof override.fallbackLeadRole === "string" && isSupportedRole(override.fallbackLeadRole)) {
                config.routing.intentProfiles[intent].fallbackLeadRole = override.fallbackLeadRole;
              } else {
                pushDiagnostic(diagnostics, `routing.intentProfiles.${intent}.fallbackLeadRole`, `Unsupported role '${String(override.fallbackLeadRole)}'.`);
              }
            }
          }
        }
      }
    }
  }

  if (input.compaction !== undefined) {
    if (!isRecord(input.compaction)) {
      pushDiagnostic(diagnostics, "compaction", "Expected compaction to be an object.");
    } else {
      for (const intent of Object.keys(config.compaction) as Intent[]) {
        const override = input.compaction[intent];
        if (override === undefined) {
          continue;
        }

        if (!isRecord(override)) {
          pushDiagnostic(diagnostics, `compaction.${intent}`, "Expected each compaction profile to be an object.");
          continue;
        }

        config.compaction[intent].triggerTokens = readPositiveInteger(
          override.triggerTokens,
          config.compaction[intent].triggerTokens,
          diagnostics,
          `compaction.${intent}.triggerTokens`
        );
        config.compaction[intent].targetTokens = readPositiveInteger(
          override.targetTokens,
          config.compaction[intent].targetTokens,
          diagnostics,
          `compaction.${intent}.targetTokens`
        );
        config.compaction[intent].retainRecentLines = readPositiveInteger(
          override.retainRecentLines,
          config.compaction[intent].retainRecentLines,
          diagnostics,
          `compaction.${intent}.retainRecentLines`
        );
      }
    }
  }

  const valid = diagnostics.length === 0;
  return { config, diagnostics, source, valid };
};

export const loadSupervisorPolicy = (options?: {
  cwd?: string;
  policyPath?: string;
}): SupervisorPolicyLoadResult => {
  const cwd = options?.cwd ?? process.cwd();
  const resolvedPath = options?.policyPath ?? join(cwd, DEFAULT_SUPERVISOR_POLICY_PATH);
  if (!existsSync(resolvedPath)) {
    return resolveSupervisorPolicy(undefined, "defaults");
  }

  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, "utf-8")) as unknown;
    const result = resolveSupervisorPolicy(parsed, resolvedPath);
    if (!result.valid) {
      debugLog("supervisor.policy.invalid", {
        source: resolvedPath,
        diagnostics: result.diagnostics
      });
    }
    return result;
  } catch (error) {
    const diagnostics = [{
      path: resolvedPath,
      message: `Failed to read or parse supervisor policy; using defaults. ${String(error)}`
    }];
    debugLog("supervisor.policy.load_failed", {
      source: resolvedPath,
      diagnostics
    });
    return {
      config: cloneDefaultPolicy(),
      diagnostics,
      source: resolvedPath,
      valid: false
    };
  }
};

export const getSupervisorPolicy = (): ResolvedSupervisorPolicy => {
  if (!cachedPolicyResult) {
    cachedPolicyResult = loadSupervisorPolicy();
  }
  return cachedPolicyResult.config;
};

export const getSupervisorPolicyDiagnostics = (): SupervisorPolicyDiagnostics[] => {
  if (!cachedPolicyResult) {
    cachedPolicyResult = loadSupervisorPolicy();
  }
  return [...cachedPolicyResult.diagnostics];
};

export const resetSupervisorPolicyCache = (): void => {
  cachedPolicyResult = null;
};
