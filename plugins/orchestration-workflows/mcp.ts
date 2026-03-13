import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { debugLog } from "./debug";
import { getSupervisorPolicy } from "./supervisor-config";
import type { McpBlockResult, McpProviderConfig, SessionPolicy } from "./types";

let installedProviders: string[] | null = null;
let mcpProviderPatterns: McpProviderConfig[] = [];

const escapeRegexLiteral = (value: string): string => {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const normalizeProviderToken = (value: string): string => {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const buildFallbackProviderRegex = (providerKey: string): RegExp => {
  const normalized = providerKey.trim().toLowerCase();
  const variants = new Set<string>([escapeRegexLiteral(normalized)]);
  const pieces = normalized.split(/[^a-z0-9]+/).filter(Boolean);

  if (pieces.length > 1) {
    variants.add(pieces.map((piece) => escapeRegexLiteral(piece)).join("[-_.\\s]*"));
    variants.add(pieces.join("\\s+"));
  }

  return new RegExp(`\\b(${[...variants].join("|")})\\b`, "i");
};

const buildToolPrefixes = (providerKey: string, toolPrefix: string): string[] => {
  const normalizedKey = providerKey.trim().toLowerCase();
  const prefixes = new Set<string>([toolPrefix, `${normalizedKey}_`]);
  const underscored = normalizedKey.replace(/[^a-z0-9]+/g, "_");

  if (underscored.length > 0) {
    prefixes.add(`${underscored}_`);
  }

  return [...prefixes].filter(Boolean).sort((left, right) => right.length - left.length);
};

const getActiveProviderPatterns = (): McpProviderConfig[] => {
  return mcpProviderPatterns.length > 0 ? mcpProviderPatterns : buildProviderPatterns([]);
};

const normalizeProviderList = (providers: string[]): string[] => {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    const token = normalizeProviderToken(provider);
    if (!token || seen.has(token)) {
      continue;
    }

    normalized.push(token.replace(/\s+/g, "-"));
    seen.add(token);
  }

  return normalized;
};

export const loadInstalledProviders = async (): Promise<string[]> => {
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

export const buildProviderPatterns = (availableProviders: string[]): McpProviderConfig[] => {
  const builtinProviderPatterns = getSupervisorPolicy().providers.patterns;
  const patterns: McpProviderConfig[] = [];
  const seen = new Set<string>();

  for (const providerKey of availableProviders) {
    const normalizedProviderKey = providerKey.trim().toLowerCase();
    const builtin = builtinProviderPatterns.find((provider) => provider.key === normalizedProviderKey);
    if (builtin) {
      patterns.push(builtin);
      seen.add(normalizedProviderKey);
      continue;
    }

    patterns.push({
      key: normalizedProviderKey,
      regex: buildFallbackProviderRegex(normalizedProviderKey),
      hint: `${providerKey} MCP`,
      toolPrefix: `${normalizedProviderKey}_`
    });
    seen.add(normalizedProviderKey);
  }

  for (const builtin of builtinProviderPatterns) {
    if (!seen.has(builtin.key)) {
      patterns.push(builtin);
    }
  }

  return patterns;
};

export const initializeProviderPatterns = async (forceRefresh = false): Promise<void> => {
  if (installedProviders !== null && !forceRefresh) {
    return;
  }

  installedProviders = await loadInstalledProviders();
  mcpProviderPatterns = buildProviderPatterns(installedProviders);

  debugLog("providers.patterns_initialized", {
    installed: installedProviders,
    totalPatterns: mcpProviderPatterns.length
  });
};

export const isProviderInstalled = (providerKey: string): boolean => {
  const normalized = providerKey.trim().toLowerCase();
  return installedProviders?.some((provider) => provider.trim().toLowerCase() === normalized) ?? false;
};

export const detectMcpProvidersWithPatterns = (text: string, patterns: McpProviderConfig[]): string[] => {
  const providers: string[] = [];
  const seen = new Set<string>();

  for (const provider of patterns) {
    if (provider.regex.test(text) && !seen.has(provider.key)) {
      providers.push(provider.key);
      seen.add(provider.key);
    }
  }

  return providers;
};

export const detectMcpProviders = (text: string): string[] => {
  return detectMcpProvidersWithPatterns(text, getActiveProviderPatterns());
};

export const buildMcpHints = (providers: string[]): string[] => {
  return getActiveProviderPatterns()
    .filter((provider) => providers.includes(provider.key))
    .map((provider) => provider.hint);
};

export const resolveProviderFromToolName = (tool: string, patterns: McpProviderConfig[]): string | null => {
  for (const provider of patterns) {
    for (const prefix of buildToolPrefixes(provider.key, provider.toolPrefix)) {
      if (tool.startsWith(prefix)) {
        return provider.key;
      }
    }
  }

  return null;
};

export const providerFromToolName = (tool: string): string | null => {
  return resolveProviderFromToolName(tool, getActiveProviderPatterns());
};

export const getMissingProviders = (policy: SessionPolicy): string[] => {
  return normalizeProviderList(policy.mcpProviders).filter(
    (provider) => !(policy.mcpTouched[provider] && policy.mcpTouched[provider] > 0)
  );
};

type AccessCheckDeps = {
  isProviderInstalled?: (provider: string) => boolean;
  providerFromToolName?: (tool: string) => string | null;
};

export const checkMcpAccess = (
  tool: string,
  policy: SessionPolicy,
  deps: AccessCheckDeps = {}
): McpBlockResult => {
  const resolveProvider = deps.providerFromToolName ?? providerFromToolName;
  const providerInstalled = deps.isProviderInstalled ?? isProviderInstalled;
  const provider = resolveProvider(tool);
  const allowedProviders = normalizeProviderList(policy.mcpProviders);

  if (!provider) {
    return { blocked: false };
  }

  if (!providerInstalled(provider)) {
    return {
      blocked: true,
      warning: `MCP provider '${provider}' is unavailable in this runtime session. Add it to ~/.config/opencode/config.json, then restart or start a new session before retrying.`
    };
  }

  if (allowedProviders.length === 0) {
    return {
      blocked: true,
      warning: `MCP blocked: mention '${provider}' explicitly in the prompt to enable its tools for this session.`
    };
  }

  if (!allowedProviders.includes(provider)) {
    return {
      blocked: true,
      warning: `MCP provider '${provider}' was not approved in the prompt. Allowed providers for this session: ${allowedProviders.join(", ")}.`
    };
  }

  if (allowedProviders.length > 1) {
    const missing = getMissingProviders(policy);
    if (missing.length > 0 && !missing.includes(provider)) {
      return {
        blocked: true,
        warning: `MCP provider '${provider}' is temporarily blocked until these provider checks run first: ${missing.join(", ")}. Retry '${provider}' after that coverage lands.`
      };
    }
  }

  const mcpLimits = getSupervisorPolicy().limits.mcp;
  const cap = policy.allowDeepMcp ? mcpLimits.deepCallCap : mcpLimits.defaultCallCap;
  if (policy.mcpCallCount >= cap) {
    return {
      blocked: true,
      warning: `MCP call limit (${cap}) reached. Ask for "deeper investigation" to increase limit.`
    };
  }

  return { blocked: false };
};
