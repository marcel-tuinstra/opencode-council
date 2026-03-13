import type { SupervisorApprovalBoundary, SupervisorApprovalGateRequest } from "./approval-gates";
import type {
  SupervisorApprovalRecord,
  SupervisorArtifactRecord,
  SupervisorLaneRecord,
  SupervisorPersistedArtifactKind,
  SupervisorRunState,
  SupervisorSessionRecord,
  SupervisorWorktreeRecord
} from "./durable-state-store";
import type { SupervisorLaneWorktreeReconciliationReport } from "./lane-worktree-provisioner";

export const DEFAULT_SUPERVISOR_RECOVERY_STALL_TIMEOUT_MS = 5 * 60 * 1000;

export type SupervisorRecoveryFailureClass =
  | "stuck-heartbeat"
  | "failed-session"
  | "worktree-drift"
  | "merge-conflict"
  | "tool-outage"
  | "partial-completion"
  | "unknown";

export type SupervisorRecoveryDisposition = "supervised-retry" | "repair" | "quarantine" | "escalate";

export type SupervisorRecoveryActionKind =
  | "pause-lane"
  | "replace-session"
  | "retry-tool"
  | "reconcile-worktree"
  | "rebuild-worktree"
  | "rebuild-artifacts"
  | "reopen-review"
  | "request-approval"
  | "escalate-human";

export type SupervisorRecoveryAction = {
  kind: SupervisorRecoveryActionKind;
  title: string;
  detail: string;
  approvalBoundary?: SupervisorApprovalBoundary;
};

export type SupervisorRecoveryClassification = {
  failureClass: SupervisorRecoveryFailureClass;
  disposition: SupervisorRecoveryDisposition;
  summary: string;
  reasons: readonly string[];
};

export type SupervisorLaneRecoveryContext = {
  lane: SupervisorLaneRecord;
  worktree?: SupervisorWorktreeRecord;
  session?: SupervisorSessionRecord;
  approvals: readonly SupervisorApprovalRecord[];
  artifacts: readonly SupervisorArtifactRecord[];
};

export type SupervisorToolOutageSignal = {
  system: string;
  scope: "runtime" | "git" | "mcp" | "network";
  retryable?: boolean;
  detail?: string;
};

export type SupervisorMergeConflictSignal = {
  files?: readonly string[];
  targetRef?: string;
  detail?: string;
};

export type SupervisorPartialCompletionSignal = {
  missingArtifacts?: readonly SupervisorPersistedArtifactKind[];
  pendingApprovalIds?: readonly string[];
  detail?: string;
};

export type ClassifySupervisorRecoveryPlaybookInput = {
  runState: SupervisorRunState;
  laneId: string;
  observedAt: string;
  stallTimeoutMs?: number;
  worktreeReconciliation?: SupervisorLaneWorktreeReconciliationReport;
  mergeConflict?: SupervisorMergeConflictSignal;
  toolOutage?: SupervisorToolOutageSignal;
  partialCompletion?: SupervisorPartialCompletionSignal;
};

export type SupervisorRecoveryPlaybook = {
  lane: SupervisorLaneRecord;
  worktree?: SupervisorWorktreeRecord;
  session?: SupervisorSessionRecord;
  classification: SupervisorRecoveryClassification;
  actions: readonly SupervisorRecoveryAction[];
  approvalRequest?: SupervisorApprovalGateRequest;
};

export type SupervisorPartialCompletionGap = {
  missingArtifacts: readonly SupervisorPersistedArtifactKind[];
  pendingApprovalIds: readonly string[];
  isIncomplete: boolean;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Recovery playbooks require a non-empty ${field}.`);
  }

  return normalized;
};

const assertTimestamp = (value: string, field: string): string => {
  const normalized = assertNonEmpty(value, field);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Recovery playbooks require a valid ${field}.`);
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

const normalizeArtifactKinds = (kinds: readonly SupervisorPersistedArtifactKind[] | undefined): readonly SupervisorPersistedArtifactKind[] => (
  freezeList(Array.from(new Set((kinds ?? []).map((kind) => kind.trim() as SupervisorPersistedArtifactKind))))
);

const normalizeStringList = (values: readonly string[] | undefined): readonly string[] => (
  freezeList(Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))))
);

const createAction = (
  kind: SupervisorRecoveryActionKind,
  title: string,
  detail: string,
  approvalBoundary?: SupervisorApprovalBoundary
): SupervisorRecoveryAction => freezeRecord({ kind, title, detail, approvalBoundary });

const createApprovalRequest = (
  boundary: SupervisorApprovalBoundary,
  requestedAction: string,
  summary: string,
  rationale: string,
  targetRef?: string
): SupervisorApprovalGateRequest => freezeRecord({
  boundary,
  requestedAction,
  summary,
  rationale,
  context: targetRef ? freezeRecord({ targetRef }) : undefined
});

