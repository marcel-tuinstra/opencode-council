import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  BUILTIN_PROVIDER_PATTERNS,
  MCP_CAPS
} from "./constants";
import { debugLog } from "./debug";
import type { McpBlockResult, McpProviderConfig, SessionPolicy } from "./types";

let installedProviders: string[] | null = null;
let mcpProviderPatterns: McpProviderConfig[] = [];

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
  const patterns: McpProviderConfig[] = [];
  const seen = new Set<string>();

  for (const providerKey of availableProviders) {
    const builtin = BUILTIN_PROVIDER_PATTERNS.find((provider) => provider.key === providerKey);
    if (builtin) {
      patterns.push(builtin);
      seen.add(providerKey);
      continue;
    }

    patterns.push({
      key: providerKey,
      regex: new RegExp(`\\b(${providerKey})\\b`, "i"),
      hint: `${providerKey} MCP`,
      toolPrefix: `${providerKey}_`
    });
    seen.add(providerKey);
  }

  for (const builtin of BUILTIN_PROVIDER_PATTERNS) {
    if (!seen.has(builtin.key)) {
      patterns.push(builtin);
    }
  }

  return patterns;
};

export const initializeProviderPatterns = async (): Promise<void> => {
  if (installedProviders !== null) {
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
  return installedProviders?.includes(providerKey) ?? false;
};

export const detectMcpProviders = (text: string): string[] => {
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

export const buildMcpHints = (providers: string[]): string[] => {
  return mcpProviderPatterns
    .filter((provider) => providers.includes(provider.key))
    .map((provider) => provider.hint);
};

export const providerFromToolName = (tool: string): string | null => {
  for (const provider of mcpProviderPatterns) {
    if (tool.startsWith(provider.toolPrefix)) {
      return provider.key;
    }
  }
  return null;
};

export const getMissingProviders = (policy: SessionPolicy): string[] => {
  return policy.mcpProviders.filter((provider) => !(policy.mcpTouched[provider] && policy.mcpTouched[provider] > 0));
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

  if (!provider) {
    return { blocked: false };
  }

  if (!providerInstalled(provider)) {
    return {
      blocked: true,
      warning: `MCP provider '${provider}' is not installed. Install it in ~/.config/opencode/config.json to use.`
    };
  }

  if (policy.mcpProviders.length === 0) {
    return {
      blocked: true,
      warning: `MCP blocked: no provider explicitly mentioned in prompt. Mention '${provider}' to enable.`
    };
  }

  if (!policy.mcpProviders.includes(provider)) {
    return {
      blocked: true,
      warning: `MCP provider '${provider}' not mentioned in prompt. Only these are allowed: ${policy.mcpProviders.join(", ")}.`
    };
  }

  if (policy.mcpProviders.length > 1) {
    const missing = getMissingProviders(policy);
    if (missing.length > 0 && !missing.includes(provider)) {
      return {
        blocked: true,
        warning: `MCP provider '${provider}' temporarily blocked. Check these first: ${missing.join(", ")}.`
      };
    }
  }

  const cap = policy.allowDeepMcp ? MCP_CAPS.deep : MCP_CAPS.default;
  if (policy.mcpCallCount >= cap) {
    return {
      blocked: true,
      warning: `MCP call limit (${cap}) reached. Ask for "deeper investigation" to increase limit.`
    };
  }

  return { blocked: false };
};
