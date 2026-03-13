import type { SupervisorApprovalRecord } from "./durable-state-store";
import { createSupervisorReasonDetail, type SupervisorReasonDetail } from "./reason-codes";
import { getSupervisorPolicy } from "./supervisor-config";

export type SupervisorApprovalBoundary =
  | "merge"
  | "release"
  | "destructive"
  | "security-sensitive"
  | "budget-exception"
  | "automation-widening";

export type SupervisorApprovalContext = {
  changedPaths?: readonly string[];
  targetRef?: string;
  budgetUsagePercent?: number;
  budgetThresholdPercent?: number;
  automationChangeSummary?: string;
  riskSummary?: string;
  metadata?: Readonly<Record<string, string>>;
};

export type SupervisorApprovalGateRequest = {
  approvalId?: string;
  boundary: SupervisorApprovalBoundary;
  requestedAction: string;
  summary: string;
  rationale: string;
  requiresApproval?: boolean;
  context?: SupervisorApprovalContext;
};

export type SupervisorApprovalSignal = {
  status: "approved" | "rejected";
  actor: string;
  occurredAt: string;
  note: string;
};

export type EvaluateSupervisorApprovalGateInput = {
  laneId: string;
  actor: string;
  occurredAt: string;
  request: SupervisorApprovalGateRequest;
  existingApproval?: SupervisorApprovalRecord;
  signal?: SupervisorApprovalSignal;
};

export type SupervisorApprovalNextAction = "continue" | "pause" | "resume";

export type SupervisorApprovalGateDecision = {
  approvalId: string;
  requiresApproval: boolean;
  status: "not-required" | SupervisorApprovalRecord["status"];
  nextAction: SupervisorApprovalNextAction;
  approval: SupervisorApprovalRecord | null;
  reasons: readonly string[];
  reasonDetails: readonly SupervisorReasonDetail[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Approval gates require a non-empty ${field}.`);
  }

  return normalized;
};

const assertTimestamp = (value: string, field: string): string => {
  const normalized = assertNonEmpty(value, field);

  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Approval gates require a valid ${field}.`);
  }

  return normalized;
};

const normalizeStringList = (values?: readonly string[]): readonly string[] => freezeList(
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
);

const normalizeMetadata = (metadata?: Readonly<Record<string, string>>): Readonly<Record<string, string>> | undefined => {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata)
    .map(([key, value]) => [key.trim(), value.trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.freeze(Object.fromEntries(entries));
};

const normalizeContext = (context?: SupervisorApprovalContext): SupervisorApprovalContext => ({
  changedPaths: normalizeStringList(context?.changedPaths),
  targetRef: context?.targetRef?.trim() || undefined,
  budgetUsagePercent: context?.budgetUsagePercent,
  budgetThresholdPercent: context?.budgetThresholdPercent,
  automationChangeSummary: context?.automationChangeSummary?.trim() || undefined,
  riskSummary: context?.riskSummary?.trim() || undefined,
  metadata: normalizeMetadata(context?.metadata)
});

const slugify = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "") || "approval";

const getBoundaryApprovalRequirement = (boundary: SupervisorApprovalBoundary): boolean => {
  const boundaries = getSupervisorPolicy().approvalGates.boundaries;

  switch (boundary) {
    case "merge":
      return boundaries.merge;
    case "release":
      return boundaries.release;
    case "destructive":
      return boundaries.destructive;
    case "security-sensitive":
      return boundaries.securitySensitive;
    case "budget-exception":
      return boundaries.budgetExceptions;
    case "automation-widening":
      return boundaries.automationWidening;
  }
};

export const resolveSupervisorApprovalId = (
  laneId: string,
  request: Pick<SupervisorApprovalGateRequest, "approvalId" | "boundary" | "requestedAction">
): string => {
  if (request.approvalId?.trim()) {
    return request.approvalId.trim();
  }

  return `${assertNonEmpty(laneId, "lane id")}:${request.boundary}:${slugify(request.requestedAction)}`;
};