export const getSupervisorLaneRecoveryContext = (
  runState: SupervisorRunState,
  laneId: string
): SupervisorLaneRecoveryContext => {
  const normalizedLaneId = assertNonEmpty(laneId, "lane id");
  const lane = findLane(runState, normalizedLaneId);

  if (!lane) {
    throw new Error(`Run '${runState.run.runId}' does not include lane '${normalizedLaneId}'.`);
  }

  return freezeRecord({
    lane,
    worktree: findWorktree(runState, lane.worktreeId),
    session: findSession(runState, lane.sessionId),
    approvals: freezeList(runState.approvals.filter((approval) => approval.laneId === lane.laneId)),
    artifacts: freezeList(runState.artifacts.filter((artifact) => artifact.laneId === lane.laneId))
  });
};

export const detectSupervisorPartialCompletionGap = (
  context: SupervisorLaneRecoveryContext
): SupervisorPartialCompletionGap => {
  const requiredArtifacts: SupervisorPersistedArtifactKind[] = context.lane.state === "review_ready"
    ? ["branch", "pull-request", "review-packet"]
    : [];
  const readyArtifacts = new Set(
    context.artifacts
      .filter((artifact) => artifact.status === "ready")
      .map((artifact) => artifact.kind)
  );
  const missingArtifacts = requiredArtifacts.filter((kind) => !readyArtifacts.has(kind));
  const pendingApprovalIds = context.approvals
    .filter((approval) => approval.status === "pending")
    .map((approval) => approval.approvalId)
    .sort((left, right) => left.localeCompare(right));

  return freezeRecord({
    missingArtifacts: freezeList(missingArtifacts),
    pendingApprovalIds: freezeList(pendingApprovalIds),
    isIncomplete: missingArtifacts.length > 0 || pendingApprovalIds.length > 0
  });
};

const getRelevantReconciliationReasons = (
  context: SupervisorLaneRecoveryContext,
  report?: SupervisorLaneWorktreeReconciliationReport
): { drift: readonly string[]; collisions: readonly string[]; orphans: readonly string[] } => {
  if (!report || !context.worktree) {
    return {
      drift: freezeList([]),
      collisions: freezeList([]),
      orphans: freezeList([])
    };
  }

  const drift = report.drift
    .filter((issue) => issue.laneId === context.lane.laneId || issue.worktreeId === context.worktree?.worktreeId)
    .map((issue) => issue.reason);
  const collisions = report.collisions
    .filter((issue) => issue.laneId === context.lane.laneId || issue.worktreeId === context.worktree?.worktreeId || issue.branch === context.lane.branch || issue.path === context.worktree?.path)
    .map((issue) => issue.reason);
  const orphans = report.orphans
    .filter((issue) => issue.worktreeId === context.worktree?.worktreeId || issue.path === context.worktree?.path)
    .map((issue) => issue.reason);

  return {
    drift: freezeList(drift),
    collisions: freezeList(collisions),
    orphans: freezeList(orphans)
  };
};

const hasStaleHeartbeat = (
  session: SupervisorSessionRecord | undefined,
  observedAt: string,
  stallTimeoutMs: number
): boolean => {
  if (!session || session.status !== "active") {
    return false;
  }

  const heartbeatAt = session.lastHeartbeatAt ?? session.attachedAt ?? session.startedAt;
  if (!heartbeatAt) {
    return false;
  }

  return Date.parse(observedAt) - Date.parse(heartbeatAt) >= stallTimeoutMs;
};

const createPlaybook = (
  context: SupervisorLaneRecoveryContext,
  classification: SupervisorRecoveryClassification,
  actions: readonly SupervisorRecoveryAction[],
  approvalRequest?: SupervisorApprovalGateRequest
): SupervisorRecoveryPlaybook => freezeRecord({
  lane: context.lane,
  worktree: context.worktree,
  session: context.session,
  classification,
  actions: freezeList(actions),
  approvalRequest
});

