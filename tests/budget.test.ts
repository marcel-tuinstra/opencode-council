import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  clearSessionBudgetState,
  estimateTokens,
  finalizeBudgetRun,
  getBudgetRuntimeConfigDiagnostics,
  recordBudgetUsage
} from "../plugins/orchestration-workflows/budget";
import {
  DEFAULT_SUPERVISOR_POLICY_PATH,
  resetSupervisorPolicyCache
} from "../plugins/orchestration-workflows/supervisor-config";

describe("budget governor", () => {
  it("estimates tokens from text length", () => {
    // Arrange

    // Act
    const emptyEstimate = estimateTokens("");
    const shortEstimate = estimateTokens("1234");
    const longerEstimate = estimateTokens("12345678");

    // Assert
    expect(emptyEstimate).toBe(0);
    expect(shortEstimate).toBe(1);
    expect(longerEstimate).toBe(2);
  });

  it("halts deterministically on hard budget breach", () => {
    // Arrange
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS = "5";

    // Act
    const decision = recordBudgetUsage("session-hard", "backend", "plan", 6);

    // Assert
    expect(decision.action).toBe("halt");
    expect(decision.reason).toContain("hard budget exceeded");
    expect(decision.reasonCode).toBe("budget.hard-stop");
    expect(decision.remediation.length).toBeGreaterThan(0);

    clearSessionBudgetState("session-hard");
    delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS;
  });

  it("produces p50 and p95 baseline metrics", () => {
    // Arrange
    recordBudgetUsage("session-a", "mixed", "plan", 100);
    recordBudgetUsage("session-b", "mixed", "plan", 200);
    recordBudgetUsage("session-c", "mixed", "plan", 400);

    // Act
    const a = finalizeBudgetRun("session-a");
    const b = finalizeBudgetRun("session-b");
    const c = finalizeBudgetRun("session-c");

    // Assert
    expect(a?.runs).toBe(1);
    expect(b?.runs).toBe(2);
    expect(c?.runs).toBe(3);
    expect(c?.p50Tokens).toBeGreaterThan(0);
    expect(c?.p95Tokens).toBeGreaterThanOrEqual(c?.p50Tokens ?? 0);

    clearSessionBudgetState("session-a");
    clearSessionBudgetState("session-b");
    clearSessionBudgetState("session-c");
  });

  it("reports budget config provenance for defaults, policy, and env overrides", () => {
    const originalCwd = process.cwd();
    const tempRoot = mkdtempSync(join(tmpdir(), "budget-policy-"));
    try {
      mkdirSync(join(tempRoot, ".opencode"));
      writeFileSync(join(tempRoot, DEFAULT_SUPERVISOR_POLICY_PATH), JSON.stringify({
        budget: {
          runtime: {
            softRunTokens: 7000,
            hardRunTokens: 9100,
            truncateAtTokens: 1500
          }
        }
      }));
      process.chdir(tempRoot);
      resetSupervisorPolicyCache();

      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS = "4100";

      const diagnostics = getBudgetRuntimeConfigDiagnostics();

      expect(diagnostics.values.hardStepTokens).toBe(4100);
      expect(diagnostics.provenance.hardStepTokens).toBe("env");
      expect(diagnostics.values.softRunTokens).toBe(7000);
      expect(diagnostics.provenance.softRunTokens).toBe("policy");
      expect(diagnostics.values.hardRunTokens).toBe(9100);
      expect(diagnostics.provenance.hardRunTokens).toBe("policy");
      expect(diagnostics.values.softStepTokens).toBe(5600);
      expect(diagnostics.provenance.softStepTokens).toBe("policy");
      expect(diagnostics.values.truncateAtTokens).toBe(1500);
      expect(diagnostics.provenance.truncateAtTokens).toBe("policy");
    } finally {
      delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS;
      process.chdir(originalCwd);
      resetSupervisorPolicyCache();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("falls back to the repo policy value when an env override is invalid", () => {
    const originalCwd = process.cwd();
    const tempRoot = mkdtempSync(join(tmpdir(), "budget-policy-invalid-env-"));

    try {
      mkdirSync(join(tempRoot, ".opencode"));
      writeFileSync(join(tempRoot, DEFAULT_SUPERVISOR_POLICY_PATH), JSON.stringify({
        budget: {
          runtime: {
            softRunTokens: 7100
          }
        }
      }));
      process.chdir(tempRoot);
      resetSupervisorPolicyCache();

      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_RUN_TOKENS = "not-a-number";

      const diagnostics = getBudgetRuntimeConfigDiagnostics();

      expect(diagnostics.values.softRunTokens).toBe(7100);
      expect(diagnostics.provenance.softRunTokens).toBe("policy");
    } finally {
      delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_RUN_TOKENS;
      process.chdir(originalCwd);
      resetSupervisorPolicyCache();
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
