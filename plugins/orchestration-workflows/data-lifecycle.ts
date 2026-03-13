import type { AdHocRunHistoryRecord } from "./ad-hoc-run-history";
import type {
  SupervisorPersistedRunStatus,
  SupervisorPersistedSessionStatus,
  SupervisorPersistedWorktreeStatus,
  SupervisorRunState
} from "./durable-state-store";
import type { SupervisorObservedThresholdEvent } from "./observability-dashboard";
import type { ReviewRoutingDecision } from "./review-coordination";

export type SupervisorDataLifecycleStage = "active" | "archived" | "deleted";
export type SupervisorDataLifecycleRecommendation = "retain" | "archive-review" | "delete-review";
export type SupervisorLifecycleRecordType = "durable-run" | "ad-hoc-run";

export type SupervisorLifecyclePolicyWindow = {
  archiveReviewAfterDays: number;
  deleteReviewAfterDays: number;
};

export type SupervisorDataLifecyclePolicy = {
  durableRuns: SupervisorLifecyclePolicyWindow;
  adHocRuns: SupervisorLifecyclePolicyWindow;
  failClosedSignals: readonly string[];
};

export type SupervisorDurableRunLifecycleInput = {
  runState: SupervisorRunState;
  reviewRouting?: readonly ReviewRoutingDecision[];
  thresholdEvents?: readonly SupervisorObservedThresholdEvent[];
  unresolvedGovernance?: boolean;
};

export type SupervisorAdHocRunLifecycleInput = {
  record: AdHocRunHistoryRecord;
  reviewRouting?: readonly ReviewRoutingDecision[];
  thresholdEvents?: readonly SupervisorObservedThresholdEvent[];
  unresolvedGovernance?: boolean;
};

export type CreateSupervisorDataLifecycleReportInput = {
  generatedAt: string;
  durableRuns?: readonly SupervisorDurableRunLifecycleInput[];
  adHocRuns?: readonly SupervisorAdHocRunLifecycleInput[];
  policy?: Partial<SupervisorDataLifecyclePolicy>;
};

export type SupervisorLifecycleInventory = {
  lanes: number;
  worktrees: number;
  unreleasedWorktrees: number;
  sessions: number;
  retentionBlockingSessions: number;
  approvals: number;
  pendingApprovals: number;
  artifacts: number;
  auditEntries: number;
  evidenceLinks: number;
  relatedArtifacts: number;
  thresholdEvents: number;
};

export type SupervisorLifecycleAssessment = {
  recordType: SupervisorLifecycleRecordType;
  recordId: string;
  currentStage: SupervisorDataLifecycleStage;
  nextStage?: Exclude<SupervisorDataLifecycleStage, "active">;
  recommendation: SupervisorDataLifecycleRecommendation;
  ageDays: number;
  inventory: SupervisorLifecycleInventory;
  blockers: readonly string[];
  reasons: readonly string[];
};

export type SupervisorDataLifecycleReport = {
  generatedAt: string;
  policy: SupervisorDataLifecyclePolicy;
  totals: {
    durableRuns: number;
    adHocRuns: number;
    retain: number;
    archiveReview: number;
    deleteReview: number;
  };
  durableRuns: readonly SupervisorLifecycleAssessment[];
  adHocRuns: readonly SupervisorLifecycleAssessment[];
};

export const DEFAULT_SUPERVISOR_DATA_LIFECYCLE_POLICY: SupervisorDataLifecyclePolicy = {
  durableRuns: {
    archiveReviewAfterDays: 30,
    deleteReviewAfterDays: 180
  },
  adHocRuns: {
    archiveReviewAfterDays: 14,
    deleteReviewAfterDays: 90
  },
  failClosedSignals: Object.freeze([
    "planned, active, paused, waiting, and review_ready durable runs always stay retained",
    "pending approvals keep the record retained until a human closes the checkpoint",
    "non-released worktrees keep the record retained until the workspace is released",
    "session records keep the record retained in v1 so session evidence is never deleted implicitly",
    "non-accept review routing and unresolved governance keep the record retained",
    "threshold evidence keeps the record retained for audit review"
  ])
};

const ACTIVE_RUN_STATUSES = new Set<SupervisorPersistedRunStatus>([
  "planned",
  "active",
  "paused",
  "waiting",
  "review_ready"
]);

const RETENTION_BLOCKING_SESSION_STATUSES = new Set<SupervisorPersistedSessionStatus>([
  "launching",
  "active",
  "paused",
  "stalled",
  "completed",
  "failed",
  "replaced"
]);

