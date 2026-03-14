import type { Intent } from "./types";
import { debugLog } from "./debug";
import { getSupervisorPolicy } from "./supervisor-config";

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

type BudgetState = {
  intent: Intent;
  runTokens: number;
  runCostUsd: number;
  stepTokens: Record<WorkflowStep, number>;
  stepCostUsd: Record<WorkflowStep, number>;
  events: Array<{ step: WorkflowStep; action: BudgetAction; reason: string }>;
};

type BudgetDecision = {
  action: BudgetAction;
  reason: string;
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

const getConfig = (): BudgetConfig => ({
  softRunTokens: readNumber(process.env.ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_RUN_TOKENS, getSupervisorPolicy().budget.runtime.softRunTokens),
  hardRunTokens: readNumber(process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_RUN_TOKENS, getSupervisorPolicy().budget.runtime.hardRunTokens),
  softStepTokens: readNumber(process.env.ORCHESTRATION_WORKFLOWS_BUDGET_SOFT_STEP_TOKENS, getSupervisorPolicy().budget.runtime.softStepTokens),
  hardStepTokens: readNumber(process.env.ORCHESTRATION_WORKFLOWS_BUDGET_HARD_STEP_TOKENS, getSupervisorPolicy().budget.runtime.hardStepTokens),
  truncateAtTokens: readNumber(process.env.ORCHESTRATION_WORKFLOWS_BUDGET_TRUNCATE_TOKENS, getSupervisorPolicy().budget.runtime.truncateAtTokens),
  costPer1kTokensUsd: readNumber(process.env.ORCHESTRATION_WORKFLOWS_BUDGET_COST_PER_1K_USD, getSupervisorPolicy().budget.runtime.costPer1kTokensUsd),
  stepExecutionTokenCost: readNumber(process.env.ORCHESTRATION_WORKFLOWS_EXECUTE_STEP_TOKEN_COST, getSupervisorPolicy().budget.runtime.stepExecutionTokenCost)
});

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

const buildInitialState = (intent: Intent): BudgetState => ({
  intent,
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
  const config = getConfig();
  const state = budgetBySession.get(sessionID) ?? buildInitialState(intent);

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

  let action: BudgetAction = "allow";
  let reason = "within budget";

  if (state.runTokens >= hardRun || state.stepTokens[step] >= hardStep) {
    action = "halt";
    reason = `hard budget exceeded on ${step}`;
  } else if (state.runTokens >= softRun || state.stepTokens[step] >= softStep) {
    const overBy = Math.max(
      state.runTokens - softRun,
      state.stepTokens[step] - softStep,
      0
    );
    action = overBy > Math.floor(softStep * 0.25) ? "truncate" : "compact";
    reason = `${action} triggered at soft budget on ${step}`;
  }

  state.events.push({ step, action, reason });
  budgetBySession.set(sessionID, state);

  debugLog("budget.recorded", {
    sessionID,
    intent,
    step,
    tokens: positiveTokens,
    runTokens: state.runTokens,
    runCostUsd: Number(state.runCostUsd.toFixed(6)),
    action,
    reason
  });

  return { action, reason, session: state };
};

export const getSessionBudgetState = (sessionID: string): BudgetState | null => {
  return budgetBySession.get(sessionID) ?? null;
};

export const clearSessionBudgetState = (sessionID: string): void => {
  budgetBySession.delete(sessionID);
};

export const getTruncateTokenLimit = (): number => {
  return getConfig().truncateAtTokens;
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
    sessionID,
    intent: state.intent,
    p50Tokens: stats.p50Tokens,
    p95Tokens: stats.p95Tokens,
    runs: stats.runs
  });

  return stats;
};
