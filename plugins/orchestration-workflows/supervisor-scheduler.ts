import {
  evaluateSupervisorApprovalGate,
  resolveSupervisorApprovalId,
  type SupervisorApprovalGateRequest,
  type SupervisorApprovalSignal,
  type SupervisorApprovalNextAction
} from "./approval-gates";
import type { LaneCompletionContract } from "./lane-contract";
import type {
  SupervisorApprovalRecord,
  SupervisorArtifactRecord,
  SupervisorLaneRecord,
  SupervisorRunState,
  SupervisorSessionRecord,
  SupervisorStateStore,
  SupervisorWorktreeRecord
} from "./durable-state-store";
import {
  assertLaneStateTransition,
  countsTowardActiveLaneCap,
  resolveLanePolicy,
  type LaneLifecycleState,
  type RepoRiskTier
} from "./lane-lifecycle";
import { assertReviewReadyTransition, type ReviewReadyEvidencePacket, type ReviewReadyEvidencePacketInput } from "./review-ready-packet";
import type { LanePlan } from "./lane-plan";
import type {
  ProvisionSupervisorLaneWorktreeResult,
  SupervisorLaneWorktreeProvisioner
} from "./lane-worktree-provisioner";
import type {
  SupervisorSessionLifecycle,
  SupervisorSessionLifecycleResult
} from "./session-runtime-adapter";

export type SupervisorLaneDefinition = {
  laneId: string;
  sequence: number;
  workUnitIds: readonly string[];
  dependsOnLaneIds: readonly string[];
  branch: string;
};

export type CreateSupervisorLaneDefinitionsOptions = {
  branchPrefix?: string;
  laneIdPrefix?: string;
};

export type SupervisorDispatchLaneInput = {
  definition: SupervisorLaneDefinition;
  waitingOn?: readonly string[];
  reviewReadyPacket?: ReviewReadyEvidencePacketInput | ReviewReadyEvidencePacket;
  complete?: boolean;
  approvalGate?: {
    request: SupervisorApprovalGateRequest;
    signal?: SupervisorApprovalSignal;
  };
};

export type SupervisorDispatchLaneStatus =
  | "blocked"
  | "at-lane-cap"
  | "active"
  | "review_ready"
  | "complete";

export type SupervisorDispatchAction =
  | "none"
  | "pause-session"
  | "provision-worktree"
  | "launch-session"
  | "resume-session"
  | "replace-session"
  | "release-worktree";

export type SupervisorDispatchLaneDecision = {
  laneId: string;
  status: SupervisorDispatchLaneStatus;
  targetState: LaneLifecycleState;
  action: SupervisorDispatchAction;
  nextAction: SupervisorApprovalNextAction;
  assignedOwner?: string;
  reasons: readonly string[];
  lane: SupervisorLaneRecord;
  worktree?: SupervisorWorktreeRecord;
  session?: SupervisorSessionRecord;
};

export type RunSupervisorDispatchLoopInput = {
  runId: string;
  actor: string;
  occurredAt: string;
  repoRiskTier: RepoRiskTier;
  lanes: readonly SupervisorDispatchLaneInput[];
  sessionOwners: readonly string[];
  maxActiveLanes?: number;
  baseRef?: string;
};

export type RunSupervisorDispatchLoopResult = {
  policy: ReturnType<typeof resolveLanePolicy>;
  decisions: readonly SupervisorDispatchLaneDecision[];
};

