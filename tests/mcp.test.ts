import { describe, expect, it } from "vitest";
import { checkMcpAccess } from "../plugins/orchestration-workflows/mcp";
import type { SessionPolicy } from "../plugins/orchestration-workflows/types";

const basePolicy = (): SessionPolicy => ({
  roles: ["CTO", "DEV"],
  targets: {
    CTO: 2,
    DEV: 2,
    PO: 0,
    PM: 0,
    CEO: 0,
    MARKETING: 0,
    RESEARCH: 0
  },
  heartbeat: false,
  intent: "backend",
  mcpProviders: ["sentry"],
  mcpHints: [],
  staleSensitive: false,
  allowDeepMcp: false,
  mcpCallCount: 0,
  mcpTouched: {},
  mcpWarnings: []
});

describe("mcp access", () => {
  it("allows non-mcp tools", () => {
    const result = checkMcpAccess("bash", basePolicy(), {
      providerFromToolName: () => null
    });
    expect(result).toEqual({ blocked: false });
  });

  it("blocks when provider is not installed", () => {
    const result = checkMcpAccess("sentry_list-issues", basePolicy(), {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => false
    });
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("not installed");
  });

  it("blocks when no provider is mentioned", () => {
    const policy = basePolicy();
    policy.mcpProviders = [];
    const result = checkMcpAccess("sentry_list-issues", policy, {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("no provider explicitly mentioned");
  });

  it("blocks when provider is not mentioned", () => {
    const result = checkMcpAccess("github_list-prs", basePolicy(), {
      providerFromToolName: () => "github",
      isProviderInstalled: () => true
    });
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("not mentioned");
  });

  it("enforces fairness across multiple providers", () => {
    const policy = basePolicy();
    policy.mcpProviders = ["sentry", "github"];
    policy.mcpTouched = { sentry: 0, github: 1 };
    const result = checkMcpAccess("github_list-prs", policy, {
      providerFromToolName: () => "github",
      isProviderInstalled: () => true
    });
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("temporarily blocked");
  });

  it("enforces default cap and allows deep cap", () => {
    const policyDefault = basePolicy();
    policyDefault.mcpCallCount = 2;
    const blocked = checkMcpAccess("sentry_list-issues", policyDefault, {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });
    expect(blocked.blocked).toBe(true);
    expect(blocked.warning).toContain("limit (2)");

    const policyDeep = basePolicy();
    policyDeep.allowDeepMcp = true;
    policyDeep.mcpCallCount = 2;
    const allowed = checkMcpAccess("sentry_list-issues", policyDeep, {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });
    expect(allowed.blocked).toBe(false);
  });

  it("allows valid provider access", () => {
    const result = checkMcpAccess("sentry_list-issues", basePolicy(), {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });
    expect(result).toEqual({ blocked: false });
  });
});
