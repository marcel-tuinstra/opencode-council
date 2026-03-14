import {
  createSupervisorDataLifecycleReport,
  type CreateSupervisorDataLifecycleReportInput,
  type SupervisorDataLifecycleReport
} from "./data-lifecycle";
import type { SupervisorObservedThresholdEvent } from "./observability-dashboard";
import {
  createSupervisorObservabilityDashboard,
  type SupervisorObservabilityDashboardSnapshot
} from "./observability-dashboard";
import {
  createReviewCoordinationBundle,
  type ReviewCoordinationBundle,
  type ReviewCoordinationBundleInput,
  type ReviewRoutingDecision
} from "./review-coordination";
import { planSupervisorGoal } from "./supervisor-goal-plan";
import { createSupervisorDispatchPlan, type CreateSupervisorDispatchPlanInput } from "./supervisor-dispatch-planning";
import { createSupervisorDelegationPlan, validateSupervisorDelegationPlan, type SupervisorDelegationPlanInput } from "./supervisor-delegation";
import {
  type SupervisorRunState,
  type SupervisorStateStore
} from "./durable-state-store";
import {
  type RunSupervisorDispatchLoopInput,
  type RunSupervisorDispatchLoopResult
} from "./supervisor-scheduler";

export type SupervisorWorkflowStage = "intake" | "dispatch" | "approval" | "recovery" | "review" | "completion";
export type SupervisorWorkflowStageStatus = "ready" | "blocked" | "completed";
export type SupervisorWorkflowNextAction =
  | "dispatch-lanes"
  | "continue-dispatch"
  | "await-approval"
  | "run-recovery"
  | "prepare-review"
  | "complete-run"
  | "fix-bootstrap"
  | "fix-delegation"
  | "remediate-blockers";

export type SupervisorWorkflowEvent = {
  sequence: number;
  occurredAt: string;
  stage: SupervisorWorkflowStage;
  status: SupervisorWorkflowStageStatus;
  nextAction: SupervisorWorkflowNextAction;
  summary: string;
  laneIds: readonly string[];
};

export type SupervisorLaneStateTransition = {
  sequence: number;
  occurredAt: string;
  laneId: string;
  state: string;
  summary: string;
};

export type BootstrapSupervisorRunInput = Omit<CreateSupervisorDispatchPlanInput, "goalPlan"> & {
  runId: string;
  actor: string;
  occurredAt: string;
  objective: string;
  goal: string;
  requestedByRole?: Parameters<typeof planSupervisorGoal>[0]["requestedByRole"];
  availableRoles?: Parameters<typeof planSupervisorGoal>[0]["availableRoles"];
  maxRoles?: Parameters<typeof planSupervisorGoal>[0]["maxRoles"];
  delegation?: SupervisorDelegationPlanInput;
  mutationId?: string;
};

export type BootstrapSupervisorRunResult = {
  status: "supported" | "blocked";
  nextAction: SupervisorWorkflowNextAction;
  dispatchPlan: ReturnType<typeof createSupervisorDispatchPlan>;
  delegationValidation?: ReturnType<typeof validateSupervisorDelegationPlan>;
  remediation: readonly string[];
  warnings: readonly string[];
  state: SupervisorRunState;
};

export type AdvanceSupervisorRunInput = RunSupervisorDispatchLoopInput & {
  workflowMutationId?: string;
};

export type AdvanceSupervisorRunResult = {
  dispatch: RunSupervisorDispatchLoopResult;
  stage: SupervisorWorkflowStage;
  status: SupervisorWorkflowStageStatus;
  nextAction: SupervisorWorkflowNextAction;
  remediation: readonly string[];
  state: SupervisorRunState;
};

export type PrepareSupervisorReviewBundlesInput = {
  runId: string;
  bundles: readonly ReviewCoordinationBundleInput[];
};

