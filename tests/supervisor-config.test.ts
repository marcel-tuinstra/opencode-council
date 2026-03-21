import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SUPERVISOR_POLICY_PATH,
  loadSupervisorPolicy,
  resolveSupervisorPolicy
} from "../plugins/orchestration-workflows/supervisor-config";
import { BUDGET_PROFILES } from "../plugins/orchestration-workflows/budget-profiles";

describe("supervisor-config", () => {
  it("resolves the v1-safe defaults when no repo policy is present", () => {
    const result = resolveSupervisorPolicy();

    expect(result.valid).toBe(true);
    expect(result.config.profile).toBe("v1-safe");
    expect(result.config.roleAliases.developer).toBe("DEV");
    expect(result.config.roleAliases.frontend).toBe("FE");
    expect(result.config.roleAliases.backend).toBe("BE");
    expect(result.config.roleAliases.ui).toBe("UX");
    expect(result.config.limits.lanes.activeCapsByTier["medium-moderate-risk"]).toBe(3);
    expect(result.config.execution).toEqual({
      mode: "delegate-only",
      allowSupervisorDirectEdits: false,
      requireDelegationLog: true,
      requireAgentWorktreeBinding: true,
      requireDedicatedIntegrationAgent: true,
      integrationAgentLabel: "INTEGRATION"
    });
    expect(result.config.approvalGates.mergeMode).toBe("manual");
    expect(result.config.protectedPaths.defaultOutcome).toBe("deny");
    expect(result.config.protectedPaths.rules.map((rule) => rule.ruleId)).toEqual([
      "deny-vcs-internals",
      "deny-secret-material",
      "review-governance-and-runtime-policy",
      "allow-default-repository-scope"
    ]);
    expect(result.config.routing.intentProfiles.frontend).toEqual({
      path: "execute",
      leadRole: "FE",
      fallbackLeadRole: "UX"
    });
    expect(result.config.routing.intentProfiles.backend).toEqual({
      path: "execute",
      leadRole: "BE",
      fallbackLeadRole: "CTO"
    });
    expect(result.config.routing.intentProfiles.design).toEqual({
      path: "coordinate",
      leadRole: "UX",
      fallbackLeadRole: "PO"
    });
    expect(result.config.budgetProfile).toBe("standard");
    expect(result.config.budget.runtime.softRunTokens).toBe(BUDGET_PROFILES.standard.budget.runtime.softRunTokens);
    expect(result.config.compaction.backend.retainRecentLines).toBe(
      BUDGET_PROFILES.standard.compaction.backend.retainRecentLines
    );
    expect(result.config.compaction.frontend.retainRecentLines).toBe(
      BUDGET_PROFILES.standard.compaction.frontend.retainRecentLines
    );
  });

  it("applies execution policy overrides from repo config", () => {
    const input = {
      profile: "v1-safe",
      execution: {
        mode: "delegate-with-manual-override",
        allowSupervisorDirectEdits: true,
        requireDelegationLog: false,
        requireAgentWorktreeBinding: false,
        requireDedicatedIntegrationAgent: false,
        integrationAgentLabel: "MERGE"
      },
      protectedPaths: {
        defaultOutcome: "requires-human",
        rules: [{
          ruleId: "allow-docs",
          pathPrefixes: ["docs"],
          outcome: "allow"
        }]
      }
    };

    const result = resolveSupervisorPolicy(input, "inline-test");

    expect(result.valid).toBe(true);
    expect(result.config.execution).toEqual({
      mode: "delegate-with-manual-override",
      allowSupervisorDirectEdits: true,
      requireDelegationLog: false,
      requireAgentWorktreeBinding: false,
      requireDedicatedIntegrationAgent: false,
      integrationAgentLabel: "MERGE"
    });
    expect(result.config.protectedPaths).toEqual({
      defaultOutcome: "requires-human",
      rules: [{
        ruleId: "allow-docs",
        description: undefined,
        pathPrefixes: ["docs"],
        outcome: "allow",
        auditExpectation: undefined
      }]
    });
  });

  it("falls back safely and reports diagnostics for invalid execution config", () => {
    const input = {
      profile: "v2-risky",
      execution: {
        mode: "solo-hacker",
        allowSupervisorDirectEdits: true,
        integrationAgentLabel: ""
      },
      protectedPaths: {
        defaultOutcome: "ship-it",
        rules: [{
          ruleId: "",
          pathPrefixes: [],
          outcome: "allow"
        }]
      },
      budget: {
        governance: {
          escalationThresholdPercent: 120,
          hardStopThresholdPercent: 110
        }
      }
    };

    const result = resolveSupervisorPolicy(input, "inline-invalid-test");

    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((entry) => entry.path)).toEqual(expect.arrayContaining([
      "profile",
      "execution.mode",
      "execution.allowSupervisorDirectEdits",
      "execution.integrationAgentLabel",
      "protectedPaths.defaultOutcome",
      "protectedPaths.rules.0.ruleId",
      "budget.governance.hardStopThresholdPercent"
    ]));
    expect(result.config.profile).toBe("v1-safe");
    expect(result.config.execution).toEqual({
      mode: "delegate-only",
      allowSupervisorDirectEdits: false,
      requireDelegationLog: true,
      requireAgentWorktreeBinding: true,
      requireDedicatedIntegrationAgent: true,
      integrationAgentLabel: "INTEGRATION"
    });
    expect(result.config.protectedPaths.defaultOutcome).toBe("deny");
    expect(result.config.budget.governance.escalationThresholdPercent).toBe(120);
    expect(result.config.budget.governance.hardStopThresholdPercent).toBe(131.25);
  });

  it("accepts additive unknown keys while applying valid documented overrides", () => {
    const result = resolveSupervisorPolicy({
      profile: "v1-safe",
      execution: {
        mode: "delegate-with-manual-override",
        allowSupervisorDirectEdits: true
      },
      budget: {
        runtime: {
          softRunTokens: 7001
        }
      },
      futureCompatibilitySection: {
        enabled: true,
        notes: ["ignored by 0.5.x runtimes"]
      }
    }, "inline-additive-test");

    expect(result.valid).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.config.execution.mode).toBe("delegate-with-manual-override");
    expect(result.config.execution.allowSupervisorDirectEdits).toBe(true);
    expect(result.config.budget.runtime.softRunTokens).toBe(7001);
    expect(result.config.protectedPaths.defaultOutcome).toBe("deny");
  });

  it("loads a repo-local policy file from the standard path", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "supervisor-policy-"));
    const policyPath = join(tempRoot, DEFAULT_SUPERVISOR_POLICY_PATH);
    mkdirSync(join(tempRoot, ".opencode"));
    writeFileSync(policyPath, JSON.stringify({
      profile: "v1-safe",
      execution: {
        mode: "delegate-with-manual-override",
        allowSupervisorDirectEdits: true,
        integrationAgentLabel: "MERGE"
      }
    }));

    const result = loadSupervisorPolicy({ cwd: tempRoot });

    expect(result.valid).toBe(true);
    expect(result.config.execution.mode).toBe("delegate-with-manual-override");
    expect(result.config.execution.allowSupervisorDirectEdits).toBe(true);
    expect(result.config.execution.integrationAgentLabel).toBe("MERGE");
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("fails safe when the repo-local policy file is unreadable JSON", () => {
    const tempRoot = mkdtempSync(join(tmpdir(), "supervisor-policy-invalid-json-"));
    const policyPath = join(tempRoot, DEFAULT_SUPERVISOR_POLICY_PATH);
    mkdirSync(join(tempRoot, ".opencode"));
    writeFileSync(policyPath, "{\n  \"profile\": \"v1-safe\",\n");

    const result = loadSupervisorPolicy({ cwd: tempRoot });

    expect(result.valid).toBe(false);
    expect(result.config.profile).toBe("v1-safe");
    expect(result.config.execution.mode).toBe("delegate-only");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.path).toBe(policyPath);
    expect(result.diagnostics[0]?.message).toContain("Failed to read or parse supervisor policy");
    rmSync(tempRoot, { recursive: true, force: true });
  });

  // --- Budget profile integration tests ---

  describe("budget profile resolution", () => {
    afterEach(() => {
      delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE;
    });

    it("resolves extended profile values when budgetProfile is 'extended'", () => {
      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "extended"
      }, "budget-profile-extended-test");

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("extended");

      const extended = BUDGET_PROFILES.extended;
      expect(result.config.budget.runtime.softRunTokens).toBe(extended.budget.runtime.softRunTokens);
      expect(result.config.budget.runtime.hardRunTokens).toBe(extended.budget.runtime.hardRunTokens);
      expect(result.config.budget.runtime.softStepTokens).toBe(extended.budget.runtime.softStepTokens);
      expect(result.config.budget.runtime.hardStepTokens).toBe(extended.budget.runtime.hardStepTokens);
      expect(result.config.budget.runtime.truncateAtTokens).toBe(extended.budget.runtime.truncateAtTokens);
      expect(result.config.budget.governance.escalationThresholdPercent).toBe(
        extended.budget.governance.escalationThresholdPercent
      );
      expect(result.config.compaction.frontend.triggerTokens).toBe(extended.compaction.frontend.triggerTokens);
      expect(result.config.compaction.backend.retainRecentLines).toBe(extended.compaction.backend.retainRecentLines);
    });

    it("preserves old v1-safe behavior when budgetProfile is 'conservative'", () => {
      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "conservative"
      }, "budget-profile-conservative-test");

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("conservative");

      const conservative = BUDGET_PROFILES.conservative;
      expect(result.config.budget.runtime.softRunTokens).toBe(conservative.budget.runtime.softRunTokens);
      expect(result.config.budget.runtime.hardRunTokens).toBe(conservative.budget.runtime.hardRunTokens);
      expect(result.config.budget.governance.escalationThresholdPercent).toBe(
        conservative.budget.governance.escalationThresholdPercent
      );
      expect(result.config.budget.governance.hardStopThresholdPercent).toBe(
        conservative.budget.governance.hardStopThresholdPercent
      );
      expect(result.config.compaction.frontend.retainRecentLines).toBe(
        conservative.compaction.frontend.retainRecentLines
      );
      expect(result.config.compaction.backend.retainRecentLines).toBe(
        conservative.compaction.backend.retainRecentLines
      );
    });

    it("defaults to 'standard' when budgetProfile is not specified", () => {
      const result = resolveSupervisorPolicy({
        profile: "v1-safe"
      }, "budget-profile-default-test");

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("standard");

      const standard = BUDGET_PROFILES.standard;
      expect(result.config.budget.runtime.softRunTokens).toBe(standard.budget.runtime.softRunTokens);
      expect(result.config.budget.runtime.hardRunTokens).toBe(standard.budget.runtime.hardRunTokens);
      expect(result.config.budget.governance.escalationThresholdPercent).toBe(
        standard.budget.governance.escalationThresholdPercent
      );
      expect(result.config.compaction.frontend.triggerTokens).toBe(standard.compaction.frontend.triggerTokens);
      expect(result.config.compaction.mixed.retainRecentLines).toBe(standard.compaction.mixed.retainRecentLines);
    });

    it("uses explicit budget fields to override profile values", () => {
      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "conservative",
        budget: {
          runtime: {
            softRunTokens: 20000
          }
        },
        compaction: {
          frontend: {
            triggerTokens: 9999
          }
        }
      }, "budget-profile-override-test");

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("conservative");

      // Explicit override takes precedence over profile
      expect(result.config.budget.runtime.softRunTokens).toBe(20000);
      expect(result.config.compaction.frontend.triggerTokens).toBe(9999);

      // Non-overridden fields still use the profile values
      const conservative = BUDGET_PROFILES.conservative;
      expect(result.config.budget.runtime.hardRunTokens).toBe(conservative.budget.runtime.hardRunTokens);
      expect(result.config.budget.runtime.softStepTokens).toBe(conservative.budget.runtime.softStepTokens);
      expect(result.config.compaction.frontend.targetTokens).toBe(conservative.compaction.frontend.targetTokens);
      expect(result.config.compaction.backend.triggerTokens).toBe(conservative.compaction.backend.triggerTokens);
    });

    it("falls back to standard with a diagnostic for an invalid budgetProfile name", () => {
      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "turbo-mode" as any
      }, "budget-profile-invalid-test");

      expect(result.valid).toBe(false);
      expect(result.config.budgetProfile).toBe("standard");

      const standard = BUDGET_PROFILES.standard;
      expect(result.config.budget.runtime.softRunTokens).toBe(standard.budget.runtime.softRunTokens);
      expect(result.config.compaction.frontend.triggerTokens).toBe(standard.compaction.frontend.triggerTokens);

      const budgetDiag = result.diagnostics.find((d) => d.path === "budgetProfile");
      expect(budgetDiag).toBeDefined();
      expect(budgetDiag!.message).toContain("Invalid budget profile");
      expect(budgetDiag!.message).toContain("turbo-mode");
      expect(budgetDiag!.severity).toBe("warning");
    });

    it("uses env var ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE to override policy file value", () => {
      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE = "extended";

      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "conservative"
      }, "budget-profile-env-override-test");

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("extended");

      const extended = BUDGET_PROFILES.extended;
      expect(result.config.budget.runtime.softRunTokens).toBe(extended.budget.runtime.softRunTokens);
      expect(result.config.budget.runtime.hardRunTokens).toBe(extended.budget.runtime.hardRunTokens);
      expect(result.config.compaction.frontend.triggerTokens).toBe(extended.compaction.frontend.triggerTokens);
    });

    it("ignores an invalid env var and falls through to input budgetProfile", () => {
      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE = "mega-budget";

      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "conservative"
      }, "budget-profile-env-invalid-test");

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("conservative");

      const conservative = BUDGET_PROFILES.conservative;
      expect(result.config.budget.runtime.softRunTokens).toBe(conservative.budget.runtime.softRunTokens);
    });

    it("includes budgetProfile in the resolved policy output for runtime logging", () => {
      const result = resolveSupervisorPolicy({
        profile: "v1-safe",
        budgetProfile: "extended"
      }, "budget-profile-output-test");

      expect(result.config).toHaveProperty("budgetProfile");
      expect(result.config.budgetProfile).toBe("extended");
    });

    it("applies standard profile when called with no input (undefined)", () => {
      const result = resolveSupervisorPolicy();

      expect(result.valid).toBe(true);
      expect(result.config.budgetProfile).toBe("standard");

      // The default cloneDefaultPolicy uses getDefaultBudgetProfileName() which returns "standard"
      // but no profile application happens because input is undefined
      // The cloneDefaultPolicy itself doesn't apply profile values; it uses the frozen DEFAULT constants
      // For no-input case, budgetProfile should still be "standard" on the config
      expect(typeof result.config.budget.runtime.softRunTokens).toBe("number");
      expect(result.config.budget.runtime.softRunTokens).toBeGreaterThan(0);
    });
  });
});
