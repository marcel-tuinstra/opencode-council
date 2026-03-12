import { describe, expect, it } from "vitest";
import {
  assertMergePolicyAllowsAutoMerge,
  evaluateMergePolicy,
  resolveMergePolicy
} from "../plugins/orchestration-workflows/merge-policy";

describe("merge-policy", () => {
  it("defaults to manual human approval under the safe v1 profile", () => {
    const policy = resolveMergePolicy("medium-moderate-risk");
    const decision = evaluateMergePolicy(policy, {
      serviceCriticality: "standard",
      changedPaths: ["docs/runbooks/merge-policy.md"],
      labels: ["automerge"]
    });

    expect(policy.mode).toBe("manual");
    expect(policy.overrideSource).toBe("default");
    expect(decision.status).toBe("requires-human");
    expect(decision.reasons).toEqual(["Merge policy defaults to manual human approval."]);
  });

  it("only allows auto-merge opt-in for large-mature repositories", () => {
    expect(() => resolveMergePolicy("medium-moderate-risk", {
      mode: "auto-merge",
      eligiblePathPrefixes: ["docs"]
    })).toThrow(
      "Auto-merge mode is only available for large-mature repositories with explicit configuration; received medium-moderate-risk."
    );
  });

  it("keeps service-critical changes on human approval by default even in auto-merge mode", () => {
    const policy = resolveMergePolicy("large-mature", {
      mode: "auto-merge",
      eligiblePathPrefixes: ["docs"],
      labelHints: ["automerge"]
    });
    const decision = evaluateMergePolicy(policy, {
      serviceCriticality: "service-critical",
      changedPaths: ["docs/runbooks/merge-policy.md"],
      labels: ["automerge"]
    });

    expect(decision.status).toBe("requires-human");
    expect(decision.matchedLabelHints).toEqual(["automerge"]);
    expect(decision.reasons).toEqual([
      "Service-critical changes require human approval unless the repository explicitly opts in."
    ]);
  });

  it("requires explicit eligible paths before auto-merge can be configured", () => {
    expect(() => resolveMergePolicy("large-mature", {
      mode: "auto-merge"
    })).toThrow("Auto-merge mode requires at least one eligible path prefix.");
  });

  it("enforces blocked and eligible path prefixes before auto-merge", () => {
    const policy = resolveMergePolicy("large-mature", {
      mode: "auto-merge",
      eligiblePathPrefixes: ["docs", "packages/ui"],
      blockedPathPrefixes: ["docs/security"],
      labelHints: ["automerge", "safe-path"]
    });

    const blockedDecision = evaluateMergePolicy(policy, {
      serviceCriticality: "standard",
      changedPaths: ["docs/security/runbook.md"],
      labels: ["automerge"]
    });

    const outOfPolicyDecision = evaluateMergePolicy(policy, {
      serviceCriticality: "standard",
      changedPaths: ["src/index.ts"],
      labels: ["safe-path"]
    });

    expect(blockedDecision.status).toBe("requires-human");
    expect(blockedDecision.blockedPaths).toEqual(["docs/security/runbook.md"]);
    expect(blockedDecision.reasons).toEqual([
      "Blocked paths require human approval even when auto-merge is enabled."
    ]);

    expect(outOfPolicyDecision.status).toBe("requires-human");
    expect(outOfPolicyDecision.outOfPolicyPaths).toEqual(["src/index.ts"]);
    expect(outOfPolicyDecision.matchedLabelHints).toEqual(["safe-path"]);
    expect(outOfPolicyDecision.reasons).toEqual([
      "Changed paths must stay within the configured eligible path prefixes for auto-merge."
    ]);
  });

  it("allows auto-merge only after criticality and path checks pass", () => {
    const policy = resolveMergePolicy("large-mature", {
      mode: "auto-merge",
      eligiblePathPrefixes: ["docs", "packages/ui"],
      blockedPathPrefixes: ["docs/security"],
      labelHints: ["automerge"]
    });
    const candidate = {
      serviceCriticality: "standard" as const,
      changedPaths: ["packages/ui/button.ts"],
      labels: ["automerge", "release-note"]
    };
    const decision = evaluateMergePolicy(policy, candidate);

    expect(decision.status).toBe("eligible-for-auto-merge");
    expect(decision.matchedLabelHints).toEqual(["automerge"]);
    expect(decision.reasons).toEqual([
      "Label hints matched, but path and criticality checks remained the primary merge gate."
    ]);
    expect(() => assertMergePolicyAllowsAutoMerge(policy, candidate)).not.toThrow();
  });

  it("rejects merge candidates that do not include changed paths", () => {
    const policy = resolveMergePolicy("large-mature", {
      mode: "auto-merge",
      eligiblePathPrefixes: ["docs"]
    });

    expect(() => evaluateMergePolicy(policy, {
      serviceCriticality: "standard",
      changedPaths: []
    })).toThrow("Merge policy candidate requires at least one changed path.");
  });
});
