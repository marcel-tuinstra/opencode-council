import type { Intent } from "./types";
import { debugLog } from "./debug";
import {
  DEFAULT_SUPERVISOR_BUDGET,
  getSupervisorPolicy
} from "./supervisor-config";
import type { SupervisorReasonCode } from "./reason-codes";

export type WorkflowStep = "plan" | "execute" | "summarize";
type BudgetAction = "allow" | "compact" | "truncate" | "halt";

type BudgetConfig = {
  softRunTokens: number;
  hardRunTokens: number;
  softStepTokens: number;
  hardStepTokens: number;
  truncateAtTokens: number;
  costPer1kTokensUsd: number;
  stepExecutionTokenCost: number;
};

export type BudgetConfigSource = "default" | "policy" | "env";

export type BudgetRuntimeConfigDiagnostics = {
  values: BudgetConfig;
  provenance: Record<keyof BudgetConfig, BudgetConfigSource>;
};

type BudgetState = {
  intent: Intent;
  config: BudgetRuntimeConfigDiagnostics;
  runTokens: number;
  runCostUsd: number;
  stepTokens: Record<WorkflowStep, number>;
  stepCostUsd: Record<WorkflowStep, number>;
  events: Array<{ step: WorkflowStep; action: BudgetAction; reason: string }>;
};

type BudgetDecision = {
  action: BudgetAction;
  reason: string;
  reasonCode: SupervisorReasonCode | null;
  remediation: string[];
  usagePercent: number;
  session: BudgetState;
};

type BaselineStats = {
  p50Tokens: number;
  p95Tokens: number;
  runs: number;
};

const WORKFLOW_MULTIPLIERS: Record<Intent, number> = {
  frontend: 1.05,
  backend: 1.1,
  design: 0.95,
  marketing: 0.9,
  roadmap: 1,
  research: 1.05,
  mixed: 1
};

const budgetBySession = new Map<string, BudgetState>();
const runHistoryByIntent = new Map<Intent, number[]>();

const readNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const resolveBudgetValue = (
  envValue: string | undefined,
  policyValue: number,
  defaultValue: number
): { value: number; source: BudgetConfigSource } => {
  if (envValue !== undefined) {
    return {
      value: readNumber(envValue, policyValue),
      source: "env"
    };
  }

  if (policyValue !== defaultValue) {
    return { value: policyValue, source: "policy" };
  }

  return { value: defaultValue, source: "default" };
};

export const getBudgetRuntimeConfigDiagnostics = (): BudgetRuntimeConfigDiagnostics => {
  const runtimePolicy = getSupervisorPolicy().budget.runtime;
  const defaults = DEFAULT_SUPERVISOR_BUDGET.runtime;

  const softRunTokens = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_RUN_TOKENS,
    runtimePolicy.softRunTokens,
    defaults.softRunTokens
  );
  const hardRunTokens = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_RUN_TOKENS,
    runtimePolicy.hardRunTokens,
    defaults.hardRunTokens
  );
  const softStepTokens = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_STEP_TOKENS,
    runtimePolicy.softStepTokens,
    defaults.softStepTokens
  );
  const hardStepTokens = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS,
    runtimePolicy.hardStepTokens,
    defaults.hardStepTokens
  );
  const truncateAtTokens = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_TRUNCATE_TOKENS,
    runtimePolicy.truncateAtTokens,
    defaults.truncateAtTokens
  );
  const costPer1kTokensUsd = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_BUDGET_COST_PER_1K_USD,
    runtimePolicy.costPer1kTokensUsd,
    defaults.costPer1kTokensUsd
  );
  const stepExecutionTokenCost = resolveBudgetValue(
    process.env.ORCHESTRATION_WORKFLOWS_EXECUTE_STEP_TOKEN_COST,
    runtimePolicy.stepExecutionTokenCost,
    defaults.stepExecutionTokenCost
  );

  return {
    values: {
      softRunTokens: softRunTokens.value,
      hardRunTokens: hardRunTokens.value,
      softStepTokens: softStepTokens.value,
      hardStepTokens: hardStepTokens.value,
      truncateAtTokens: truncateAtTokens.value,
      costPer1kTokensUsd: costPer1kTokensUsd.value,
      stepExecutionTokenCost: stepExecutionTokenCost.value
    },
    provenance: {
      softRunTokens: softRunTokens.source,
      hardRunTokens: hardRunTokens.source,
      softStepTokens: softStepTokens.source,
      hardStepTokens: hardStepTokens.source,
      truncateAtTokens: truncateAtTokens.source,
      costPer1kTokensUsd: costPer1kTokensUsd.source,
      stepExecutionTokenCost: stepExecutionTokenCost.source
    }
  };
};

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index];
};

const stepThreshold = (threshold: number, intent: Intent): number => {
  return Math.max(1, Math.floor(threshold * (WORKFLOW_MULTIPLIERS[intent] ?? 1)));
};

