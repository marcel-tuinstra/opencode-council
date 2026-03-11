import { describe, expect, it } from "vitest";
import {
  clearSessionBudgetState,
  estimateTokens,
  finalizeBudgetRun,
  recordBudgetUsage
} from "../plugins/orchestration-workflows/budget";

describe("budget governor", () => {
  it("estimates tokens from text length", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("1234")).toBe(1);
    expect(estimateTokens("12345678")).toBe(2);
  });

  it("halts deterministically on hard budget breach", () => {
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS = "5";

    const decision = recordBudgetUsage("session-hard", "backend", "plan", 6);
    expect(decision.action).toBe("halt");
    expect(decision.reason).toContain("hard budget exceeded");

    clearSessionBudgetState("session-hard");
    delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS;
  });

  it("produces p50 and p95 baseline metrics", () => {
    recordBudgetUsage("session-a", "mixed", "plan", 100);
    recordBudgetUsage("session-b", "mixed", "plan", 200);
    recordBudgetUsage("session-c", "mixed", "plan", 400);

    const a = finalizeBudgetRun("session-a");
    const b = finalizeBudgetRun("session-b");
    const c = finalizeBudgetRun("session-c");

    expect(a?.runs).toBe(1);
    expect(b?.runs).toBe(2);
    expect(c?.runs).toBe(3);
    expect(c?.p50Tokens).toBeGreaterThan(0);
    expect(c?.p95Tokens).toBeGreaterThanOrEqual(c?.p50Tokens ?? 0);

    clearSessionBudgetState("session-a");
    clearSessionBudgetState("session-b");
    clearSessionBudgetState("session-c");
  });
});