const UNRELEASED_WORKTREE_STATUSES = new Set<SupervisorPersistedWorktreeStatus>(["active", "parked"]);

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Supervisor data lifecycle requires a non-empty ${field}.`);
  }

  return normalized;
};

const assertTimestamp = (value: string, field: string): string => {
  const normalized = assertNonEmpty(value, field);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Supervisor data lifecycle requires a valid ${field}.`);
  }

  return normalized;
};

const mergePolicy = (policy?: Partial<SupervisorDataLifecyclePolicy>): SupervisorDataLifecyclePolicy => ({
  durableRuns: {
    archiveReviewAfterDays: policy?.durableRuns?.archiveReviewAfterDays
      ?? DEFAULT_SUPERVISOR_DATA_LIFECYCLE_POLICY.durableRuns.archiveReviewAfterDays,
    deleteReviewAfterDays: policy?.durableRuns?.deleteReviewAfterDays
      ?? DEFAULT_SUPERVISOR_DATA_LIFECYCLE_POLICY.durableRuns.deleteReviewAfterDays
  },
  adHocRuns: {
    archiveReviewAfterDays: policy?.adHocRuns?.archiveReviewAfterDays
      ?? DEFAULT_SUPERVISOR_DATA_LIFECYCLE_POLICY.adHocRuns.archiveReviewAfterDays,
    deleteReviewAfterDays: policy?.adHocRuns?.deleteReviewAfterDays
      ?? DEFAULT_SUPERVISOR_DATA_LIFECYCLE_POLICY.adHocRuns.deleteReviewAfterDays
  },
  failClosedSignals: freezeList(policy?.failClosedSignals ?? DEFAULT_SUPERVISOR_DATA_LIFECYCLE_POLICY.failClosedSignals)
});

const ageInDays = (generatedAt: string, observedAt: string): number => {
  const ageMs = Date.parse(generatedAt) - Date.parse(observedAt);
  return Number((Math.max(ageMs, 0) / 86_400_000).toFixed(2));
};

const dedupeStrings = (values: readonly string[]): readonly string[] => freezeList(Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))));

const getReviewRoutingBlockers = (reviewRouting: readonly ReviewRoutingDecision[]): string[] => reviewRouting
  .filter((decision) => decision.outcome !== "accept")
  .map((decision) => `review-routing:${decision.outcome}`);

const getThresholdBlockers = (thresholdEvents: readonly SupervisorObservedThresholdEvent[]): string[] => thresholdEvents.map(
  (event) => `threshold:${event.thresholdKey}`
);

const recommendLifecycleAction = (input: {
  ageDays: number;
  archiveReviewAfterDays: number;
  deleteReviewAfterDays: number;
  hasBlockers: boolean;
}): Pick<SupervisorLifecycleAssessment, "currentStage" | "nextStage" | "recommendation"> => {
  if (input.hasBlockers) {
    return {
      currentStage: "active",
      nextStage: "archived",
      recommendation: "retain"
    };
  }

  if (input.ageDays >= input.deleteReviewAfterDays) {
    return {
      currentStage: "archived",
      nextStage: "deleted",
      recommendation: "delete-review"
    };
  }

  if (input.ageDays >= input.archiveReviewAfterDays) {
    return {
      currentStage: "archived",
      nextStage: "deleted",
      recommendation: "archive-review"
    };
  }

  return {
    currentStage: "active",
    nextStage: "archived",
    recommendation: "retain"
  };
};

