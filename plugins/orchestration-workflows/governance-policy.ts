import type { LaneContractViolation } from "./lane-contract";
import { createSupervisorReasonDetail, type SupervisorReasonDetail } from "./reason-codes";
import {
  getSupervisorPolicy,
  type ResolvedSupervisorPolicy,
  type SupervisorGovernanceCheckpointPolicy,
  type SupervisorGovernancePolicyOutcome
} from "./supervisor-config";

export type GovernancePolicyDecisionSource = "explicit-policy" | "policy-default" | "missing-policy";

export type GovernancePolicyRoute = "continue" | "repair-lane" | "escalate-review" | "block-checkpoint";

export type GovernancePolicyRuleMatch = {
  ruleId: string;
  description?: string;
  outcome: SupervisorGovernancePolicyOutcome;
  matchedViolationCodes: readonly string[];
  matchedViolationFields: readonly string[];
};

export type EvaluateGovernancePolicyInput = {
  checkpoint: string;
  violations?: readonly LaneContractViolation[];
  policy?: ResolvedSupervisorPolicy["governance"];
};

export type GovernancePolicyDecision = {
  checkpoint: string;
  outcome: SupervisorGovernancePolicyOutcome;
  route: GovernancePolicyRoute;
  source: GovernancePolicyDecisionSource;
  policyConfigured: boolean;
  policyDefaultOutcome?: SupervisorGovernancePolicyOutcome;
  matchedRules: readonly GovernancePolicyRuleMatch[];
  warnings: readonly string[];
  reasonDetails: readonly SupervisorReasonDetail[];
  reasons: readonly string[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const OUTCOME_PRIORITY: Record<SupervisorGovernancePolicyOutcome, number> = {
  accept: 0,
  repair: 1,
  escalate: 2,
  block: 3
};

const normalizeViolations = (violations?: readonly LaneContractViolation[]): readonly LaneContractViolation[] => freezeList(
  (violations ?? []).map((violation) => Object.freeze({ ...violation }))
);

const resolveRoute = (outcome: SupervisorGovernancePolicyOutcome): GovernancePolicyRoute => {
  switch (outcome) {
    case "accept":
      return "continue";
    case "repair":
      return "repair-lane";
    case "escalate":
      return "escalate-review";
    case "block":
      return "block-checkpoint";
  }
};

const findCheckpointPolicy = (
  checkpoints: readonly SupervisorGovernanceCheckpointPolicy[],
  checkpoint: string
): SupervisorGovernanceCheckpointPolicy | undefined => checkpoints.find((candidate) => candidate.checkpoint === checkpoint);

const matchRule = (
  rule: SupervisorGovernanceCheckpointPolicy["rules"][number],
  violations: readonly LaneContractViolation[]
): GovernancePolicyRuleMatch | null => {
  const matchedViolationCodes = rule.match.violationCodes.filter((code) => violations.some((violation) => violation.code === code));
  const matchedViolationFields = rule.match.violationFields.filter((field) => violations.some((violation) => violation.field === field));

  if (matchedViolationCodes.length === 0 && matchedViolationFields.length === 0) {
    return null;
  }

  return {
    ruleId: rule.ruleId,
    description: rule.description,
    outcome: rule.outcome,
    matchedViolationCodes: freezeList(matchedViolationCodes),
    matchedViolationFields: freezeList(matchedViolationFields)
  };
};

export const evaluateGovernancePolicy = (
  input: EvaluateGovernancePolicyInput
): GovernancePolicyDecision => {
  const checkpoint = input.checkpoint.trim();
  if (!checkpoint) {
    throw new Error("Governance policy evaluation requires a non-empty checkpoint.");
  }

  const policy = input.policy ?? getSupervisorPolicy().governance;
  const violations = normalizeViolations(input.violations);
  const checkpointPolicy = findCheckpointPolicy(policy.checkpoints, checkpoint);

  if (!checkpointPolicy) {
    const warning = `No governance policy is configured for checkpoint '${checkpoint}', so the evaluator recorded a warning and failed open.`;
    const reasonDetails = freezeList([
      createSupervisorReasonDetail("governance.policy-missing", {
        path: checkpoint,
        actionReason: "accept"
      })
    ]);

    return {
      checkpoint,
      outcome: "accept",
      route: "continue",
      source: "missing-policy",
      policyConfigured: false,
      matchedRules: freezeList([]),
      warnings: freezeList([warning]),
      reasonDetails,
      reasons: freezeList([warning, ...reasonDetails.map((detail) => detail.explanation)])
    };
  }

  const matchedRules = freezeList(
    checkpointPolicy.rules
      .map((rule) => matchRule(rule, violations))
      .filter((match): match is GovernancePolicyRuleMatch => match !== null)
  );

  const source: GovernancePolicyDecisionSource = matchedRules.length > 0 ? "explicit-policy" : "policy-default";
  const outcome = matchedRules.length > 0
    ? matchedRules.reduce((current, match) => OUTCOME_PRIORITY[match.outcome] > OUTCOME_PRIORITY[current] ? match.outcome : current, "accept" as SupervisorGovernancePolicyOutcome)
    : checkpointPolicy.defaultOutcome;
  const reasonDetails = freezeList([
    createSupervisorReasonDetail(source === "explicit-policy" ? "governance.explicit-policy" : "governance.policy-default", {
      path: checkpoint,
      actionReason: outcome,
      policyId: matchedRules.map((rule) => rule.ruleId).join(", ") || undefined
    })
  ]);

  return {
    checkpoint,
    outcome,
    route: resolveRoute(outcome),
    source,
    policyConfigured: true,
    policyDefaultOutcome: checkpointPolicy.defaultOutcome,
    matchedRules,
    warnings: freezeList([]),
    reasonDetails,
    reasons: freezeList([
      ...reasonDetails.map((detail) => detail.explanation),
      ...matchedRules.map((rule) => rule.description ?? `Governance rule '${rule.ruleId}' matched and routed this checkpoint to ${rule.outcome}.`)
    ])
  };
};
