import type { RepoRiskTier } from "./lane-lifecycle";
import { normalizePathList, normalizePathPrefixList, pathMatchesPolicyPrefix } from "./path-policy";
import { evaluateProtectedPathPolicy } from "./protected-path-policy";
import { createSupervisorReasonDetail, type SupervisorReasonDetail } from "./reason-codes";
import { getSupervisorPolicy } from "./supervisor-config";

export type MergePolicyMode = "manual" | "auto-merge";

export type MergeTargetCriticality = "service-critical" | "standard";

export type MergePolicyConfig = {
  mode?: MergePolicyMode;
  allowServiceCriticalAutoMerge?: boolean;
  eligiblePathPrefixes?: readonly string[];
  blockedPathPrefixes?: readonly string[];
  labelHints?: readonly string[];
};

export type MergePolicy = {
  repoRiskTier: RepoRiskTier;
  defaultMode: "manual";
  mode: MergePolicyMode;
  overrideSource: "default" | "explicit-config";
  allowServiceCriticalAutoMerge: boolean;
  eligiblePathPrefixes: readonly string[];
  blockedPathPrefixes: readonly string[];
  labelHints: readonly string[];
};

export type MergePolicyCandidate = {
  serviceCriticality: MergeTargetCriticality;
  changedPaths: readonly string[];
  labels?: readonly string[];
};

export type MergePolicyDecision = {
  status: "denied" | "requires-human" | "eligible-for-auto-merge";
  resolvedMode: MergePolicyMode;
  matchedLabelHints: readonly string[];
  blockedPaths: readonly string[];
  outOfPolicyPaths: readonly string[];
  protectedPathOutcome: "allow" | "requires-human" | "deny";
  protectedPaths: readonly string[];
  deniedPaths: readonly string[];
  protectedPathAuditExpectations: readonly string[];
  reasons: readonly string[];
  reasonDetails: readonly SupervisorReasonDetail[];
};

export const DEFAULT_MERGE_POLICY_MODE: "manual" = "manual";

const assertAutoMergeAllowedForTier = (repoRiskTier: RepoRiskTier): void => {
  if (repoRiskTier !== "large-mature") {
    throw new Error(
      `Auto-merge mode is only available for large-mature repositories with explicit configuration; received ${repoRiskTier}.`
    );
  }
};

const assertEligiblePathPrefixes = (eligiblePathPrefixes: readonly string[]): void => {
  if (eligiblePathPrefixes.length === 0) {
    throw new Error("Auto-merge mode requires at least one eligible path prefix.");
  }
};

const assertCandidatePaths = (changedPaths: readonly string[]): void => {
  if (changedPaths.length === 0) {
    throw new Error("Merge policy candidate requires at least one changed path.");
  }
};

export const resolveMergePolicy = (
  repoRiskTier: RepoRiskTier,
  config?: MergePolicyConfig
): MergePolicy => {
  const supervisorPolicy = getSupervisorPolicy();
  const mode = config?.mode ?? supervisorPolicy.approvalGates.mergeMode;
  const eligiblePathPrefixes = normalizePathPrefixList(config?.eligiblePathPrefixes);
  const blockedPathPrefixes = normalizePathPrefixList(config?.blockedPathPrefixes);
  const labelHints = normalizePathList(config?.labelHints);

  if (mode === "auto-merge") {
    assertAutoMergeAllowedForTier(repoRiskTier);
    assertEligiblePathPrefixes(eligiblePathPrefixes);
  }

  return {
    repoRiskTier,
    defaultMode: DEFAULT_MERGE_POLICY_MODE,
    mode,
    overrideSource: config?.mode === undefined ? "default" : "explicit-config",
    allowServiceCriticalAutoMerge: config?.allowServiceCriticalAutoMerge ?? supervisorPolicy.approvalGates.allowServiceCriticalAutoMerge,
    eligiblePathPrefixes,
    blockedPathPrefixes,
    labelHints
  };
};

