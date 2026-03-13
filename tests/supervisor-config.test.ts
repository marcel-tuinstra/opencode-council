import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUPERVISOR_POLICY_PATH,
  loadSupervisorPolicy,
  resolveSupervisorPolicy
} from "../plugins/orchestration-workflows/supervisor-config";

describe("supervisor-config", () => {
  it("resolves the v1-safe defaults when no repo policy is present", () => {
    // Arrange

    // Act
    const result = resolveSupervisorPolicy();

    // Assert
    expect(result.valid).toBe(true);
    expect(result.config.profile).toBe("v1-safe");
    expect(result.config.roleAliases.developer).toBe("DEV");
    expect(result.config.limits.lanes.activeCapsByTier["medium-moderate-risk"]).toBe(3);
    expect(result.config.limits.worktrees.maxActive).toBe(1);
    expect(result.config.limits.sessions.maxPerWorktree).toBe(1);
    expect(result.config.approvalGates.mergeMode).toBe("manual");
    expect(result.config.budget.governance.warningThresholdPercents).toEqual([80, 100, 120]);
  });

  it("applies valid repo overrides to the typed config surface", () => {
    // Arrange
    const input = {
      profile: "v1-safe",
      roleAliases: {
        engineer: "DEV"
      },
      providers: {
        patterns: [
          {
            key: "github",
            pattern: "\\b(github|gh)\\b",
            hint: "GitHub MCP",
            toolPrefix: "github_"
          }
        ]
      },
      limits: {
        lanes: {
          activeCapsByTier: {
            "large-mature": 5
          },
          maxConcurrentCodeChanges: 2
        },
        worktrees: {
          maxActive: 2
        },
        sessions: {
          maxPerWorktree: 3
        },
        mcp: {
          defaultCallCap: 4,
          deepCallCap: 8
        }
      },
      approvalGates: {
        mergeMode: "auto-merge",
        allowServiceCriticalAutoMerge: true
      },
      budget: {
        runtime: {
          softRunTokens: 7000
        },
        governance: {
          warningThresholdPercents: [70, 90],
          hardStopEnabled: true,
          hardStopThresholdPercent: 140
        }
      },
      compaction: {
        backend: {
          triggerTokens: 800,
          targetTokens: 500
        }
      }
    };

    // Act
    const result = resolveSupervisorPolicy(input, "inline-test");

    // Assert
    expect(result.valid).toBe(true);
    expect(result.config.roleAliases.engineer).toBe("DEV");
    expect(result.config.providers.patterns).toHaveLength(1);
    expect(result.config.providers.patterns[0].regex.test("use gh for this")).toBe(true);
    expect(result.config.limits.lanes.activeCapsByTier["large-mature"]).toBe(5);
    expect(result.config.limits.worktrees.maxActive).toBe(2);
    expect(result.config.limits.sessions.maxPerWorktree).toBe(3);
    expect(result.config.limits.mcp.defaultCallCap).toBe(4);
    expect(result.config.approvalGates.mergeMode).toBe("auto-merge");
    expect(result.config.approvalGates.allowServiceCriticalAutoMerge).toBe(true);
    expect(result.config.budget.runtime.softRunTokens).toBe(7000);
    expect(result.config.budget.governance.warningThresholdPercents).toEqual([70, 90]);
    expect(result.config.compaction.backend).toEqual({ triggerTokens: 800, targetTokens: 500 });
  });

  it("falls back safely and reports diagnostics for invalid config", () => {
    // Arrange
    const input = {
      profile: "v2-risky",
      roleAliases: {
        engineer: "SECURITY"
      },
      providers: {
        patterns: [
          {
            key: "github",
            pattern: "(",
            hint: "GitHub MCP",
            toolPrefix: "github_"
          }
        ]
      },
      limits: {
        sessions: {
          maxPerWorktree: 0
        }
      },
      budget: {
        governance: {
          escalationThresholdPercent: 120,
          hardStopThresholdPercent: 110
        }
      }
    };

    // Act
    const result = resolveSupervisorPolicy(input, "inline-invalid-test");

    // Assert
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "profile",
      "roleAliases.engineer",
      "providers.patterns.0.pattern",
      "limits.sessions.maxPerWorktree",
      "budget.governance.hardStopThresholdPercent"
    ]));
    expect(result.config.profile).toBe("v1-safe");
    expect(result.config.roleAliases.engineer).toBeUndefined();
    expect(result.config.providers.patterns.some((pattern) => pattern.key === "sentry")).toBe(true);
    expect(result.config.limits.sessions.maxPerWorktree).toBe(1);
    expect(result.config.budget.governance.escalationThresholdPercent).toBe(120);
    expect(result.config.budget.governance.hardStopThresholdPercent).toBe(131.25);
  });

  it("loads a repo-local policy file from the standard path", () => {
    // Arrange
    const tempRoot = mkdtempSync(join(tmpdir(), "supervisor-policy-"));
    const policyPath = join(tempRoot, DEFAULT_SUPERVISOR_POLICY_PATH);
    mkdirSync(join(tempRoot, ".opencode"));
    writeFileSync(policyPath, JSON.stringify({
      profile: "v1-safe",
      roleAliases: {
        engineer: "DEV"
      },
      limits: {
        mcp: {
          defaultCallCap: 3
        }
      }
    }));

    // Act
    const result = loadSupervisorPolicy({ cwd: tempRoot });

    // Assert
    expect(result.valid).toBe(true);
    expect(result.config.roleAliases.engineer).toBe("DEV");
    expect(result.config.limits.mcp.defaultCallCap).toBe(3);
    rmSync(tempRoot, { recursive: true, force: true });
  });
});
