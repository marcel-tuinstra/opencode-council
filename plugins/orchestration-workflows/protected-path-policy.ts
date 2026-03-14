import { createSupervisorReasonDetail, type SupervisorReasonDetail } from "./reason-codes";
import { normalizePathList, pathMatchesPolicyPrefix } from "./path-policy";
import {
  getSupervisorPolicy,
  type ResolvedSupervisorPolicy,
  type SupervisorProtectedPathOutcome,
  type SupervisorProtectedPathRule
} from "./supervisor-config";

export type ProtectedPathDecisionSource = "explicit-rule" | "policy-default";

export type ProtectedPathDecisionRuleMatch = {
  path: string;
  outcome: SupervisorProtectedPathOutcome;
  source: ProtectedPathDecisionSource;
  matchedRuleId?: string;
  matchedPrefixes: readonly string[];
  description?: string;
  auditExpectation?: string;
};

export type ProtectedPathPolicyDecision = {
  outcome: SupervisorProtectedPathOutcome;
  evaluatedPaths: readonly string[];
  allowedPaths: readonly string[];
  requiresHumanPaths: readonly string[];
  deniedPaths: readonly string[];
  matches: readonly ProtectedPathDecisionRuleMatch[];
  matchedRuleIds: readonly string[];
  auditExpectations: readonly string[];
  violationCodes: readonly string[];
  reasons: readonly string[];
  reasonDetails: readonly SupervisorReasonDetail[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const OUTCOME_PRIORITY: Record<SupervisorProtectedPathOutcome, number> = {
  allow: 0,
  "requires-human": 1,
  deny: 2
};

const compareRuleSpecificity = (
  left: SupervisorProtectedPathRule,
  right: SupervisorProtectedPathRule
): number => {
  const leftMaxPrefixLength = Math.max(...left.pathPrefixes.map((prefix) => prefix.length));
  const rightMaxPrefixLength = Math.max(...right.pathPrefixes.map((prefix) => prefix.length));

  return leftMaxPrefixLength - rightMaxPrefixLength;
};

const selectBestRule = (
  rules: readonly SupervisorProtectedPathRule[],
  path: string
): { rule?: SupervisorProtectedPathRule; matchedPrefixes: readonly string[] } => {
  const matchingRules = rules
    .map((rule) => ({
      rule,
      matchedPrefixes: rule.pathPrefixes.filter((prefix) => pathMatchesPolicyPrefix(path, prefix))
    }))
    .filter((entry) => entry.matchedPrefixes.length > 0)
    .sort((left, right) => {
      const outcomeDelta = OUTCOME_PRIORITY[right.rule.outcome] - OUTCOME_PRIORITY[left.rule.outcome];
      if (outcomeDelta !== 0) {
        return outcomeDelta;
      }

      return compareRuleSpecificity(right.rule, left.rule);
    });

  const selected = matchingRules[0];
  return {
    rule: selected?.rule,
    matchedPrefixes: selected ? freezeList(selected.matchedPrefixes) : freezeList([])
  };
};

export const evaluateProtectedPathPolicy = (
  changedPaths: readonly string[],
  policy: ResolvedSupervisorPolicy["protectedPaths"] = getSupervisorPolicy().protectedPaths
): ProtectedPathPolicyDecision => {
  const evaluatedPaths = normalizePathList(changedPaths);
  const matches = freezeList(evaluatedPaths.map((path) => {
    const selection = selectBestRule(policy.rules, path);

    return Object.freeze({
      path,
      outcome: selection.rule?.outcome ?? policy.defaultOutcome,
      source: selection.rule ? "explicit-rule" : "policy-default",
      matchedRuleId: selection.rule?.ruleId,
      matchedPrefixes: selection.matchedPrefixes,
      description: selection.rule?.description,
      auditExpectation: selection.rule?.auditExpectation
    } satisfies ProtectedPathDecisionRuleMatch);
  }));

  const allowedPaths = freezeList(matches.filter((match) => match.outcome === "allow").map((match) => match.path));
  const requiresHumanPaths = freezeList(matches.filter((match) => match.outcome === "requires-human").map((match) => match.path));
  const deniedPaths = freezeList(matches.filter((match) => match.outcome === "deny").map((match) => match.path));
  const matchedRuleIds = freezeList(Array.from(new Set(
    matches
      .map((match) => match.matchedRuleId)
      .filter((ruleId): ruleId is string => Boolean(ruleId))
  )));
  const auditExpectations = freezeList(Array.from(new Set(
    matches
      .map((match) => match.auditExpectation)
      .filter((expectation): expectation is string => Boolean(expectation))
  )));

  const outcome: SupervisorProtectedPathOutcome = deniedPaths.length > 0
    ? "deny"
    : requiresHumanPaths.length > 0
      ? "requires-human"
      : "allow";

  if (outcome === "deny") {
    return {
      outcome,
      evaluatedPaths,
      allowedPaths,
      requiresHumanPaths,
      deniedPaths,
      matches,
      matchedRuleIds,
      auditExpectations,
      violationCodes: freezeList(["protected-path-denied"]),
      reasons: freezeList(["Protected-path policy denied one or more changed paths."]),
      reasonDetails: freezeList([createSupervisorReasonDetail("approval.protected-path-denied")])
    };
  }

  if (outcome === "requires-human") {
    return {
      outcome,
      evaluatedPaths,
      allowedPaths,
      requiresHumanPaths,
      deniedPaths,
      matches,
      matchedRuleIds,
      auditExpectations,
      violationCodes: freezeList(["protected-path-requires-human"]),
      reasons: freezeList(["Protected-path policy requires human approval for one or more changed paths."]),
      reasonDetails: freezeList([createSupervisorReasonDetail("approval.protected-path-review")])
    };
  }

  return {
    outcome,
    evaluatedPaths,
    allowedPaths,
    requiresHumanPaths,
    deniedPaths,
    matches,
    matchedRuleIds,
    auditExpectations,
    violationCodes: freezeList([]),
    reasons: freezeList(["Protected-path policy allowed all changed paths."]),
    reasonDetails: freezeList([createSupervisorReasonDetail("approval.protected-path-allowed")])
  };
};
