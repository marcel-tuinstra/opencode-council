import { DEFAULT_SUPERVISOR_BUDGET, getSupervisorPolicy } from "./supervisor-config";
import {
  createSupervisorThresholdEventId,
  type SupervisorThresholdEvent
} from "./guardrail-thresholds";
import { createSupervisorReasonDetail, type SupervisorReasonDetail } from "./reason-codes";

export type BudgetGovernanceScope = "run" | "step";

export type BudgetGovernanceRecommendation =
  | "continue-with-watch"
  | "compact-context"
  | "reduce-scope"
  | "reduce-active-lanes"
  | "request-checkpoint-review"
  | "enable-hard-stop-for-runaway-risk";

export type BudgetGovernanceRequirement =
  | "justify-budget-overrun"
  | "record-scope-or-lane-reduction"
  | "schedule-checkpoint-review";

export type BudgetGovernanceStatus =
  | "within-budget"
  | "warning"
  | "escalation-required"
  | "hard-stop";

export type BudgetGovernanceThreshold = {
  kind: "warning" | "escalation" | "hard-stop";
  usagePercent: number;
  reason: string;
};

export type BudgetGovernanceConfig = {
  warningThresholdPercents?: readonly number[];
  escalationThresholdPercent?: number;
  hardStopEnabled?: boolean;
  hardStopThresholdPercent?: number;
};

export type BudgetGovernancePolicy = {
  defaultHardStopEnabled: false;
  hardStopEnabled: boolean;
  warningThresholdPercents: readonly number[];
  escalationThresholdPercent: number;
  hardStopThresholdPercent: number;
  overrideSource: "default" | "explicit-config";
};

export type BudgetGovernanceInput = {
  scope: BudgetGovernanceScope;
  usedTokens: number;
  budgetTokens: number;
};

export type BudgetGovernanceDecision = {
  scope: BudgetGovernanceScope;
  status: BudgetGovernanceStatus;
  usedTokens: number;
  budgetTokens: number;
  usagePercent: number;
  triggeredThresholds: readonly BudgetGovernanceThreshold[];
  recommendations: readonly BudgetGovernanceRecommendation[];
  requiredActions: readonly BudgetGovernanceRequirement[];
  shouldPauseAutomation: boolean;
  reasonDetails: readonly SupervisorReasonDetail[];
  decisionEvidence: {
    overrideSource: BudgetGovernancePolicy["overrideSource"];
    hardStopEnabled: boolean;
    warningThresholdPercents: readonly number[];
    escalationThresholdPercent: number;
    hardStopThresholdPercent: number;
    usedTokens: number;
    budgetTokens: number;
    usagePercent: number;
  };
  thresholdEvents: readonly SupervisorThresholdEvent[];
};

export const DEFAULT_WARNING_THRESHOLD_PERCENTS = Object.freeze([...DEFAULT_SUPERVISOR_BUDGET.governance.warningThresholdPercents]);
export const DEFAULT_ESCALATION_THRESHOLD_PERCENT = DEFAULT_SUPERVISOR_BUDGET.governance.escalationThresholdPercent;
export const DEFAULT_HARD_STOP_THRESHOLD_PERCENT = DEFAULT_SUPERVISOR_BUDGET.governance.hardStopThresholdPercent;

const normalizeThresholdPercents = (thresholds?: readonly number[]): readonly number[] => {
  const normalized = (thresholds ?? DEFAULT_WARNING_THRESHOLD_PERCENTS)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Number(value.toFixed(2)));

  return Object.freeze([...new Set(normalized)].sort((a, b) => a - b));
};

const assertThresholdPercent = (label: string, value: number): void => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
};

const assertBudgetInput = (input: BudgetGovernanceInput): void => {
  if (!Number.isFinite(input.usedTokens) || input.usedTokens < 0) {
    throw new Error(`Invalid used token count: ${input.usedTokens}`);
  }

  if (!Number.isFinite(input.budgetTokens) || input.budgetTokens <= 0) {
    throw new Error(`Invalid budget token count: ${input.budgetTokens}`);
  }
};

const buildThresholdReason = (
  kind: BudgetGovernanceThreshold["kind"],
  usagePercent: number,
  scope: BudgetGovernanceScope
): string => {
  if (kind === "hard-stop") {
    return `${scope} usage reached the explicit hard-stop runaway threshold.`;
  }

  if (kind === "escalation") {
    return `${scope} usage exceeded ${usagePercent}% of the active budget and requires escalation.`;
  }

  return usagePercent >= 100
    ? `${scope} usage exhausted the active budget and should narrow before continuing.`
    : `${scope} usage crossed the early warning threshold and should stay under watch.`;
};

const hasExplicitOverride = (config?: BudgetGovernanceConfig): boolean => {
  if (!config) {
    return false;
  }

  return config.warningThresholdPercents !== undefined
    || config.escalationThresholdPercent !== undefined
    || config.hardStopEnabled !== undefined
    || config.hardStopThresholdPercent !== undefined;
};

