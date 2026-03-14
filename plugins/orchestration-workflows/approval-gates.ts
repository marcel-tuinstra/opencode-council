import type { SupervisorApprovalRecord } from "./durable-state-store";
import {
  createSupervisorThresholdEventId,
  type SupervisorThresholdEvent
} from "./guardrail-thresholds";
import { evaluateProtectedPathPolicy } from "./protected-path-policy";
import { createSupervisorReasonDetail, type SupervisorReasonDetail } from "./reason-codes";
import { getSupervisorPolicy } from "./supervisor-config";

export type SupervisorApprovalBoundary =
  | "write"
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
  decisionEvidence: {
    boundary: SupervisorApprovalBoundary;
    policyRequiresApproval: boolean;
    requestOverrideApplied: boolean;
    effectiveRequiresApproval: boolean;
    changedPaths: readonly string[];
    protectedPathOutcome: "allow" | "requires-human" | "deny";
    protectedPaths: readonly string[];
    deniedPaths: readonly string[];
    protectedPathAuditExpectations: readonly string[];
    targetRef?: string;
    budgetUsagePercent?: number;
    budgetThresholdPercent?: number;
  };
  thresholdEvents: readonly SupervisorThresholdEvent[];
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
    case "write":
      return false;
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
  const policyRequiresApproval = getBoundaryApprovalRequirement(input.request.boundary);
  const normalizedContext = normalizeContext(input.request.context);
  const protectedPathDecision = input.request.boundary === "merge" || input.request.boundary === "write"
    ? evaluateProtectedPathPolicy(normalizedContext.changedPaths ?? freezeList([]))
    : {
        outcome: "allow" as const,
        requiresHumanPaths: freezeList([]),
        deniedPaths: freezeList([]),
        auditExpectations: freezeList([]),
        reasonDetails: freezeList([])
      };
  const requiresApproval = (input.request.requiresApproval ?? policyRequiresApproval)
    || protectedPathDecision.outcome === "requires-human"
    || protectedPathDecision.outcome === "deny";
  const decisionEvidence = Object.freeze({
    boundary: input.request.boundary,
    policyRequiresApproval,
    requestOverrideApplied: input.request.requiresApproval !== undefined,
    effectiveRequiresApproval: requiresApproval,
    changedPaths: normalizedContext.changedPaths ?? freezeList([]),
    protectedPathOutcome: protectedPathDecision.outcome,
    protectedPaths: protectedPathDecision.requiresHumanPaths,
    deniedPaths: protectedPathDecision.deniedPaths,
    protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
    targetRef: normalizedContext.targetRef,
    budgetUsagePercent: normalizedContext.budgetUsagePercent,
    budgetThresholdPercent: normalizedContext.budgetThresholdPercent
  });
  const thresholdEvidence = Object.freeze({
    boundary: input.request.boundary,
    policyRequiresApproval,
    requestOverrideApplied: input.request.requiresApproval !== undefined,
    effectiveRequiresApproval: requiresApproval,
    changedPaths: normalizedContext.changedPaths ?? freezeList([]),
    protectedPathOutcome: protectedPathDecision.outcome,
    protectedPaths: protectedPathDecision.requiresHumanPaths,
    deniedPaths: protectedPathDecision.deniedPaths,
    protectedPathAuditExpectations: protectedPathDecision.auditExpectations,
    ...(normalizedContext.targetRef ? { targetRef: normalizedContext.targetRef } : {}),
    ...(normalizedContext.budgetUsagePercent !== undefined ? { budgetUsagePercent: normalizedContext.budgetUsagePercent } : {}),
    ...(normalizedContext.budgetThresholdPercent !== undefined
      ? { budgetThresholdPercent: normalizedContext.budgetThresholdPercent }
      : {})
  });
  const thresholdEvents = freezeList([
    Object.freeze({
      eventId: createSupervisorThresholdEventId(
        "approval-gates",
        laneId,
        input.request.boundary,
        requiresApproval,
        input.request.requestedAction
      ),
      guardrail: "approval-gates",
      thresholdKey: `${input.request.boundary}-boundary`,
      status: requiresApproval ? "triggered" : "within-threshold",
      thresholdValue: policyRequiresApproval,
      observedValue: requiresApproval,
      reasonCode: protectedPathDecision.outcome === "deny"
        ? "approval.protected-path-denied"
        : protectedPathDecision.outcome === "requires-human"
          ? "approval.protected-path-review"
          : requiresApproval
            ? "approval.governance-boundary"
            : undefined,
      summary: requiresApproval
        ? `Approval is required at the ${input.request.boundary} governance boundary for ${requestedAction}.`
        : `Approval is not required at the ${input.request.boundary} governance boundary for ${requestedAction}.`,
      evidence: thresholdEvidence
    } satisfies SupervisorThresholdEvent)
  ]);

  if (!requiresApproval) {
    return {
      approvalId,
      requiresApproval: false,
      status: "not-required",
      nextAction: "continue",
      approval: null,
      reasons: freezeList(["Action stays inside the configured autonomous guardrails."]),
      reasonDetails: freezeList([]),
      decisionEvidence,
      thresholdEvents
    };
  }

  const context = normalizedContext;
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
        protectedPathDecision.outcome === "deny"
          ? "Protected-path policy denied these paths, so automation stays paused and requires human follow-up."
          : protectedPathDecision.outcome === "requires-human"
            ? "Protected-path policy requires a documented human exception before this action can continue."
            : `Human approval is required at the ${input.request.boundary} governance boundary before ${requestedAction}.`
      ]),
      reasonDetails: freezeList([
        ...(protectedPathDecision.outcome === "allow"
          ? []
          : protectedPathDecision.reasonDetails),
        createSupervisorReasonDetail("approval.governance-boundary", {
          path: input.request.boundary,
          actionReason: requestedAction
        })
      ]),
      decisionEvidence,
      thresholdEvents
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
      ]),
      decisionEvidence,
      thresholdEvents
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
    ]),
    decisionEvidence,
    thresholdEvents
  };
};