const assessDurableRunLifecycle = (
  generatedAt: string,
  input: SupervisorDurableRunLifecycleInput,
  policy: SupervisorDataLifecyclePolicy
): SupervisorLifecycleAssessment => {
  const reviewRouting = input.reviewRouting ?? [];
  const thresholdEvents = input.thresholdEvents ?? [];
  const pendingApprovals = input.runState.approvals.filter((approval) => approval.status === "pending");
  const unreleasedWorktrees = input.runState.worktrees.filter((worktree) => UNRELEASED_WORKTREE_STATUSES.has(worktree.status));
  const retentionBlockingSessions = input.runState.sessions.filter((session) => RETENTION_BLOCKING_SESSION_STATUSES.has(session.status));
  const blockers = dedupeStrings([
    ...(ACTIVE_RUN_STATUSES.has(input.runState.run.status) ? [`run-status:${input.runState.run.status}`] : []),
    ...(pendingApprovals.length > 0 ? ["pending-approvals"] : []),
    ...(unreleasedWorktrees.length > 0 ? ["unreleased-worktrees"] : []),
    ...(retentionBlockingSessions.length > 0 ? ["sessions-present"] : []),
    ...(input.unresolvedGovernance ? ["unresolved-governance"] : []),
    ...getReviewRoutingBlockers(reviewRouting),
    ...getThresholdBlockers(thresholdEvents)
  ]);
  const inventory = freezeRecord({
    lanes: input.runState.lanes.length,
    worktrees: input.runState.worktrees.length,
    unreleasedWorktrees: unreleasedWorktrees.length,
    sessions: input.runState.sessions.length,
    retentionBlockingSessions: retentionBlockingSessions.length,
    approvals: input.runState.approvals.length,
    pendingApprovals: pendingApprovals.length,
    artifacts: input.runState.artifacts.length,
    auditEntries: input.runState.auditLog.length,
    evidenceLinks: 0,
    relatedArtifacts: 0,
    thresholdEvents: thresholdEvents.length
  });
  const ageDays = ageInDays(generatedAt, input.runState.run.updatedAt);
  const recommendation = recommendLifecycleAction({
    ageDays,
    archiveReviewAfterDays: policy.durableRuns.archiveReviewAfterDays,
    deleteReviewAfterDays: policy.durableRuns.deleteReviewAfterDays,
    hasBlockers: blockers.length > 0
  });

  return freezeRecord({
    recordType: "durable-run",
    recordId: input.runState.run.runId,
    ageDays,
    inventory,
    blockers,
    reasons: freezeList([
      `durable run last changed ${ageDays} day(s) ago`,
      ...(blockers.length > 0
        ? blockers.map((blocker) => `retained because ${blocker}`)
        : [`eligible for ${recommendation.recommendation} under the durable run lifecycle window`])
    ]),
    ...recommendation
  });
};

const assessAdHocRunLifecycle = (
  generatedAt: string,
  input: SupervisorAdHocRunLifecycleInput,
  policy: SupervisorDataLifecyclePolicy
): SupervisorLifecycleAssessment => {
  const reviewRouting = input.reviewRouting ?? [];
  const thresholdEvents = input.thresholdEvents ?? [];
  const blockers = dedupeStrings([
    ...(input.unresolvedGovernance ? ["unresolved-governance"] : []),
    ...getReviewRoutingBlockers(reviewRouting),
    ...getThresholdBlockers(thresholdEvents)
  ]);
  const inventory = freezeRecord({
    lanes: 0,
    worktrees: 0,
    unreleasedWorktrees: 0,
    sessions: 0,
    retentionBlockingSessions: 0,
    approvals: 0,
    pendingApprovals: 0,
    artifacts: 0,
    auditEntries: 0,
    evidenceLinks: input.record.evidenceLinks.length,
    relatedArtifacts: input.record.relatedArtifacts.length,
    thresholdEvents: thresholdEvents.length
  });
  const ageDays = ageInDays(generatedAt, input.record.createdAt);
  const recommendation = recommendLifecycleAction({
    ageDays,
    archiveReviewAfterDays: policy.adHocRuns.archiveReviewAfterDays,
    deleteReviewAfterDays: policy.adHocRuns.deleteReviewAfterDays,
    hasBlockers: blockers.length > 0
  });

  return freezeRecord({
    recordType: "ad-hoc-run",
    recordId: input.record.runId,
    ageDays,
    inventory,
    blockers,
    reasons: freezeList([
      `ad-hoc run was captured ${ageDays} day(s) ago`,
      ...(blockers.length > 0
        ? blockers.map((blocker) => `retained because ${blocker}`)
        : [`eligible for ${recommendation.recommendation} under the ad-hoc lifecycle window`])
    ]),
    ...recommendation
  });
};

export const createSupervisorDataLifecycleReport = (
  input: CreateSupervisorDataLifecycleReportInput
): SupervisorDataLifecycleReport => {
  const generatedAt = assertTimestamp(input.generatedAt, "generated timestamp");
  const policy = mergePolicy(input.policy);
  const durableRuns = freezeList((input.durableRuns ?? []).map((run) => assessDurableRunLifecycle(generatedAt, run, policy)));
  const adHocRuns = freezeList((input.adHocRuns ?? []).map((run) => assessAdHocRunLifecycle(generatedAt, run, policy)));
  const assessments = [...durableRuns, ...adHocRuns];

  return freezeRecord({
    generatedAt,
    policy,
    totals: {
      durableRuns: durableRuns.length,
      adHocRuns: adHocRuns.length,
      retain: assessments.filter((assessment) => assessment.recommendation === "retain").length,
      archiveReview: assessments.filter((assessment) => assessment.recommendation === "archive-review").length,
      deleteReview: assessments.filter((assessment) => assessment.recommendation === "delete-review").length
    },
    durableRuns,
    adHocRuns
  });
};