export const resolveBudgetGovernancePolicy = (
  config?: BudgetGovernanceConfig
): BudgetGovernancePolicy => {
  const supervisorGovernance = getSupervisorPolicy().budget.governance;
  const warningThresholdPercents = normalizeThresholdPercents(
    config?.warningThresholdPercents ?? supervisorGovernance.warningThresholdPercents
  );
  const escalationThresholdPercent = config?.escalationThresholdPercent ?? supervisorGovernance.escalationThresholdPercent;
  const hardStopThresholdPercent = config?.hardStopThresholdPercent ?? supervisorGovernance.hardStopThresholdPercent;

  if (warningThresholdPercents.length === 0) {
    throw new Error("Budget governance policy requires at least one warning threshold.");
  }

  assertThresholdPercent("escalation threshold percent", escalationThresholdPercent);
  assertThresholdPercent("hard-stop threshold percent", hardStopThresholdPercent);

  if (hardStopThresholdPercent < escalationThresholdPercent) {
    throw new Error(
      `Hard-stop threshold must be greater than or equal to escalation threshold; received ${hardStopThresholdPercent} < ${escalationThresholdPercent}.`
    );
  }

  return {
    defaultHardStopEnabled: false,
    hardStopEnabled: config?.hardStopEnabled ?? supervisorGovernance.hardStopEnabled,
    warningThresholdPercents,
    escalationThresholdPercent,
    hardStopThresholdPercent,
    overrideSource: hasExplicitOverride(config) ? "explicit-config" : "default"
  };
};

export const evaluateBudgetGovernance = (
  policy: BudgetGovernancePolicy,
  input: BudgetGovernanceInput
): BudgetGovernanceDecision => {
  assertBudgetInput(input);

  const usagePercent = Number(((input.usedTokens / input.budgetTokens) * 100).toFixed(2));
  const triggeredWarnings = policy.warningThresholdPercents
    .filter((threshold) => usagePercent >= threshold)
    .map((threshold) => ({
      kind: threshold >= policy.escalationThresholdPercent ? "escalation" : "warning",
      usagePercent: threshold,
      reason: buildThresholdReason(
        threshold >= policy.escalationThresholdPercent ? "escalation" : "warning",
        threshold,
        input.scope
      )
    } satisfies BudgetGovernanceThreshold));

  const triggeredThresholds = policy.hardStopEnabled && usagePercent >= policy.hardStopThresholdPercent
    ? [...triggeredWarnings, {
      kind: "hard-stop",
      usagePercent: policy.hardStopThresholdPercent,
      reason: buildThresholdReason("hard-stop", policy.hardStopThresholdPercent, input.scope)
    } satisfies BudgetGovernanceThreshold]
    : triggeredWarnings;
  const decisionEvidence = Object.freeze({
    overrideSource: policy.overrideSource,
    hardStopEnabled: policy.hardStopEnabled,
    warningThresholdPercents: [...policy.warningThresholdPercents],
    escalationThresholdPercent: policy.escalationThresholdPercent,
    hardStopThresholdPercent: policy.hardStopThresholdPercent,
    usedTokens: input.usedTokens,
    budgetTokens: input.budgetTokens,
    usagePercent
  });
  const thresholdEvents = Object.freeze(triggeredThresholds.map((threshold) => ({
    eventId: createSupervisorThresholdEventId(
      "budget-governance",
      input.scope,
      threshold.kind,
      threshold.usagePercent,
      usagePercent
    ),
    guardrail: "budget-governance",
    thresholdKey: `${input.scope}-${threshold.kind}-percent`,
    status: "triggered",
    thresholdValue: threshold.usagePercent,
    observedValue: usagePercent,
    reasonCode: threshold.kind === "hard-stop"
      ? "budget.hard-stop"
      : threshold.kind === "escalation"
        ? "budget.escalation-required"
        : "budget.warning-threshold",
    summary: threshold.reason,
    evidence: decisionEvidence
  } satisfies SupervisorThresholdEvent)));

  if (policy.hardStopEnabled && usagePercent >= policy.hardStopThresholdPercent) {
    return {
      scope: input.scope,
      status: "hard-stop",
      usedTokens: input.usedTokens,
      budgetTokens: input.budgetTokens,
      usagePercent,
      triggeredThresholds,
      recommendations: ["enable-hard-stop-for-runaway-risk"],
      requiredActions: [],
      shouldPauseAutomation: true,
      reasonDetails: [createSupervisorReasonDetail("budget.hard-stop", { usagePercent })],
      decisionEvidence,
      thresholdEvents
    };
  }

  if (usagePercent >= policy.escalationThresholdPercent) {
    return {
      scope: input.scope,
      status: "escalation-required",
      usedTokens: input.usedTokens,
      budgetTokens: input.budgetTokens,
      usagePercent,
      triggeredThresholds,
      recommendations: [
        "reduce-scope",
        "reduce-active-lanes",
        "request-checkpoint-review",
        "enable-hard-stop-for-runaway-risk"
      ],
      requiredActions: [
        "justify-budget-overrun",
        "record-scope-or-lane-reduction",
        "schedule-checkpoint-review"
      ],
      shouldPauseAutomation: true,
      reasonDetails: [createSupervisorReasonDetail("budget.escalation-required", { usagePercent })],
      decisionEvidence,
      thresholdEvents
    };
  }

  if (triggeredWarnings.length > 0) {
    const recommendations: readonly BudgetGovernanceRecommendation[] = usagePercent >= 100
      ? ["compact-context", "reduce-scope", "reduce-active-lanes"]
      : ["continue-with-watch", "compact-context"];

    return {
      scope: input.scope,
      status: "warning",
      usedTokens: input.usedTokens,
      budgetTokens: input.budgetTokens,
      usagePercent,
      triggeredThresholds,
      recommendations,
      requiredActions: [],
      shouldPauseAutomation: false,
      reasonDetails: [createSupervisorReasonDetail("budget.warning-threshold", { usagePercent })],
      decisionEvidence,
      thresholdEvents
    };
  }

  return {
    scope: input.scope,
    status: "within-budget",
    usedTokens: input.usedTokens,
    budgetTokens: input.budgetTokens,
    usagePercent,
    triggeredThresholds: [],
    recommendations: ["continue-with-watch"],
    requiredActions: [],
    shouldPauseAutomation: false,
    reasonDetails: [],
    decisionEvidence,
    thresholdEvents: []
  };
};