export const evaluateSupervisorApprovalGate = (
  input: EvaluateSupervisorApprovalGateInput
): SupervisorApprovalGateDecision => {
  const laneId = assertNonEmpty(input.laneId, "lane id");
  const actor = assertNonEmpty(input.actor, "actor");
  const occurredAt = assertTimestamp(input.occurredAt, "timestamp");
  const requestedAction = assertNonEmpty(input.request.requestedAction, "requested action");
  const summary = assertNonEmpty(input.request.summary, "approval summary");
  const rationale = assertNonEmpty(input.request.rationale, "approval rationale");
  const approvalId = resolveSupervisorApprovalId(laneId, input.request);
  const requiresApproval = input.request.requiresApproval ?? getBoundaryApprovalRequirement(input.request.boundary);

  if (!requiresApproval) {
    return {
      approvalId,
      requiresApproval: false,
      status: "not-required",
      nextAction: "continue",
      approval: null,
      reasons: freezeList(["Action stays inside the configured autonomous guardrails."]),
      reasonDetails: freezeList([])
    };
  }

  const context = normalizeContext(input.request.context);
  const existingApproval = input.existingApproval;

  if (existingApproval && existingApproval.approvalId !== approvalId) {
    throw new Error(`Lane '${laneId}' approval gate expected '${approvalId}' but received '${existingApproval.approvalId}'.`);
  }

  const baseApproval: SupervisorApprovalRecord = Object.freeze({
    approvalId,
    laneId,
    status: existingApproval?.status ?? "pending",
    boundary: input.request.boundary,
    requestedAction,
    summary,
    rationale,
    requestedBy: existingApproval?.requestedBy ?? actor,
    requestedAt: existingApproval?.requestedAt ?? occurredAt,
    decidedBy: existingApproval?.decidedBy,
    decidedAt: existingApproval?.decidedAt,
    decisionNote: existingApproval?.decisionNote,
    updatedAt: occurredAt,
    context
  });

  if (!input.signal) {
    const status = existingApproval?.status ?? "pending";

    return {
      approvalId,
      requiresApproval: true,
      status,
      nextAction: status === "approved" ? "continue" : "pause",
      approval: Object.freeze({ ...baseApproval, status, updatedAt: existingApproval?.updatedAt ?? occurredAt }),
      reasons: freezeList([
        `Human approval is required at the ${input.request.boundary} governance boundary before ${requestedAction}.`
      ]),
      reasonDetails: freezeList([
        createSupervisorReasonDetail("approval.governance-boundary", {
          path: input.request.boundary,
          actionReason: requestedAction
        })
      ])
    };
  }

  const signalOccurredAt = assertTimestamp(input.signal.occurredAt, "approval signal timestamp");
  const signalActor = assertNonEmpty(input.signal.actor, "approval signal actor");
  const signalNote = assertNonEmpty(input.signal.note, "approval signal note");

  if (input.signal.status === "approved") {
    return {
      approvalId,
      requiresApproval: true,
      status: "approved",
      nextAction: "resume",
      approval: Object.freeze({
        ...baseApproval,
        status: "approved",
        decidedBy: signalActor,
        decidedAt: signalOccurredAt,
        decisionNote: signalNote,
        updatedAt: signalOccurredAt
      }),
      reasons: freezeList([`Explicit human approval cleared ${requestedAction} to resume execution.`]),
      reasonDetails: freezeList([
        createSupervisorReasonDetail("approval.resume-approved", {
          path: input.request.boundary,
          actionReason: requestedAction
        })
      ])
    };
  }

  return {
    approvalId,
    requiresApproval: true,
    status: "rejected",
    nextAction: "pause",
    approval: Object.freeze({
      ...baseApproval,
      status: "rejected",
      decidedBy: signalActor,
      decidedAt: signalOccurredAt,
      decisionNote: signalNote,
      updatedAt: signalOccurredAt
    }),
    reasons: freezeList([`Human review rejected ${requestedAction}, so execution remains paused.`]),
    reasonDetails: freezeList([
      createSupervisorReasonDetail("approval.rejected-hold", {
        path: input.request.boundary,
        actionReason: requestedAction
      })
    ])
  };
};