export type BuildSupervisorRunSummaryInput = {
  runId: string;
  generatedAt: string;
  staleAfterMs?: number;
  reviewRouting?: readonly ReviewRoutingDecision[];
  thresholdEvents?: readonly SupervisorObservedThresholdEvent[];
  unresolvedGovernance?: boolean;
  policy?: CreateSupervisorDataLifecycleReportInput["policy"];
};

export type SupervisorRunSummary = {
  dashboard: SupervisorObservabilityDashboardSnapshot;
  lifecycle: SupervisorDataLifecycleReport;
};

export type ReconstructSupervisorRunResult = {
  state: SupervisorRunState;
  workflowEvents: readonly SupervisorWorkflowEvent[];
  laneTransitions: readonly SupervisorLaneStateTransition[];
  currentNextAction?: SupervisorWorkflowNextAction;
};

export type CreateSupervisorExecutionWorkflowOptions = {
  store: SupervisorStateStore;
  dispatchLoop: { run(input: RunSupervisorDispatchLoopInput): RunSupervisorDispatchLoopResult };
};

const WORKFLOW_STAGE_PREFIX = "workflow-stage:";
const WORKFLOW_STATUS_PREFIX = "workflow-status:";
const WORKFLOW_NEXT_ACTION_PREFIX = "workflow-next-action:";
const WORKFLOW_LANE_PREFIX = "workflow-lane:";

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor execution workflow requires a non-empty ${field}.`);
  }

  return normalized;
};

const dedupe = (values: readonly string[]): readonly string[] => freezeList(Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))));

const getPrefixedValue = (sideEffects: readonly string[], prefix: string): string | undefined => sideEffects
  .find((sideEffect) => sideEffect.startsWith(prefix))
  ?.slice(prefix.length);

const mapWorkflowStatusToRunStatus = (
  stage: SupervisorWorkflowStage,
  status: SupervisorWorkflowStageStatus
): SupervisorRunState["run"]["status"] => {
  if (stage === "completion" && status === "completed") {
    return "completed";
  }

  if (stage === "review" && status === "ready") {
    return "review_ready";
  }

  if (status === "blocked") {
    return stage === "approval" ? "waiting" : "paused";
  }

  return stage === "intake" ? "planned" : "active";
};

const recordWorkflowEvent = (input: {
  store: SupervisorStateStore;
  runId: string;
  actor: string;
  occurredAt: string;
  mutationId: string;
  summary: string;
  stage: SupervisorWorkflowStage;
  status: SupervisorWorkflowStageStatus;
  nextAction: SupervisorWorkflowNextAction;
  laneIds?: readonly string[];
}): SupervisorRunState => input.store.commitMutation(input.runId, {
  mutationId: input.mutationId,
  actor: input.actor,
  summary: input.summary,
  occurredAt: input.occurredAt,
  runPatch: {
    status: mapWorkflowStatusToRunStatus(input.stage, input.status)
  },
  sideEffects: [
    `${WORKFLOW_STAGE_PREFIX}${input.stage}`,
    `${WORKFLOW_STATUS_PREFIX}${input.status}`,
    `${WORKFLOW_NEXT_ACTION_PREFIX}${input.nextAction}`,
    ...dedupe(input.laneIds ?? []).map((laneId) => `${WORKFLOW_LANE_PREFIX}${laneId}`)
  ]
});

const buildWorkflowEvent = (state: SupervisorRunState): readonly SupervisorWorkflowEvent[] => freezeList(state.auditLog
  .map((entry) => {
    const stage = getPrefixedValue(entry.sideEffects, WORKFLOW_STAGE_PREFIX);
    const status = getPrefixedValue(entry.sideEffects, WORKFLOW_STATUS_PREFIX);
    const nextAction = getPrefixedValue(entry.sideEffects, WORKFLOW_NEXT_ACTION_PREFIX);

    if (!stage || !status || !nextAction) {
      return null;
    }

    return Object.freeze({
      sequence: entry.sequence,
      occurredAt: entry.occurredAt,
      stage: stage as SupervisorWorkflowStage,
      status: status as SupervisorWorkflowStageStatus,
      nextAction: nextAction as SupervisorWorkflowNextAction,
      summary: entry.summary,
      laneIds: freezeList(entry.sideEffects
        .filter((sideEffect) => sideEffect.startsWith(WORKFLOW_LANE_PREFIX))
        .map((sideEffect) => sideEffect.slice(WORKFLOW_LANE_PREFIX.length))),
    });
  })
  .filter((event): event is SupervisorWorkflowEvent => event !== null));

const buildLaneTransitions = (state: SupervisorRunState): readonly SupervisorLaneStateTransition[] => freezeList(state.auditLog
  .flatMap((entry) => entry.entityRefs
    .filter((entityRef) => entityRef.kind === "lane" && entityRef.state)
    .map((entityRef) => Object.freeze({
      sequence: entry.sequence,
      occurredAt: entry.occurredAt,
      laneId: entityRef.id,
      state: entityRef.state!,
      summary: entry.summary
    }))));

const getPendingApprovalRemediation = (state: SupervisorRunState): readonly string[] => dedupe(state.approvals
  .filter((approval) => approval.status === "pending")
  .map((approval) => `Await explicit ${approval.boundary} approval for ${approval.requestedAction}.`));

const classifyAdvanceOutcome = (input: {
  beforeState: SupervisorRunState;
  afterState: SupervisorRunState;
  dispatch: RunSupervisorDispatchLoopResult;
}): Pick<AdvanceSupervisorRunResult, "stage" | "status" | "nextAction" | "remediation"> => {
  const pendingApprovalRemediation = getPendingApprovalRemediation(input.afterState);
  const blockedReasons = dedupe(input.dispatch.decisions
    .filter((decision) => decision.status === "blocked")
    .flatMap((decision) => decision.reasons));

  if (input.afterState.lanes.length > 0 && input.afterState.lanes.every((lane) => lane.state === "complete")) {
    return {
      stage: "completion",
      status: "completed",
      nextAction: "complete-run",
      remediation: freezeList([])
    };
  }

  if (input.dispatch.decisions.some((decision) => decision.status === "review_ready")) {
    return {
      stage: "review",
      status: "ready",
      nextAction: "prepare-review",
      remediation: freezeList([])
    };
  }

  if (pendingApprovalRemediation.length > 0) {
    return {
      stage: "approval",
      status: "blocked",
      nextAction: "await-approval",
      remediation: pendingApprovalRemediation
    };
  }

  if (input.dispatch.decisions.some((decision) => decision.action === "replace-session" || decision.action === "resume-session")) {
    return {
      stage: "recovery",
      status: "ready",
      nextAction: "continue-dispatch",
      remediation: freezeList([])
    };
  }

  const beforeSessionIds = new Set(input.beforeState.sessions.map((session) => session.sessionId));
  const hasNewSession = input.afterState.sessions.some((session) => !beforeSessionIds.has(session.sessionId));
  if (hasNewSession && input.beforeState.sessions.some((session) => session.status === "stalled" || session.status === "failed")) {
    return {
      stage: "recovery",
      status: "ready",
      nextAction: "continue-dispatch",
      remediation: freezeList([])
    };
  }

  if (blockedReasons.length > 0) {
    return {
      stage: "dispatch",
      status: "blocked",
      nextAction: "remediate-blockers",
      remediation: blockedReasons
    };
  }

  return {
    stage: "dispatch",
    status: "ready",
    nextAction: "continue-dispatch",
    remediation: freezeList([])
  };
};

const summarizeAdvanceOutcome = (
  stage: SupervisorWorkflowStage,
  status: SupervisorWorkflowStageStatus,
  nextAction: SupervisorWorkflowNextAction,
  laneIds: readonly string[]
): string => {
  const laneSummary = laneIds.length > 0 ? ` for ${laneIds.join(", ")}` : "";
  return `Supervisor workflow ${stage} is ${status}${laneSummary}; next action: ${nextAction}.`;
};

export const createSupervisorExecutionWorkflow = (
  options: CreateSupervisorExecutionWorkflowOptions
): {
  bootstrapRun(input: BootstrapSupervisorRunInput): BootstrapSupervisorRunResult;
  advanceRun(input: AdvanceSupervisorRunInput): AdvanceSupervisorRunResult;
  prepareReviewBundles(input: PrepareSupervisorReviewBundlesInput): readonly ReviewCoordinationBundle[];
  buildRunSummary(input: BuildSupervisorRunSummaryInput): SupervisorRunSummary;
  reconstructRun(runId: string): ReconstructSupervisorRunResult;
} => {
  const store = options.store;
  const dispatchLoop = options.dispatchLoop;

  const bootstrapRun = (input: BootstrapSupervisorRunInput): BootstrapSupervisorRunResult => {
    const runId = assertNonEmpty(input.runId, "run id");
    const actor = assertNonEmpty(input.actor, "actor");
    const occurredAt = assertNonEmpty(input.occurredAt, "timestamp");
    const objective = assertNonEmpty(input.objective, "objective");
    const goalPlan = planSupervisorGoal({
      goal: input.goal,
      requestedByRole: input.requestedByRole,
      availableRoles: input.availableRoles,
      maxRoles: input.maxRoles
    });
    const dispatchPlan = createSupervisorDispatchPlan({
      goalPlan,
      workUnits: input.workUnits,
      scheduler: input.scheduler,
      readyDependencyReferences: input.readyDependencyReferences
    });
    const delegationValidation = input.delegation
      ? validateSupervisorDelegationPlan(createSupervisorDelegationPlan(input.delegation))
      : undefined;
    const blockedRemediation = dedupe([
      ...dispatchPlan.remediation,
      ...(delegationValidation?.valid === false ? delegationValidation.violations : [])
    ]);
    const warnings = dedupe([
      ...dispatchPlan.warnings,
      ...(delegationValidation?.valid === false ? delegationValidation.violations : [])
    ]);
    const status = dispatchPlan.status === "supported" && delegationValidation?.valid !== false
      ? "supported"
      : "blocked";
    const nextAction = delegationValidation?.valid === false
      ? "fix-delegation"
      : dispatchPlan.status === "supported"
        ? "dispatch-lanes"
        : "fix-bootstrap";
    const state = store.commitMutation(runId, {
      mutationId: input.mutationId ?? `${runId}:bootstrap`,
      actor,
      summary: status === "supported"
        ? "Bootstrap the delegated supervisor run and persist the intake checkpoint."
        : "Bootstrap the delegated supervisor run in a blocked fail-closed state.",
      occurredAt,
      createRun: {
        runId,
        status: status === "supported" ? "planned" : "paused",
        objective,
        createdAt: occurredAt
      },
      sideEffects: [
        `${WORKFLOW_STAGE_PREFIX}intake`,
        `${WORKFLOW_STATUS_PREFIX}${status === "supported" ? "ready" : "blocked"}`,
        `${WORKFLOW_NEXT_ACTION_PREFIX}${nextAction}`
      ]
    });

    return {
      status,
      nextAction,
      dispatchPlan,
      delegationValidation,
      remediation: blockedRemediation,
      warnings,
      state
    };
  };

  const advanceRun = (input: AdvanceSupervisorRunInput): AdvanceSupervisorRunResult => {
    const beforeState = store.getRunState(input.runId);
    if (!beforeState) {
      throw new Error(`Cannot advance unknown supervisor run '${input.runId}'.`);
    }

    const dispatch = dispatchLoop.run(input);
    const afterDispatchState = store.getRunState(input.runId);
    if (!afterDispatchState) {
      throw new Error(`Supervisor run '${input.runId}' disappeared after dispatch.`);
    }

    const classified = classifyAdvanceOutcome({
      beforeState,
      afterState: afterDispatchState,
      dispatch
    });
    const laneIds = dedupe(dispatch.decisions.map((decision) => decision.laneId));
    const state = recordWorkflowEvent({
      store,
      runId: input.runId,
      actor: input.actor,
      occurredAt: input.occurredAt,
      mutationId: input.workflowMutationId ?? `workflow:${input.runId}:${input.occurredAt}`,
      summary: summarizeAdvanceOutcome(classified.stage, classified.status, classified.nextAction, laneIds),
      stage: classified.stage,
      status: classified.status,
      nextAction: classified.nextAction,
      laneIds
    });

    return {
      dispatch,
      stage: classified.stage,
      status: classified.status,
      nextAction: classified.nextAction,
      remediation: classified.remediation,
      state
    };
  };

  const prepareReviewBundles = (input: PrepareSupervisorReviewBundlesInput): readonly ReviewCoordinationBundle[] => {
    const state = store.getRunState(input.runId);
    if (!state) {
      throw new Error(`Cannot prepare review bundles for unknown supervisor run '${input.runId}'.`);
    }

    return freezeList(input.bundles.map((bundle) => createReviewCoordinationBundle({
      ...bundle,
      run: bundle.run ?? state.run,
      approvals: bundle.approvals ?? state.approvals,
      artifacts: bundle.artifacts ?? state.artifacts
    })));
  };

  const buildRunSummary = (input: BuildSupervisorRunSummaryInput): SupervisorRunSummary => {
    const state = store.getRunState(input.runId);
    if (!state) {
      throw new Error(`Cannot summarize unknown supervisor run '${input.runId}'.`);
    }

    const dashboard = createSupervisorObservabilityDashboard({
      generatedAt: input.generatedAt,
      lanes: state.lanes.map((lane) => {
        const session = lane.sessionId
          ? state.sessions.find((candidate) => candidate.sessionId === lane.sessionId)
          : undefined;

        return {
          laneId: lane.laneId,
          state: lane.state,
          session: session
            ? {
                sessionId: session.sessionId,
                lastHeartbeatAt: session.lastHeartbeatAt,
                staleAfterMs: input.staleAfterMs ?? 5 * 60 * 1000
              }
            : undefined,
          blocker: lane.state === "waiting"
            ? {
                status: "blocked" as const,
                summary: "Lane is waiting for an explicit supervisor remediation step.",
                updatedAt: lane.updatedAt
              }
            : undefined,
          thresholdEvents: (input.thresholdEvents ?? []).filter((event) => event.laneId === lane.laneId)
            .map((event) => ({ occurredAt: event.occurredAt, event }))
        };
      })
    });
    const lifecycle = createSupervisorDataLifecycleReport({
      generatedAt: input.generatedAt,
      durableRuns: [
        {
          runState: state,
          reviewRouting: input.reviewRouting,
          thresholdEvents: input.thresholdEvents,
          unresolvedGovernance: input.unresolvedGovernance
        }
      ],
      policy: input.policy
    });

    return {
      dashboard,
      lifecycle
    };
  };

  const reconstructRun = (runId: string): ReconstructSupervisorRunResult => {
    const state = store.getRunState(runId);
    if (!state) {
      throw new Error(`Cannot reconstruct unknown supervisor run '${runId}'.`);
    }

    const workflowEvents = buildWorkflowEvent(state);

    return {
      state,
      workflowEvents,
      laneTransitions: buildLaneTransitions(state),
      currentNextAction: workflowEvents.at(-1)?.nextAction
    };
  };

  return {
    bootstrapRun,
    advanceRun,
    prepareReviewBundles,
    buildRunSummary,
    reconstructRun
  };
};
