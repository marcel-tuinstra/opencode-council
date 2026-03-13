import type { RepoRiskTier } from "./lane-lifecycle";
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
  status: "requires-human" | "eligible-for-auto-merge";
  resolvedMode: MergePolicyMode;
  matchedLabelHints: readonly string[];
  blockedPaths: readonly string[];
  outOfPolicyPaths: readonly string[];
  reasons: readonly string[];
  reasonDetails: readonly SupervisorReasonDetail[];
};

export const DEFAULT_MERGE_POLICY_MODE: "manual" = "manual";

const normalizeStringList = (values?: readonly string[]): readonly string[] => {
  if (!values) {
    return [];
  }

  const normalized = values
    .map((value) => value.trim())
    .filter(Boolean);

  return Object.freeze([...new Set(normalized)]);
};

const normalizePrefix = (prefix: string): string => prefix.replace(/^\.\//, "").replace(/\/+$/, "");

const pathMatchesPrefix = (path: string, prefix: string): boolean => {
  const normalizedPath = path.replace(/^\.\//, "");
  const normalizedPrefix = normalizePrefix(prefix);

  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
};

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
  const eligiblePathPrefixes = normalizeStringList(config?.eligiblePathPrefixes);
  const blockedPathPrefixes = normalizeStringList(config?.blockedPathPrefixes);
  const labelHints = normalizeStringList(config?.labelHints);

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
  const changedPaths = normalizeStringList(candidate.changedPaths);
  const labels = normalizeStringList(candidate.labels);

  assertCandidatePaths(changedPaths);

  const matchedLabelHints = labels.filter((label) => policy.labelHints.includes(label));
  const blockedPaths = changedPaths.filter((path) => policy.blockedPathPrefixes.some((prefix) => pathMatchesPrefix(path, prefix)));
  const outOfPolicyPaths = policy.eligiblePathPrefixes.length === 0
    ? []
    : changedPaths.filter((path) => !policy.eligiblePathPrefixes.some((prefix) => pathMatchesPrefix(path, prefix)));

  if (policy.mode === "manual") {
    return {
      status: "requires-human",
      resolvedMode: policy.mode,
      matchedLabelHints,
      blockedPaths,
      outOfPolicyPaths,
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
      reasons: ["Changed paths must stay within the configured eligible path prefixes for auto-merge."],
      reasonDetails: [createSupervisorReasonDetail("approval.eligible-path-review")]
    };
  }

  return {
    status: "eligible-for-auto-merge",
    resolvedMode: policy.mode,
    matchedLabelHints,
    blockedPaths,
    outOfPolicyPaths,
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