export const classifySupervisorRecoveryPlaybook = (
  input: ClassifySupervisorRecoveryPlaybookInput
): SupervisorRecoveryPlaybook => {
  const observedAt = assertTimestamp(input.observedAt, "observation timestamp");
  const context = getSupervisorLaneRecoveryContext(input.runState, input.laneId);
  const stallTimeoutMs = input.stallTimeoutMs ?? DEFAULT_SUPERVISOR_RECOVERY_STALL_TIMEOUT_MS;
  const reconciliation = getRelevantReconciliationReasons(context, input.worktreeReconciliation);
  const partialCompletion = detectSupervisorPartialCompletionGap(context);
  const explicitPartialCompletion = {
    missingArtifacts: normalizeArtifactKinds(input.partialCompletion?.missingArtifacts),
    pendingApprovalIds: normalizeStringList(input.partialCompletion?.pendingApprovalIds),
    detail: input.partialCompletion?.detail?.trim() || undefined
  };

  if (reconciliation.collisions.length > 0 || reconciliation.orphans.length > 0) {
    const reasons = [...reconciliation.collisions, ...reconciliation.orphans];
    const approvalRequest = createApprovalRequest(
      "destructive",
      `quarantine lane '${context.lane.laneId}' worktree`,
      "Quarantine the lane worktree before rebuilding recovery state.",
      "Colliding or orphaned worktree state makes automated repair unsafe without explicit approval.",
      context.lane.branch
    );

    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "worktree-drift",
        disposition: "quarantine",
        summary: `Lane '${context.lane.laneId}' has conflicting durable or filesystem worktree state and should be quarantined first.`,
        reasons: freezeList(reasons)
      }),
      [
        createAction("pause-lane", "Pause lane execution", "Hold the lane in waiting until the worktree mapping is safe again."),
        createAction("request-approval", "Request destructive approval", "Require explicit approval before releasing or rebuilding the conflicted worktree.", "destructive"),
        createAction("rebuild-worktree", "Quarantine and rebuild the worktree", "Release the current worktree binding, provision a fresh worktree, and relaunch from durable state after approval."),
        createAction("escalate-human", "Escalate to a human owner", "Attach the reconciliation report so a human can confirm the quarantine boundary before execution resumes.")
      ],
      approvalRequest
    );
  }

  if (reconciliation.drift.length > 0) {
    const approvalRequest = createApprovalRequest(
      "destructive",
      `repair lane '${context.lane.laneId}' worktree drift`,
      "Repair the drifted lane worktree before more execution continues.",
      "Worktree drift breaks the durable lane-to-worktree contract, so Alpha requires explicit approval before destructive repair.",
      context.lane.branch
    );

    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "worktree-drift",
        disposition: "repair",
        summary: `Lane '${context.lane.laneId}' drifted away from its durable worktree record and needs a supervised repair.`,
        reasons: reconciliation.drift
      }),
      [
        createAction("pause-lane", "Pause lane execution", "Keep the lane out of active execution while git and durable state disagree."),
        createAction("reconcile-worktree", "Reconcile durable and git state", "Re-run reconciliation and confirm the exact branch/path drift before changing the worktree."),
        createAction("request-approval", "Request destructive approval", "Require explicit approval before releasing or rebuilding the drifted worktree.", "destructive"),
        createAction("rebuild-worktree", "Rebuild the worktree", "Release the drifted worktree and provision a fresh one from the recorded branch after approval.")
      ],
      approvalRequest
    );
  }

  if (input.mergeConflict) {
    const files = normalizeStringList(input.mergeConflict.files);
    const reasons = [
      input.mergeConflict.detail?.trim() || "Git reported a merge conflict that blocks autonomous progress.",
      files.length > 0 ? `Conflicted files: ${files.join(", ")}.` : ""
    ].filter(Boolean);

    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "merge-conflict",
        disposition: "repair",
        summary: `Lane '${context.lane.laneId}' needs a supervised merge-conflict repair before review can continue.`,
        reasons: freezeList(reasons)
      }),
      [
        createAction("pause-lane", "Pause lane execution", "Keep the lane out of review-ready flow until the conflict is resolved in the lane worktree."),
        createAction("replace-session", "Use a supervised repair session", "Attach or replace the lane session so one owner resolves the conflict inside the durable worktree."),
        createAction("rebuild-artifacts", "Refresh review artifacts", "Rebuild the evidence packet, branch state, or PR details after the conflict resolution lands."),
        createAction("reopen-review", "Return to active review prep", "Move the lane back through active work until the repaired branch is review ready again.")
      ]
    );
  }

  if (input.toolOutage) {
    const system = assertNonEmpty(input.toolOutage.system, "tool outage system");
    const reasons = freezeList([
      input.toolOutage.detail?.trim() || `${system} is unavailable for the current lane session.`,
      `Outage scope: ${input.toolOutage.scope}.`
    ]);

    if (input.toolOutage.retryable !== false) {
      return createPlaybook(
        context,
        freezeRecord({
          failureClass: "tool-outage",
          disposition: "supervised-retry",
          summary: `Lane '${context.lane.laneId}' can retry after the ${system} outage clears.`,
          reasons
        }),
        [
          createAction("pause-lane", "Pause lane execution", "Hold the lane while the required tool or provider is unavailable."),
          createAction("retry-tool", "Retry the failed tool path", `Retry ${system} with the same durable lane state once the outage clears.`),
          createAction("replace-session", "Replace the interrupted session", "Launch a fresh session if the outage left the current runtime session in an uncertain state.")
        ]
      );
    }

    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "tool-outage",
        disposition: "escalate",
        summary: `Lane '${context.lane.laneId}' cannot recover autonomously from the ${system} outage.`,
        reasons
      }),
      [
        createAction("pause-lane", "Pause lane execution", "Keep the lane waiting until the unavailable system is restored or replaced."),
        createAction("escalate-human", "Escalate service outage", `Request a human decision because ${system} is not safely retryable in Alpha.`)
      ]
    );
  }

  if (context.session?.status === "failed") {
    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "failed-session",
        disposition: "supervised-retry",
        summary: `Lane '${context.lane.laneId}' should replace its failed runtime session and continue from durable state.`,
        reasons: freezeList([
          context.session.failureReason ?? `Session '${context.session.sessionId}' is marked failed in durable state.`
        ])
      }),
      [
        createAction("pause-lane", "Pause lane execution", "Record the failure before another session starts writing in the same lane."),
        createAction("replace-session", "Replace the failed session", "Launch a new session against the same durable worktree so the retry stays lane-local and auditable.")
      ]
    );
  }

  if (context.session?.status === "stalled" || hasStaleHeartbeat(context.session, observedAt, stallTimeoutMs)) {
    const heartbeatAt = context.session?.lastHeartbeatAt ?? context.session?.attachedAt ?? context.session?.startedAt;

    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "stuck-heartbeat",
        disposition: "supervised-retry",
        summary: `Lane '${context.lane.laneId}' lost heartbeat continuity and should retry with a fresh session.`,
        reasons: freezeList([
          heartbeatAt
            ? `Latest heartbeat '${heartbeatAt}' exceeded the ${stallTimeoutMs}ms recovery timeout.`
            : "The current session has no recoverable heartbeat timestamp."
        ])
      }),
      [
        createAction("pause-lane", "Pause lane execution", "Stop assuming the current runtime session is healthy."),
        createAction("replace-session", "Replace the stale session", "Launch a fresh session tied to the same durable worktree so the supervisor retries under one owner.")
      ]
    );
  }

  const mergedMissingArtifacts = freezeList(Array.from(new Set([
    ...partialCompletion.missingArtifacts,
    ...explicitPartialCompletion.missingArtifacts
  ])).sort((left, right) => left.localeCompare(right)));
  const mergedPendingApprovals = freezeList(Array.from(new Set([
    ...partialCompletion.pendingApprovalIds,
    ...explicitPartialCompletion.pendingApprovalIds
  ])).sort((left, right) => left.localeCompare(right)));

  if (mergedMissingArtifacts.length > 0 || mergedPendingApprovals.length > 0 || explicitPartialCompletion.detail) {
    const reasons = [
      mergedMissingArtifacts.length > 0 ? `Missing ready artifacts: ${mergedMissingArtifacts.join(", ")}.` : "",
      mergedPendingApprovals.length > 0 ? `Pending approvals: ${mergedPendingApprovals.join(", ")}.` : "",
      explicitPartialCompletion.detail ?? ""
    ].filter(Boolean);

    return createPlaybook(
      context,
      freezeRecord({
        failureClass: "partial-completion",
        disposition: mergedPendingApprovals.length > 0 ? "escalate" : "repair",
        summary: mergedPendingApprovals.length > 0
          ? `Lane '${context.lane.laneId}' is partially complete and still blocked on explicit approval.`
          : `Lane '${context.lane.laneId}' is partially complete and needs its review artifacts rebuilt.`,
        reasons: freezeList(reasons)
      }),
      mergedPendingApprovals.length > 0
        ? [
            createAction("pause-lane", "Pause lane execution", "Hold the lane until the missing approval arrives."),
            createAction("request-approval", "Wait for approval resolution", "Do not infer completion while approval remains pending.", "merge"),
            createAction("escalate-human", "Escalate the missing decision", "Ask the named reviewer or merge owner to clear the pending approval explicitly.")
          ]
        : [
            createAction("rebuild-artifacts", "Rebuild missing review artifacts", "Regenerate the missing branch, PR, or review packet evidence from durable state."),
            createAction("reopen-review", "Return to active review prep", "Keep the lane out of done until the repaired artifacts are linked and review ready again.")
          ]
    );
  }

  return createPlaybook(
    context,
    freezeRecord({
      failureClass: "unknown",
      disposition: "escalate",
      summary: `Lane '${context.lane.laneId}' needs human classification before recovery continues.`,
      reasons: freezeList(["No Alpha recovery playbook matched the current durable state and supplied incident signals."])
    }),
    [
      createAction("pause-lane", "Pause lane execution", "Hold the lane while a human classifies the failure."),
      createAction("escalate-human", "Escalate for manual triage", "Attach the latest durable state, approvals, and artifacts so the next step is explicit and auditable.")
    ]
  );
};
