import { describe, expect, it } from "vitest";
import {
  buildProviderPatterns,
  checkMcpAccess,
  detectMcpProvidersWithPatterns,
  resolveProviderFromToolName
} from "../plugins/orchestration-workflows/mcp";
import type { SessionPolicy } from "../plugins/orchestration-workflows/types";

const basePolicy = (): SessionPolicy => ({
  roles: ["CTO", "DEV"],
  targets: {
    CTO: 2,
    DEV: 2,
    FE: 0,
    BE: 0,
    UX: 0,
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
  it("detects common provider aliases without matching generic wiki text", () => {
    // Arrange
    const patterns = buildProviderPatterns([]);

    // Act
    const detected = detectMcpProvidersWithPatterns(
      "Pull GH context, sync the Clubhouse story, and ignore the internal engineering wiki doc.",
      patterns
    );

    // Assert
    expect(detected).toEqual(["github", "shortcut"]);
  });

  it("resolves provider tool prefixes for normalized custom provider keys", () => {
    // Arrange
    const patterns = buildProviderPatterns(["acme.docs-v2"]);

    // Act
    const resolved = resolveProviderFromToolName("acme_docs_v2_search", patterns);

    // Assert
    expect(resolved).toBe("acme.docs-v2");
  });

  it("allows non-mcp tools", () => {
    // Arrange

    // Act
    const result = checkMcpAccess("bash", basePolicy(), {
      providerFromToolName: () => null
    });

    // Assert
    expect(result).toEqual({ blocked: false });
  });

  it("blocks when provider is not installed", () => {
    // Arrange

    // Act
    const result = checkMcpAccess("sentry_list-issues", basePolicy(), {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => false
    });

    // Assert
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("unavailable in this runtime session");
  });

  it("blocks when no provider is mentioned", () => {
    // Arrange
    const policy = basePolicy();
    policy.mcpProviders = [];

    // Act
    const result = checkMcpAccess("sentry_list-issues", policy, {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });

    // Assert
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("mention 'sentry' explicitly");
  });

  it("blocks when provider is not mentioned", () => {
    // Arrange

    // Act
    const result = checkMcpAccess("github_list-prs", basePolicy(), {
      providerFromToolName: () => "github",
      isProviderInstalled: () => true
    });

    // Assert
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("Allowed providers for this session");
  });

  it("enforces fairness across multiple providers", () => {
    // Arrange
    const policy = basePolicy();
    policy.mcpProviders = ["sentry", "github"];
    policy.mcpTouched = { sentry: 0, github: 1 };

    // Act
    const result = checkMcpAccess("github_list-prs", policy, {
      providerFromToolName: () => "github",
      isProviderInstalled: () => true
    });

    // Assert
    expect(result.blocked).toBe(true);
    expect(result.warning).toContain("Retry 'github'");
  });

  it("enforces default cap and allows deep cap", () => {
    // Arrange
    const policyDefault = basePolicy();
    policyDefault.mcpCallCount = 2;

    // Act
    const blocked = checkMcpAccess("sentry_list-issues", policyDefault, {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });

    const policyDeep = basePolicy();
    policyDeep.allowDeepMcp = true;
    policyDeep.mcpCallCount = 2;
    const allowed = checkMcpAccess("sentry_list-issues", policyDeep, {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });

    // Assert
    expect(blocked.blocked).toBe(true);
    expect(blocked.warning).toContain("limit (2)");
    expect(allowed.blocked).toBe(false);
  });

  it("allows valid provider access", () => {
    // Arrange

    // Act
    const result = checkMcpAccess("sentry_list-issues", basePolicy(), {
      providerFromToolName: () => "sentry",
      isProviderInstalled: () => true
    });

    // Assert
    expect(result).toEqual({ blocked: false });
  });
});
