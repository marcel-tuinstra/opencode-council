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
    // Arrange
    const originalCwd = process.cwd();
    const tempRoot = mkdtempSync(join(tmpdir(), "budget-policy-"));
    mkdirSync(join(tempRoot, ".opencode"));
    writeFileSync(join(tempRoot, DEFAULT_SUPERVISOR_POLICY_PATH), JSON.stringify({
      budget: {
        runtime: {
          softRunTokens: 7000
        }
      }
    }));
    process.chdir(tempRoot);
    resetSupervisorPolicyCache();

    // Act
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS = "4100";
    const diagnostics = getBudgetRuntimeConfigDiagnostics();

    // Assert
    expect(diagnostics.values.softRunTokens).toBe(7000);
    expect(diagnostics.provenance.softRunTokens).toBe("policy");
    expect(diagnostics.provenance.hardStepTokens).toBe("env");

    delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS;
    process.chdir(originalCwd);
    resetSupervisorPolicyCache();
    rmSync(tempRoot, { recursive: true, force: true });
  });
});