export const evaluateMergePolicy = (
  policy: MergePolicy,
  candidate: MergePolicyCandidate
): MergePolicyDecision => {
  const changedPaths = normalizePathList(candidate.changedPaths);
  const labels = normalizePathList(candidate.labels);

  assertCandidatePaths(changedPaths);

  const matchedLabelHints = labels.filter((label) => policy.labelHints.includes(label));
  const protectedPathDecision = evaluateProtectedPathPolicy(changedPaths);
  const blockedPaths = changedPaths.filter((path) => policy.blockedPathPrefixes.some((prefix) => pathMatchesPolicyPrefix(path, prefix)));
  const outOfPolicyPaths = policy.eligiblePathPrefixes.length === 0
    ? []
    : changedPaths.filter((path) => !policy.eligiblePathPrefixes.some((prefix) => pathMatchesPolicyPrefix(path, prefix)));

  if (protectedPathDecision.outcome === "deny") {
    return {
      status: "denied",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
      protectedPathOutcome: protectedPathDecision.outcome,
      protectedPaths: protectedPathDecision.requiresHumanPaths,
      deniedPaths: protectedPathDecision.deniedPaths,
      protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
      reasons: ["Protected-path policy denied one or more changed paths from autonomous merge handling."],
      reasonDetails: [createSupervisorReasonDetail("approval.protected-path-denied")]
    };
  }

  if (policy.mode === "manual") {
    return {
      status: "requires-human",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
      protectedPathOutcome: protectedPathDecision.outcome,
      protectedPaths: protectedPathDecision.requiresHumanPaths,
      deniedPaths: protectedPathDecision.deniedPaths,
      protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
      reasons: ["Merge policy defaults to manual human approval."],
      reasonDetails: [createSupervisorReasonDetail("approval.manual-review-default")]
    };
  }

  if (candidate.serviceCriticality === "service-critical" && !policy.allowServiceCriticalAutoMerge) {
    return {
      status: "requires-human",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
      protectedPathOutcome: protectedPathDecision.outcome,
      protectedPaths: protectedPathDecision.requiresHumanPaths,
      deniedPaths: protectedPathDecision.deniedPaths,
      protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
      reasons: ["Service-critical changes require human approval unless the repository explicitly opts in."],
      reasonDetails: [createSupervisorReasonDetail("approval.service-critical-review")]
    };
  }

  if (blockedPaths.length > 0) {
    return {
      status: "requires-human",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
      protectedPathOutcome: protectedPathDecision.outcome,
      protectedPaths: protectedPathDecision.requiresHumanPaths,
      deniedPaths: protectedPathDecision.deniedPaths,
      protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
      reasons: ["Blocked paths require human approval even when auto-merge is enabled."],
      reasonDetails: [createSupervisorReasonDetail("approval.blocked-path-review")]
    };
  }

  if (outOfPolicyPaths.length > 0) {
    return {
      status: "requires-human",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
      protectedPathOutcome: protectedPathDecision.outcome,
      protectedPaths: protectedPathDecision.requiresHumanPaths,
      deniedPaths: protectedPathDecision.deniedPaths,
      protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
      reasons: ["Changed paths must stay within the configured eligible path prefixes for auto-merge."],
      reasonDetails: [createSupervisorReasonDetail("approval.eligible-path-review")]
    };
  }

  if (protectedPathDecision.outcome === "requires-human") {
    return {
      status: "requires-human",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
      protectedPathOutcome: protectedPathDecision.outcome,
      protectedPaths: protectedPathDecision.requiresHumanPaths,
      deniedPaths: protectedPathDecision.deniedPaths,
      protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
      reasons: ["Protected-path policy requires a human exception before these paths can merge."],
      reasonDetails: [createSupervisorReasonDetail("approval.protected-path-review")]
    };
  }

  return {
    status: "eligible-for-auto-merge",
    resolvedMode: policy.mode,
    matchedLabelHints,
    blockedPaths,
    outOfPolicyPaths,
    protectedPathOutcome: protectedPathDecision.outcome,
    protectedPaths: protectedPathDecision.requiresHumanPaths,
    deniedPaths: protectedPathDecision.deniedPaths,
    protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
    reasons: matchedLabelHints.length > 0
      ? ["Label hints matched, but path and criticality checks remained the primary merge gate."]
      : ["Auto-merge is allowed because the repository opted in and all policy checks passed."],
    reasonDetails: [createSupervisorReasonDetail("approval.auto-merge-allowed")]
  };
};

export const assertMergePolicyAllowsAutoMerge = (
  policy: MergePolicy,
  candidate: MergePolicyCandidate
): void => {
  const decision = evaluateMergePolicy(policy, candidate);

  if (decision.status !== "eligible-for-auto-merge") {
    throw new Error(`Merge policy requires human approval: ${decision.reasons.join(" ")}`);
  }
};
