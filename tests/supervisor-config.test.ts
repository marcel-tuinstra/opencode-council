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
    const result = resolveSupervisorPolicy();

    expect(result.valid).toBe(true);
    expect(result.config.profile).toBe("v1-safe");
    expect(result.config.roleAliases.developer).toBe("DEV");
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
    expect(result.config.compaction.backend.retainRecentLines).toBe(3);
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
});
