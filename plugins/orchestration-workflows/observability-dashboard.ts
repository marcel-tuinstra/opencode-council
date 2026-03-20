import type { SupervisorThresholdEvent } from "./guardrail-thresholds";
import type { BudgetGovernanceDecision, BudgetGovernanceStatus } from "./budget-governance";
import type { LaneLifecycleState } from "./lane-lifecycle";
import type { SupervisorReasonDetail } from "./reason-codes";
import type { LaneTurnHandoffContract, LaneTurnRole } from "./turn-ownership";

export type SupervisorHeartbeatHealth = "healthy" | "stale" | "missing";

export type SupervisorBlockerStatus = "clear" | "blocked";

export type SupervisorPolicyDecisionCategory =
  | "lane-lifecycle"
  | "budget-governance"
  | "review-ready-packet"
  | "turn-ownership"
  | "merge-policy";

export type SupervisorHeartbeatSnapshotInput = {
  sessionId: string;
  lastHeartbeatAt?: string;
  staleAfterMs: number;
};

export type SupervisorHeartbeatSnapshot = {
  sessionId: string;
  health: SupervisorHeartbeatHealth;
  lastHeartbeatAt?: string;
  staleAfterMs: number;
};

export type SupervisorBlockerSnapshotInput = {
  status: SupervisorBlockerStatus;
  summary?: string;
  owner?: LaneTurnRole;
  updatedAt: string;
};

export type SupervisorBlockerSnapshot = {
  status: SupervisorBlockerStatus;
  summary?: string;
  owner?: LaneTurnRole;
  updatedAt: string;
};

export type SupervisorPolicyDecisionInput = {
  runId?: string;
  category: SupervisorPolicyDecisionCategory;
  laneId: string;
  summary: string;
  outcome: string;
  occurredAt: string;
  reasonDetails?: readonly SupervisorReasonDetail[];
};

export type SupervisorPolicyDecision = {
  runId?: string;
  category: SupervisorPolicyDecisionCategory;
  laneId: string;
  summary: string;
  outcome: string;
  occurredAt: string;
  reasonDetails: readonly SupervisorReasonDetail[];
};

export type SupervisorThresholdEventInput = {
  occurredAt: string;
  event: SupervisorThresholdEvent;
};

export type SupervisorObservedThresholdEvent = SupervisorThresholdEvent & {
  runId?: string;
  laneId: string;
  occurredAt: string;
};

export type SupervisorEscalationEvent = {
  runId?: string;
  laneId: string;
  sessionId?: string;
  status: Extract<BudgetGovernanceStatus, "escalation-required" | "hard-stop">;
  usagePercent: number;
  occurredAt: string;
  summary: string;
};

export type SupervisorLaneObservabilityInput = {
  runId?: string;
  laneId: string;
  state: LaneLifecycleState;
  session?: SupervisorHeartbeatSnapshotInput;
  blocker?: SupervisorBlockerSnapshotInput;
  budget?: BudgetGovernanceDecision;
  budgetEvaluatedAt?: string;
  ownershipTransitions?: readonly LaneTurnHandoffContract[];
  policyDecisions?: readonly SupervisorPolicyDecisionInput[];
  thresholdEvents?: readonly SupervisorThresholdEventInput[];
};

export type SupervisorLaneObservabilitySnapshot = {
  runId?: string;
  laneId: string;
  state: LaneLifecycleState;
  session?: SupervisorHeartbeatSnapshot;
  blocker?: SupervisorBlockerSnapshot;
  budget?: BudgetGovernanceDecision;
  ownershipTransitions: readonly LaneTurnHandoffContract[];
  policyDecisions: readonly SupervisorPolicyDecision[];
  thresholdEvents: readonly SupervisorObservedThresholdEvent[];
};

export type SupervisorObservabilityDashboardInput = {
  runId?: string;
  generatedAt: string;
  lanes: readonly SupervisorLaneObservabilityInput[];
  recentEventLimit?: number;
};

export type SupervisorObservabilityDashboardSnapshot = {
  generatedAt: string;
  totals: {
    lanes: number;
    byState: Readonly<Record<LaneLifecycleState, number>>;
    healthySessions: number;
    staleSessions: number;
    missingSessions: number;
    blockedLanes: number;
    lanesWithinBudget: number;
    warningLanes: number;
    escalationLanes: number;
    hardStopLanes: number;
  };
  lanes: readonly SupervisorLaneObservabilitySnapshot[];
  escalationEvents: readonly SupervisorEscalationEvent[];
  recentPolicyDecisions: readonly SupervisorPolicyDecision[];
  recentThresholdEvents: readonly SupervisorObservedThresholdEvent[];
  recentOwnershipTransitions: readonly LaneTurnHandoffContract[];
};