const buildInitialState = (intent: Intent, config: BudgetRuntimeConfigDiagnostics): BudgetState => ({
  intent,
  config,
  runTokens: 0,
  runCostUsd: 0,
  stepTokens: { plan: 0, execute: 0, summarize: 0 },
  stepCostUsd: { plan: 0, execute: 0, summarize: 0 },
  events: []
});

export const estimateTokens = (text: string): number => {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.ceil(normalized.length / 4);
};

export const recordBudgetUsage = (
  sessionID: string,
  intent: Intent,
  step: WorkflowStep,
  tokens: number
): BudgetDecision => {
  const configDiagnostics = getBudgetRuntimeConfigDiagnostics();
  const config = configDiagnostics.values;
  const state = budgetBySession.get(sessionID) ?? buildInitialState(intent, configDiagnostics);

  const positiveTokens = Math.max(0, Math.floor(tokens));
  const cost = (positiveTokens / 1000) * config.costPer1kTokensUsd;

  state.intent = intent;
  state.runTokens += positiveTokens;
  state.runCostUsd += cost;
  state.stepTokens[step] += positiveTokens;
  state.stepCostUsd[step] += cost;

  const hardRun = stepThreshold(config.hardRunTokens, intent);
  const softRun = stepThreshold(config.softRunTokens, intent);
  const hardStep = stepThreshold(config.hardStepTokens, intent);
  const softStep = stepThreshold(config.softStepTokens, intent);
  const usagePercent = Number((Math.max(
    hardRun > 0 ? (state.runTokens / hardRun) * 100 : 0,
    hardStep > 0 ? (state.stepTokens[step] / hardStep) * 100 : 0
  )).toFixed(2));

  let action: BudgetAction = "allow";
  let reason = "within budget";
  let reasonCode: SupervisorReasonCode | null = null;
  let remediation: string[] = [];

  if (state.runTokens >= hardRun || state.stepTokens[step] >= hardStep) {
    action = "halt";
    reason = `hard budget exceeded on ${step}`;
    reasonCode = "budget.hard-stop";
    remediation = [
      `Reduce ${step} scope before retrying this session.`,
      "Trim active roles or request a smaller checkpoint response.",
      "Use an explicit human budget exception only if the extra spend is intentional."
    ];
  } else if (state.runTokens >= softRun || state.stepTokens[step] >= softStep) {
    const overBy = Math.max(
      state.runTokens - softRun,
      state.stepTokens[step] - softStep,
      0
    );
    action = overBy > Math.floor(softStep * 0.25) ? "truncate" : "compact";
    reason = `${action} triggered at soft budget on ${step}`;
    reasonCode = action === "truncate" ? "budget.escalation-required" : "budget.warning-threshold";
    remediation = action === "truncate"
      ? [
          `Checkpoint review is recommended before extending ${step}.`,
          "Narrow the requested output or split the work into another lane.",
          "Use deeper investigation only when the extra spend is worth the delay."
        ]
      : [
          `Keep ${step} output compact while the session stays near the soft budget.`,
          "Prefer summarizing deltas instead of replaying the full context."
        ];
  }

  state.events.push({ step, action, reason });
  budgetBySession.set(sessionID, state);

  debugLog("budget.recorded", {
    sessionId: sessionID,
    intent,
    step,
    tokens: positiveTokens,
    runTokens: state.runTokens,
    runCostUsd: Number(state.runCostUsd.toFixed(6)),
    usagePercent,
    action,
    reason,
    reasonCode,
    remediation,
    budgetConfig: state.config.values,
    budgetConfigProvenance: state.config.provenance
  });

  return { action, reason, reasonCode, remediation, usagePercent, session: state };
};

export const getSessionBudgetState = (sessionID: string): BudgetState | null => {
  return budgetBySession.get(sessionID) ?? null;
};

export const clearSessionBudgetState = (sessionID: string): void => {
  budgetBySession.delete(sessionID);
};

export const getTruncateTokenLimit = (): number => {
  return getBudgetRuntimeConfigDiagnostics().values.truncateAtTokens;
};

export const finalizeBudgetRun = (sessionID: string): BaselineStats | null => {
  const state = budgetBySession.get(sessionID);
  if (!state) {
    return null;
  }

  const existing = runHistoryByIntent.get(state.intent) ?? [];
  existing.push(state.runTokens);
  runHistoryByIntent.set(state.intent, existing);

  const stats: BaselineStats = {
    p50Tokens: percentile(existing, 50),
    p95Tokens: percentile(existing, 95),
    runs: existing.length
  };

  debugLog("budget.baseline", {
    sessionId: sessionID,
    intent: state.intent,
    p50Tokens: stats.p50Tokens,
    p95Tokens: stats.p95Tokens,
    runs: stats.runs,
    budgetConfig: state.config.values,
    budgetConfigProvenance: state.config.provenance
  });

  return stats;
};