export type CreateSupervisorDispatchLoopOptions = {
  store: SupervisorStateStore;
  provisioner: SupervisorLaneWorktreeProvisioner;
  sessions: SupervisorSessionLifecycle;
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor scheduler requires a non-empty ${field}.`);
  }

  return normalized;
};

const findLane = (state: SupervisorRunState, laneId: string): SupervisorLaneRecord | undefined => (
  state.lanes.find((lane) => lane.laneId === laneId)
);

const findWorktree = (state: SupervisorRunState, worktreeId?: string): SupervisorWorktreeRecord | undefined => (
  worktreeId ? state.worktrees.find((worktree) => worktree.worktreeId === worktreeId) : undefined
);

const findSession = (state: SupervisorRunState, sessionId?: string): SupervisorSessionRecord | undefined => (
  sessionId ? state.sessions.find((session) => session.sessionId === sessionId) : undefined
);

const findApproval = (state: SupervisorRunState, approvalId: string): SupervisorApprovalRecord | undefined => (
  state.approvals.find((approval) => approval.approvalId === approvalId)
);

const sameApprovalRecord = (left?: SupervisorApprovalRecord, right?: SupervisorApprovalRecord | null): boolean => {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return JSON.stringify(left) === JSON.stringify(right);
};

const commitLaneState = (
  store: SupervisorStateStore,
  runId: string,
  actor: string,
  occurredAt: string,
  lane: SupervisorLaneRecord,
  targetState: LaneLifecycleState,
  mutationId: string,
  summary: string
): SupervisorLaneRecord => {
  if (lane.state === targetState) {
    return lane;
  }

  assertLaneStateTransition(lane.state, targetState);
  const nextLane: SupervisorLaneRecord = Object.freeze({
    ...lane,
    state: targetState,
    updatedAt: occurredAt
  });

  store.commitMutation(runId, {
    mutationId,
    actor,
    summary,
    occurredAt,
    laneUpserts: [nextLane],
    sideEffects: ["updated-lane-state"]
  });

  return nextLane;
};

const buildInitialLaneRecord = (definition: SupervisorLaneDefinition, occurredAt: string): SupervisorLaneRecord => Object.freeze({
  laneId: definition.laneId,
  state: "planned",
  branch: definition.branch,
  updatedAt: occurredAt
});

const ensureLaneDefinitions = (
  store: SupervisorStateStore,
  runId: string,
  actor: string,
  occurredAt: string,
  lanes: readonly SupervisorDispatchLaneInput[]
): void => {
  const state = store.getRunState(runId);

  if (!state) {
    throw new Error(`Cannot dispatch unknown supervisor run '${runId}'.`);
  }

  const missingLanes = lanes
    .map((entry) => entry.definition)
    .filter((definition) => !findLane(state, definition.laneId))
    .map((definition) => buildInitialLaneRecord(definition, occurredAt));

  if (missingLanes.length === 0) {
    return;
  }

  store.commitMutation(runId, {
    mutationId: `dispatch:init:${occurredAt}`,
    actor,
    summary: "Materialize dispatch lanes from the lane plan.",
    occurredAt,
    laneUpserts: missingLanes,
    sideEffects: ["created-lanes"]
  });
};

const countActiveLanes = (state: SupervisorRunState): number => state.lanes.filter((lane) => countsTowardActiveLaneCap(lane.state)).length;

const mapLaneContractArtifactKind = (kind: LaneCompletionContract["artifacts"][number]["kind"]): SupervisorArtifactRecord["kind"] => {
  switch (kind) {
    case "branch":
      return "branch";
    case "pull-request":
      return "pull-request";
    case "review-packet":
      return "review-packet";
    case "session-log":
      return "session-log";
    default:
      return "other";
  }
};

const buildLaneOutputArtifacts = (
  laneId: string,
  occurredAt: string,
  laneOutput: LaneCompletionContract
): readonly SupervisorArtifactRecord[] => Object.freeze(laneOutput.artifacts.map((artifact, index) => Object.freeze({
  artifactId: `${laneId}:${artifact.kind}:${String(index + 1).padStart(2, "0")}:${occurredAt}`,
  laneId,
  kind: mapLaneContractArtifactKind(artifact.kind),
  status: "ready" as const,
  uri: artifact.uri,
  updatedAt: occurredAt
 })));

const selectSessionOwner = (
  laneInput: SupervisorDispatchLaneInput,
  state: SupervisorRunState,
  sessionOwners: readonly string[]
): string => {
  const lane = findLane(state, laneInput.definition.laneId);
  const session = findSession(state, lane?.sessionId);

  if (session?.owner) {
    return session.owner;
  }

  if (sessionOwners.length === 0) {
    throw new Error("Supervisor scheduler requires at least one session owner for dispatch.");
  }

  return sessionOwners[(laneInput.definition.sequence - 1) % sessionOwners.length] as string;
};

const summarizeDependencyStates = (
  state: SupervisorRunState,
  dependencyLaneIds: readonly string[]
): { blocked: boolean; reasons: string[] } => {
  const blockingDependencies = dependencyLaneIds
    .map((dependencyLaneId) => findLane(state, dependencyLaneId))
    .filter((lane): lane is SupervisorLaneRecord => lane !== undefined)
    .filter((lane) => lane.state !== "complete")
    .map((lane) => `${lane.laneId} is ${lane.state}`);

  return {
    blocked: blockingDependencies.length > 0,
    reasons: blockingDependencies.length > 0
      ? [`Waiting for dependency lanes: ${blockingDependencies.join(", ")}.`]
      : []
  };
};

export const createSupervisorLaneDefinitions = (
  lanePlan: LanePlan,
  options: CreateSupervisorLaneDefinitionsOptions = {}
): readonly SupervisorLaneDefinition[] => {
  const laneIdPrefix = options.laneIdPrefix ?? "lane";
  const branchPrefix = assertNonEmpty(options.branchPrefix ?? "supervisor", "branch prefix");
  const workUnitLaneMap = new Map(lanePlan.dependencyGraph.map((node) => [node.id, node.lane]));

  return freezeList(lanePlan.lanes
    .map((lane) => {
      const dependsOnLaneIds = Array.from(new Set(
        lane.workUnitIds.flatMap((workUnitId) => {
          const node = lanePlan.dependencyGraph.find((candidate) => candidate.id === workUnitId);
          return (node?.blockedBy ?? [])
            .map((dependencyWorkUnitId) => workUnitLaneMap.get(dependencyWorkUnitId))
            .filter((dependencyLane): dependencyLane is number => dependencyLane !== undefined && dependencyLane !== lane.lane)
            .map((dependencyLane) => `${laneIdPrefix}-${dependencyLane}`);
        })
      )).sort((left, right) => left.localeCompare(right));

      return Object.freeze({
        laneId: `${laneIdPrefix}-${lane.lane}`,
        sequence: lane.lane,
        workUnitIds: [...lane.workUnitIds],
        dependsOnLaneIds,
        branch: `${branchPrefix}/lane-${String(lane.lane).padStart(2, "0")}`
      });
    })
    .sort((left, right) => left.sequence - right.sequence || left.laneId.localeCompare(right.laneId)));
};

export const createSupervisorDispatchLoop = (
  options: CreateSupervisorDispatchLoopOptions
): { run(input: RunSupervisorDispatchLoopInput): RunSupervisorDispatchLoopResult } => {
  const store = options.store;
  const provisioner = options.provisioner;
  const sessions = options.sessions;

  const run = (input: RunSupervisorDispatchLoopInput): RunSupervisorDispatchLoopResult => {
    const runId = assertNonEmpty(input.runId, "run id");
    const actor = assertNonEmpty(input.actor, "actor");
    const occurredAt = assertNonEmpty(input.occurredAt, "dispatch timestamp");
    const policy = resolveLanePolicy(input.repoRiskTier, input.maxActiveLanes === undefined
      ? undefined
      : { maxActiveLanes: input.maxActiveLanes });

    ensureLaneDefinitions(store, runId, actor, occurredAt, input.lanes);

    const decisions: SupervisorDispatchLaneDecision[] = [];

    for (const laneInput of [...input.lanes].sort((left, right) => (
      left.definition.sequence - right.definition.sequence || left.definition.laneId.localeCompare(right.definition.laneId)
    ))) {
      let state = store.getRunState(runId);
      if (!state) {
        throw new Error(`Cannot dispatch unknown supervisor run '${runId}'.`);
      }

      let lane = findLane(state, laneInput.definition.laneId);
      if (!lane) {
        throw new Error(`Dispatch lane '${laneInput.definition.laneId}' was not materialized.`);
      }

      let worktree = findWorktree(state, lane.worktreeId);
      let session = findSession(state, lane.sessionId);
      const reasons: string[] = [];
      const dependencyStatus = summarizeDependencyStates(state, laneInput.definition.dependsOnLaneIds);
      const waitingOn = freezeList((laneInput.waitingOn ?? []).map((item) => item.trim()).filter(Boolean));
      const assignedOwner = selectSessionOwner(laneInput, state, input.sessionOwners);

      if (laneInput.complete) {
        lane = commitLaneState(
          store,
          runId,
          actor,
          occurredAt,
          lane,
          "complete",
          `dispatch:${lane.laneId}:complete:${occurredAt}`,
          `Mark lane '${lane.laneId}' complete after merge.`
        );
        state = store.getRunState(runId)!;
        worktree = findWorktree(state, lane.worktreeId);

        if (worktree && worktree.status !== "released") {
          const releaseResult = provisioner.releaseLaneWorktree({
            runId,
            laneId: lane.laneId,
            actor,
            mutationId: `dispatch:${lane.laneId}:release:${occurredAt}`,
            occurredAt,
            summary: `Release lane '${lane.laneId}' worktree after completion.`
          });
          lane = releaseResult.lane;
          worktree = releaseResult.worktree;
        }

        reasons.push("Lane completion was explicitly signaled.");
        decisions.push({
          laneId: lane.laneId,
          status: "complete",
          targetState: "complete",
          action: worktree?.status === "released" ? "release-worktree" : "none",
          nextAction: "continue",
          assignedOwner,
          reasons: freezeList(reasons),
          lane,
          worktree,
          session
        });
        continue;
      }

      if (laneInput.reviewReadyPacket) {
        try {
          const reviewPacket = assertReviewReadyTransition(lane.state, "review_ready", laneInput.reviewReadyPacket);
          if (!reviewPacket?.laneOutput) {
            throw new Error("Lane transition to review_ready requires a validated lane output contract.");
          }

          const artifactUpserts = buildLaneOutputArtifacts(lane.laneId, occurredAt, reviewPacket.laneOutput);
          store.commitMutation(runId, {
            mutationId: `dispatch:${lane.laneId}:review-ready:${occurredAt}`,
            actor,
            summary: `Mark lane '${lane.laneId}' review ready with validated handoff artifacts.`,
            occurredAt,
            laneUpserts: [Object.freeze({
              ...lane,
              state: "review_ready",
              updatedAt: occurredAt
            })],
            artifactUpserts,
            sideEffects: ["prepared-review-bundle", "validated-lane-handoff"]
          });
          state = store.getRunState(runId)!;
          lane = findLane(state, laneInput.definition.laneId)!;
          worktree = findWorktree(state, lane.worktreeId);
          session = findSession(state, lane.sessionId);
          reasons.push("Lane produced a validated review-ready handoff.");
          decisions.push({
            laneId: lane.laneId,
            status: "review_ready",
            targetState: "review_ready",
            action: "none",
            nextAction: "continue",
            assignedOwner,
            reasons: freezeList(reasons),
            lane,
            worktree,
            session
          });
          continue;
        } catch (error) {
          reasons.push(error instanceof Error ? error.message : "Lane review-ready handoff validation failed.");
          decisions.push({
            laneId: lane.laneId,
            status: "blocked",
            targetState: lane.state,
            action: "none",
            nextAction: "pause",
            assignedOwner,
            reasons: freezeList(reasons),
            lane,
            worktree,
            session
          });
          continue;
        }
      }

      if (dependencyStatus.blocked) {
        reasons.push(...dependencyStatus.reasons);
        decisions.push({
          laneId: lane.laneId,
          status: "blocked",
          targetState: lane.state,
          action: "none",
          nextAction: "pause",
          assignedOwner,
          reasons: freezeList(reasons),
          lane,
          worktree,
          session
        });
        continue;
      }

      if (waitingOn.length > 0) {
        if (lane.state === "active") {
          lane = commitLaneState(
            store,
            runId,
            actor,
            occurredAt,
            lane,
            "waiting",
            `dispatch:${lane.laneId}:waiting:${occurredAt}`,
            `Pause lane '${lane.laneId}' while blockers clear.`
          );
        }

        reasons.push(`Lane is waiting on: ${waitingOn.join(", ")}.`);
        decisions.push({
          laneId: lane.laneId,
          status: "blocked",
          targetState: lane.state,
          action: "none",
          nextAction: "pause",
          assignedOwner,
          reasons: freezeList(reasons),
          lane,
          worktree,
          session
        });
        continue;
      }

      if (laneInput.approvalGate) {
        const approvalId = resolveSupervisorApprovalId(lane.laneId, laneInput.approvalGate.request);
        const existingApproval = findApproval(state, approvalId);
        const approvalDecision = evaluateSupervisorApprovalGate({
          laneId: lane.laneId,
          actor,
          occurredAt,
          request: laneInput.approvalGate.request,
          existingApproval,
          signal: laneInput.approvalGate.signal
        });

        if (!sameApprovalRecord(existingApproval, approvalDecision.approval)) {
          store.commitMutation(runId, {
            mutationId: `dispatch:${lane.laneId}:approval:${occurredAt}`,
            actor,
            summary: `Persist approval state for lane '${lane.laneId}'.`,
            occurredAt,
            approvalUpserts: approvalDecision.approval ? [approvalDecision.approval] : [],
            sideEffects: [approvalDecision.nextAction === "resume" ? "approval-resolved" : "approval-requested"]
          });
          state = store.getRunState(runId)!;
          lane = findLane(state, laneInput.definition.laneId)!;
          worktree = findWorktree(state, lane.worktreeId);
          session = findSession(state, lane.sessionId);
        }

        if (session?.status === "paused" && laneInput.approvalGate.signal?.status !== "approved") {
          reasons.push(...approvalDecision.reasons, "Execution stays paused until an explicit approval event arrives.");
          decisions.push({
            laneId: lane.laneId,
            status: "blocked",
            targetState: lane.state,
            action: "none",
            nextAction: "pause",
            assignedOwner,
            reasons: freezeList(reasons),
            lane,
            worktree,
            session
          });
          continue;
        }

        if (approvalDecision.nextAction === "pause") {
          if (session?.status === "active") {
            const pauseResult = sessions.pauseSession({
              runId,
              laneId: lane.laneId,
              actor,
              mutationId: `dispatch:${lane.laneId}:pause:${occurredAt}`,
              occurredAt,
              summary: `Pause lane session for approval on '${lane.laneId}'.`
            });
            session = pauseResult.session;
          }

          if (lane.state === "active") {
            lane = commitLaneState(
              store,
              runId,
              actor,
              occurredAt,
              lane,
              "waiting",
              `dispatch:${lane.laneId}:approval-wait:${occurredAt}`,
              `Hold lane '${lane.laneId}' at an approval boundary.`
            );
          }

          reasons.push(...approvalDecision.reasons);
          decisions.push({
            laneId: lane.laneId,
            status: "blocked",
            targetState: lane.state,
            action: session?.status === "paused" ? "pause-session" : "none",
            nextAction: "pause",
            assignedOwner,
            reasons: freezeList(reasons),
            lane,
            worktree,
            session
          });
          continue;
        }

        if (approvalDecision.nextAction === "resume") {
          if (lane.state === "waiting") {
            lane = commitLaneState(
              store,
              runId,
              actor,
              occurredAt,
              lane,
              "active",
              `dispatch:${lane.laneId}:approval-resume:${occurredAt}`,
              `Resume lane '${lane.laneId}' after explicit approval.`
            );
            state = store.getRunState(runId)!;
            worktree = findWorktree(state, lane.worktreeId);
            session = findSession(state, lane.sessionId);
          }

          if (session?.status === "paused") {
            const sessionResult = sessions.resumeSession({
              runId,
              laneId: lane.laneId,
              owner: assignedOwner,
              actor,
              mutationId: `dispatch:${lane.laneId}:resume:${occurredAt}`,
              occurredAt,
              summary: `Resume paused lane session for '${lane.laneId}' after approval.`
            });
            session = sessionResult.session;
            lane = sessionResult.lane;
            reasons.push(...approvalDecision.reasons);
            decisions.push({
              laneId: lane.laneId,
              status: "active",
              targetState: "active",
              action: "resume-session",
              nextAction: "resume",
              assignedOwner,
              reasons: freezeList(reasons),
              lane,
              worktree,
              session
            });
            continue;
          }
        }
      }

      if (lane.state !== "active") {
        const activeLaneCount = countActiveLanes(state);
        if (activeLaneCount >= policy.maxActiveLanes) {
          reasons.push(`Active lane cap ${policy.maxActiveLanes} is already saturated.`);
          decisions.push({
            laneId: lane.laneId,
            status: "at-lane-cap",
            targetState: lane.state,
            action: "none",
            nextAction: "pause",
            assignedOwner,
            reasons: freezeList(reasons),
            lane,
            worktree,
            session
          });
          continue;
        }

        lane = commitLaneState(
          store,
          runId,
          actor,
          occurredAt,
          lane,
          "active",
          `dispatch:${lane.laneId}:active:${occurredAt}`,
          `Activate lane '${lane.laneId}' for dispatch.`
        );
        state = store.getRunState(runId)!;
      }

      worktree = findWorktree(state, lane.worktreeId);
      session = findSession(state, lane.sessionId);

      if (!worktree || worktree.status === "released") {
        const provisionResult: ProvisionSupervisorLaneWorktreeResult = provisioner.provisionLaneWorktree({
          runId,
          laneId: lane.laneId,
          branch: lane.branch,
          laneState: "active",
          actor,
          mutationId: `dispatch:${lane.laneId}:provision:${occurredAt}`,
          occurredAt,
          baseRef: input.baseRef,
          summary: `Provision lane '${lane.laneId}' worktree for active dispatch.`
        });
        lane = provisionResult.lane;
        worktree = provisionResult.worktree;
        reasons.push(...provisionResult.reasons);
        decisions.push({
          laneId: lane.laneId,
          status: "active",
          targetState: "active",
          action: provisionResult.action === "blocked" ? "none" : "provision-worktree",
          nextAction: "continue",
          assignedOwner,
          reasons: freezeList(reasons),
          lane,
          worktree,
          session,
        });
        continue;
      }

      if (!session) {
        const sessionResult: SupervisorSessionLifecycleResult = sessions.launchSession({
          runId,
          laneId: lane.laneId,
          owner: assignedOwner,
          actor,
          mutationId: `dispatch:${lane.laneId}:launch:${occurredAt}`,
          occurredAt,
          summary: `Launch the first runtime session for lane '${lane.laneId}'.`
        });
        session = sessionResult.session;
        lane = sessionResult.lane;
        decisions.push({
          laneId: lane.laneId,
          status: "active",
          targetState: "active",
          action: "launch-session",
          nextAction: "continue",
          assignedOwner,
          reasons: freezeList(reasons),
          lane,
          worktree,
          session
        });
        continue;
      }

      if (session.status === "paused" || session.status === "stalled" || session.status === "failed" || session.status === "replaced") {
        const sessionResult = session.status === "paused"
          ? sessions.resumeSession({
              runId,
              laneId: lane.laneId,
              owner: assignedOwner,
              actor,
              mutationId: `dispatch:${lane.laneId}:resume:${occurredAt}`,
              occurredAt,
              summary: `Resume paused lane session for '${lane.laneId}'.`
            })
          : sessions.replaceSession({
              runId,
              laneId: lane.laneId,
              owner: assignedOwner,
              actor,
              mutationId: `dispatch:${lane.laneId}:replace:${occurredAt}`,
              occurredAt,
              summary: `Replace stalled lane session for '${lane.laneId}'.`
            });

        session = sessionResult.session;
        lane = sessionResult.lane;
        decisions.push({
          laneId: lane.laneId,
          status: "active",
          targetState: "active",
          action: session.status === "active" && sessionResult.action === "resumed" ? "resume-session" : "replace-session",
          nextAction: session.status === "active" && sessionResult.action === "resumed" ? "resume" : "continue",
          assignedOwner,
          reasons: freezeList(reasons),
          lane,
          worktree,
          session
        });
        continue;
      }

      decisions.push({
        laneId: lane.laneId,
        status: "active",
        targetState: "active",
        action: "none",
        nextAction: "continue",
        assignedOwner,
        reasons: freezeList(reasons),
        lane,
        worktree,
        session
      });
    }

    return {
      policy,
      decisions: freezeList(decisions)
    };
  };

  return { run };
};