const DEFAULT_RECENT_EVENT_LIMIT = 10;

const normalizeOptionalRunId = (value: string | undefined): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const assertNonEmptyValue = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor observability dashboard requires a non-empty ${field}.`);
  }

  return normalized;
};

const assertTimestamp = (value: string, field: string): string => {
  const normalized = assertNonEmptyValue(value, field);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Supervisor observability dashboard requires a valid ${field}.`);
  }

  return normalized;
};

const assertPositiveInteger = (value: number, field: string): number => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Supervisor observability dashboard requires a positive ${field}.`);
  }

  return value;
};

const compareByTimestampDescending = <T extends { occurredAt: string }>(left: T, right: T): number => (
  Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
);

export const resolveHeartbeatHealth = (
  generatedAt: string,
  session?: SupervisorHeartbeatSnapshotInput
): SupervisorHeartbeatSnapshot | undefined => {
  if (!session) {
    return undefined;
  }

  const sessionId = assertNonEmptyValue(session.sessionId, "session id");
  const staleAfterMs = assertPositiveInteger(session.staleAfterMs, "stale-after milliseconds value");
  const lastHeartbeatAt = session.lastHeartbeatAt
    ? assertTimestamp(session.lastHeartbeatAt, "heartbeat timestamp")
    : undefined;

  if (!lastHeartbeatAt) {
    return {
      sessionId,
      health: "missing",
      staleAfterMs
    };
  }

  const generatedAtMs = Date.parse(generatedAt);
  const lastHeartbeatAtMs = Date.parse(lastHeartbeatAt);

  return {
    sessionId,
    health: generatedAtMs - lastHeartbeatAtMs > staleAfterMs ? "stale" : "healthy",
    lastHeartbeatAt,
    staleAfterMs
  };
};

const normalizeBlocker = (input?: SupervisorBlockerSnapshotInput): SupervisorBlockerSnapshot | undefined => {
  if (!input) {
    return undefined;
  }

  return {
    status: input.status,
    summary: input.summary ? assertNonEmptyValue(input.summary, "blocker summary") : undefined,
    owner: input.owner,
    updatedAt: assertTimestamp(input.updatedAt, "blocker updated timestamp")
  };
};

const normalizePolicyDecision = (
  input: SupervisorPolicyDecisionInput
): SupervisorPolicyDecision => ({
  runId: input.runId ? assertNonEmptyValue(input.runId, "policy decision run id") : undefined,
  category: input.category,
  laneId: assertNonEmptyValue(input.laneId, "policy decision lane id"),
  summary: assertNonEmptyValue(input.summary, "policy decision summary"),
  outcome: assertNonEmptyValue(input.outcome, "policy decision outcome"),
  occurredAt: assertTimestamp(input.occurredAt, "policy decision timestamp"),
  reasonDetails: Object.freeze([...(input.reasonDetails ?? [])])
});

const normalizeThresholdEvent = (
  runId: string | undefined,
  laneId: string,
  input: SupervisorThresholdEventInput
): SupervisorObservedThresholdEvent => ({
  ...input.event,
  runId: runId ? assertNonEmptyValue(runId, "threshold event run id") : undefined,
  laneId: assertNonEmptyValue(laneId, "threshold event lane id"),
  occurredAt: assertTimestamp(input.occurredAt, "threshold event timestamp")
});

const buildEscalationEvent = (
  runId: string | undefined,
  laneId: string,
  session: SupervisorHeartbeatSnapshot | undefined,
  budget: BudgetGovernanceDecision,
  budgetEvaluatedAt: string
): SupervisorEscalationEvent | undefined => {
  if (budget.status !== "escalation-required" && budget.status !== "hard-stop") {
    return undefined;
  }

  const recommendationSummary = budget.recommendations.join(", ");

  return {
    runId,
    laneId,
    sessionId: session?.sessionId,
    status: budget.status,
    usagePercent: budget.usagePercent,
    occurredAt: assertTimestamp(budgetEvaluatedAt, "budget evaluation timestamp"),
    summary: `${budget.scope} budget reached ${budget.usagePercent}% and is ${budget.status}; next actions: ${recommendationSummary}.`
  };
};

export const createSupervisorObservabilityDashboard = (
  input: SupervisorObservabilityDashboardInput
): SupervisorObservabilityDashboardSnapshot => {
  const generatedAt = assertTimestamp(input.generatedAt, "generated timestamp");
  const recentEventLimit = input.recentEventLimit === undefined
    ? DEFAULT_RECENT_EVENT_LIMIT
    : assertPositiveInteger(input.recentEventLimit, "recent event limit");

  const totals = {
    lanes: 0,
    byState: {
      planned: 0,
      active: 0,
      waiting: 0,
      review_ready: 0,
      complete: 0
    } satisfies Record<LaneLifecycleState, number>,
    healthySessions: 0,
    staleSessions: 0,
    missingSessions: 0,
    blockedLanes: 0,
    lanesWithinBudget: 0,
    warningLanes: 0,
    escalationLanes: 0,
    hardStopLanes: 0
  };

  const escalationEvents: SupervisorEscalationEvent[] = [];
  const policyDecisions: SupervisorPolicyDecision[] = [];
  const thresholdEvents: SupervisorObservedThresholdEvent[] = [];
  const ownershipTransitions: LaneTurnHandoffContract[] = [];

  const lanes = input.lanes.map((lane) => {
    const runId = normalizeOptionalRunId(lane.runId) ?? normalizeOptionalRunId(input.runId);
    const laneId = assertNonEmptyValue(lane.laneId, "lane id");
    const session = resolveHeartbeatHealth(generatedAt, lane.session);
    const blocker = normalizeBlocker(lane.blocker);
    const normalizedPolicyDecisions = (lane.policyDecisions ?? []).map((decision) => normalizePolicyDecision({
      ...decision,
      runId: decision.runId ?? runId
    }));
    const normalizedThresholdEvents = [
      ...((lane.budget && lane.budgetEvaluatedAt)
        ? lane.budget.thresholdEvents.map((event) => normalizeThresholdEvent(runId, laneId, {
          occurredAt: lane.budgetEvaluatedAt as string,
          event
        }))
        : []),
      ...(lane.thresholdEvents ?? []).map((event) => normalizeThresholdEvent(runId, laneId, event))
    ];
    const normalizedOwnershipTransitions = [...(lane.ownershipTransitions ?? [])];

    totals.lanes += 1;
    totals.byState[lane.state] += 1;

    if (session?.health === "healthy") {
      totals.healthySessions += 1;
    }

    if (session?.health === "stale") {
      totals.staleSessions += 1;
    }

    if (session?.health === "missing") {
      totals.missingSessions += 1;
    }

    if (blocker?.status === "blocked") {
      totals.blockedLanes += 1;
    }

    if (lane.budget?.status === "within-budget") {
      totals.lanesWithinBudget += 1;
    }

    if (lane.budget?.status === "warning") {
      totals.warningLanes += 1;
    }

    if (lane.budget?.status === "escalation-required") {
      totals.escalationLanes += 1;
    }

    if (lane.budget?.status === "hard-stop") {
      totals.hardStopLanes += 1;
    }

    if (lane.budget && lane.budgetEvaluatedAt) {
        const escalation = buildEscalationEvent(runId, laneId, session, lane.budget, lane.budgetEvaluatedAt);

      if (escalation) {
        escalationEvents.push(escalation);
      }
    }

    policyDecisions.push(...normalizedPolicyDecisions);
    thresholdEvents.push(...normalizedThresholdEvents);
    ownershipTransitions.push(...normalizedOwnershipTransitions);

      return {
        runId,
        laneId,
        state: lane.state,
      session,
      blocker,
      budget: lane.budget,
      ownershipTransitions: normalizedOwnershipTransitions,
      policyDecisions: normalizedPolicyDecisions,
      thresholdEvents: normalizedThresholdEvents
    } satisfies SupervisorLaneObservabilitySnapshot;
  });

  return {
    generatedAt,
    totals,
    lanes,
    escalationEvents: escalationEvents.sort(compareByTimestampDescending).slice(0, recentEventLimit),
    recentPolicyDecisions: policyDecisions.sort(compareByTimestampDescending).slice(0, recentEventLimit),
    recentThresholdEvents: thresholdEvents.sort(compareByTimestampDescending).slice(0, recentEventLimit),
    recentOwnershipTransitions: ownershipTransitions.reverse().slice(0, recentEventLimit)
  };
};
