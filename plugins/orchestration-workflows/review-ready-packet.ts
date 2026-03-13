import type { LaneLifecycleState } from "./lane-lifecycle";
import { assertLaneStateTransition } from "./lane-lifecycle";
import type {
  LaneCompletionContract,
  LaneCompletionContractInput,
  LaneCompletionHandoffEvaluation,
  LaneContractViolation
} from "./lane-contract";
import { createLaneCompletionContract, evaluateLaneCompletionContract } from "./lane-contract";
import type { LaneTurnHandoffContract, LaneTurnHandoffInput } from "./turn-ownership";
import { createLaneTurnHandoffContract } from "./turn-ownership";

export type ReviewReadyAcceptanceTraceStatus = "done" | "follow-up";

export type ReviewReadyVerificationStatus = "pass" | "fail" | "not run";

export type ReviewReadyAcceptanceTraceEntry = {
  requirement: string;
  evidence: string;
  status: ReviewReadyAcceptanceTraceStatus;
};

export type ReviewReadyVerificationEntry = {
  check: string;
  result: ReviewReadyVerificationStatus;
  notes: string;
};

export type ReviewReadyHandoffOwnersInput = {
  reviewerOwner: string;
  mergeOwner: string;
  followUpOwner: string;
};

export type ReviewReadyHandoffOwners = {
  reviewerOwner: string;
  mergeOwner: string;
  followUpOwner: string;
};

export type ReviewReadyEvidencePacketInput = {
  acceptanceCriteriaTrace: readonly ReviewReadyAcceptanceTraceEntry[];
  scopedDiffSummary: readonly string[];
  verificationResults: readonly ReviewReadyVerificationEntry[];
  riskRollbackNotes: readonly string[];
  handoff: LaneTurnHandoffInput;
  laneOutput?: LaneCompletionContractInput | LaneCompletionContract;
  ownership: ReviewReadyHandoffOwnersInput;
};

export type ReviewReadyEvidencePacket = {
  acceptanceCriteriaTrace: readonly ReviewReadyAcceptanceTraceEntry[];
  scopedDiffSummary: readonly string[];
  verificationResults: readonly ReviewReadyVerificationEntry[];
  riskRollbackNotes: readonly string[];
  handoff: LaneTurnHandoffContract;
  laneOutput?: LaneCompletionContract;
  handoffValidation: LaneCompletionHandoffEvaluation;
  ownership: ReviewReadyHandoffOwners;
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const createAcceptedValidation = (): LaneCompletionHandoffEvaluation => ({
  valid: true,
  outcome: "accepted",
  violations: freezeList([])
});

const createEscalationValidation = (violation: LaneContractViolation): LaneCompletionHandoffEvaluation => ({
  valid: false,
  outcome: "escalate",
  violations: freezeList([violation])
});

const combineHandoffEvaluations = (
  evaluations: readonly LaneCompletionHandoffEvaluation[]
): LaneCompletionHandoffEvaluation => {
  const violations = freezeList(evaluations.flatMap((evaluation) => evaluation.violations));

  if (violations.length === 0) {
    return createAcceptedValidation();
  }

  return {
    valid: false,
    outcome: evaluations.some((evaluation) => evaluation.outcome === "escalate") ? "escalate" : "repair",
    violations
  };
};

const isLaneCompletionContract = (
  input: LaneCompletionContractInput | LaneCompletionContract
): input is LaneCompletionContract => (
  (input as LaneCompletionContract).contractVersion === "v1"
);

const assertNonEmptyValue = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Review-ready evidence packet requires a non-empty ${field}.`);
  }

  return normalized;
};

const normalizeNonEmptyList = (values: readonly string[], field: string): string[] => {
  const normalized = values
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

  if (normalized.length === 0) {
    throw new Error(`Review-ready evidence packet requires at least one ${field}.`);
  }

  return normalized;
};

const normalizeAcceptanceTrace = (
  values: readonly ReviewReadyAcceptanceTraceEntry[]
): ReviewReadyAcceptanceTraceEntry[] => {
  if (values.length === 0) {
    throw new Error("Review-ready evidence packet requires at least one acceptance criteria trace entry.");
  }

  return values.map((value) => ({
    requirement: assertNonEmptyValue(value.requirement, "acceptance criteria trace requirement"),
    evidence: assertNonEmptyValue(value.evidence, "acceptance criteria trace evidence"),
    status: value.status
  }));
};

const normalizeVerificationResults = (
  values: readonly ReviewReadyVerificationEntry[]
): ReviewReadyVerificationEntry[] => {
  if (values.length === 0) {
    throw new Error("Review-ready evidence packet requires at least one verification result.");
  }

  return values.map((value) => ({
    check: assertNonEmptyValue(value.check, "verification check"),
    result: value.result,
    notes: assertNonEmptyValue(value.notes, "verification notes")
  }));
};

const normalizeOwnership = (input: ReviewReadyHandoffOwnersInput): ReviewReadyHandoffOwners => ({
  reviewerOwner: assertNonEmptyValue(input.reviewerOwner, "reviewer owner"),
  mergeOwner: assertNonEmptyValue(input.mergeOwner, "merge owner"),
  followUpOwner: assertNonEmptyValue(input.followUpOwner, "follow-up owner")
});

export const createReviewReadyEvidencePacket = (
  input: ReviewReadyEvidencePacketInput
): ReviewReadyEvidencePacket => {
  const handoff = createLaneTurnHandoffContract(input.handoff);
  const ownership = normalizeOwnership(input.ownership);
  const laneOutput = input.laneOutput
    ? (isLaneCompletionContract(input.laneOutput) ? input.laneOutput : createLaneCompletionContract(input.laneOutput))
    : undefined;
  const handoffEvaluations: LaneCompletionHandoffEvaluation[] = [];

  if (laneOutput) {
    handoffEvaluations.push(evaluateLaneCompletionContract(laneOutput));

    if (JSON.stringify(laneOutput.handoff) !== JSON.stringify(handoff)) {
      throw new Error("Review-ready evidence packet requires laneOutput.handoff to match the explicit handoff contract.");
    }
  }

  if (handoff.nextOwner !== ownership.reviewerOwner) {
    handoffEvaluations.push(createEscalationValidation({
      code: "review-owner-mismatch",
      field: "ownership.reviewerOwner",
      message: `Review checkpoint owner '${ownership.reviewerOwner}' must match handoff next owner '${handoff.nextOwner}'.`
    }));
  }

  const handoffValidation = combineHandoffEvaluations(handoffEvaluations);

  return {
    acceptanceCriteriaTrace: normalizeAcceptanceTrace(input.acceptanceCriteriaTrace),
    scopedDiffSummary: normalizeNonEmptyList(input.scopedDiffSummary, "scoped diff summary item"),
    verificationResults: normalizeVerificationResults(input.verificationResults),
    riskRollbackNotes: normalizeNonEmptyList(input.riskRollbackNotes, "risk or rollback note"),
    handoff,
    laneOutput,
    handoffValidation,
    ownership
  };
};

export const assertReviewReadyTransition = (
  from: LaneLifecycleState,
  to: LaneLifecycleState,
  packet?: ReviewReadyEvidencePacketInput
): ReviewReadyEvidencePacket | undefined => {
  assertLaneStateTransition(from, to);

  if (to !== "review_ready") {
    return undefined;
  }

  if (!packet) {
    throw new Error("Lane transition to review_ready requires a review-ready evidence packet.");
  }

  return createReviewReadyEvidencePacket(packet);
};
