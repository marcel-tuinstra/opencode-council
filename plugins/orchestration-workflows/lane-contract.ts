import type { LaneTurnHandoffContract, LaneTurnHandoffInput } from "./turn-ownership";
import { createLaneTurnHandoffContract } from "./turn-ownership";

export type LaneOutputArtifactKind = "branch" | "pull-request" | "review-packet" | "session-log" | "validation" | "diff" | "other";
export type LaneCompletionStatus = "ready" | "blocked";
export type LaneContractVersion = "v1";

export type LaneOutputArtifactInput = {
  laneId: string;
  kind: LaneOutputArtifactKind;
  uri: string;
  label: string;
};

export type LaneOutputArtifact = LaneOutputArtifactInput;

export type LaneCompletionContractInput = {
  contractVersion?: LaneContractVersion;
  runId: string;
  laneId: string;
  status: LaneCompletionStatus;
  handoff: LaneTurnHandoffInput | LaneTurnHandoffContract;
  artifacts: readonly LaneOutputArtifactInput[];
  evidence: readonly string[];
  producedAt: string;
  blockingIssues?: readonly string[];
};

export type LaneCompletionContract = {
  contractVersion: LaneContractVersion;
  runId: string;
  laneId: string;
  status: LaneCompletionStatus;
  handoff: LaneTurnHandoffContract;
  artifacts: readonly LaneOutputArtifact[];
  evidence: readonly string[];
  producedAt: string;
  blockingIssues: readonly string[];
};

export type LaneContractViolation = {
  code: string;
  field: string;
  message: string;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });
const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const normalizeNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Lane completion contract requires a non-empty ${field}.`);
  }
  return normalized;
};

const normalizeTimestamp = (value: string, field: string): string => {
  const normalized = normalizeNonEmpty(value, field);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`Lane completion contract requires a valid ${field}.`);
  }
  return normalized;
};

const normalizeStringList = (values: readonly string[], field: string, requireAtLeastOne: boolean): readonly string[] => {
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  if (requireAtLeastOne && normalized.length === 0) {
    throw new Error(`Lane completion contract requires at least one ${field}.`);
  }
  return freezeList(normalized);
};

const normalizeArtifacts = (artifacts: readonly LaneOutputArtifactInput[]): readonly LaneOutputArtifact[] => {
  if (artifacts.length === 0) {
    throw new Error("Lane completion contract requires at least one artifact.");
  }

  const deduped = new Map<string, LaneOutputArtifact>();
  for (const artifact of artifacts) {
    const normalized = freezeRecord({
      laneId: normalizeNonEmpty(artifact.laneId, "artifact lane id"),
      kind: artifact.kind,
      uri: normalizeNonEmpty(artifact.uri, "artifact uri"),
      label: normalizeNonEmpty(artifact.label, "artifact label")
    });
    deduped.set(`${normalized.kind}:${normalized.uri}`, normalized);
  }

  return freezeList(Array.from(deduped.values()));
};

export const createLaneCompletionContract = (input: LaneCompletionContractInput): LaneCompletionContract => {
  const handoff = createLaneTurnHandoffContract(input.handoff);
  const laneId = normalizeNonEmpty(input.laneId, "lane id");
  const artifacts = normalizeArtifacts(input.artifacts);
  const evidence = normalizeStringList(input.evidence, "evidence entry", true);
  const blockingIssues = normalizeStringList(input.blockingIssues ?? [], "blocking issue", false);

  return freezeRecord({
    contractVersion: input.contractVersion ?? "v1",
    runId: normalizeNonEmpty(input.runId, "run id"),
    laneId,
    status: input.status,
    handoff,
    artifacts,
    evidence,
    producedAt: normalizeTimestamp(input.producedAt, "produced timestamp"),
    blockingIssues
  });
};

export const validateLaneCompletionContract = (contract: LaneCompletionContract): {
  valid: boolean;
  violations: readonly LaneContractViolation[];
} => {
  const violations: LaneContractViolation[] = [];

  if (contract.handoff.laneId !== contract.laneId) {
    violations.push({
      code: "lane-id-mismatch",
      field: "handoff.laneId",
      message: `Lane handoff lane '${contract.handoff.laneId}' must match contract lane '${contract.laneId}'.`
    });
  }

  for (const artifact of contract.artifacts) {
    if (artifact.laneId !== contract.laneId) {
      violations.push({
        code: "artifact-lane-mismatch",
        field: "artifacts[].laneId",
        message: `Artifact '${artifact.label}' lane '${artifact.laneId}' must match contract lane '${contract.laneId}'.`
      });
    }
  }

  const branchCount = contract.artifacts.filter((artifact) => artifact.kind === "branch").length;
  const reviewPacketCount = contract.artifacts.filter((artifact) => artifact.kind === "review-packet").length;
  if (branchCount === 0) {
    violations.push({
      code: "missing-branch-artifact",
      field: "artifacts",
      message: "Lane completion contract requires at least one branch artifact."
    });
  }
  if (reviewPacketCount === 0) {
    violations.push({
      code: "missing-review-packet-artifact",
      field: "artifacts",
      message: "Lane completion contract requires at least one review-packet artifact."
    });
  }

  if (contract.status === "blocked" && contract.blockingIssues.length === 0) {
    violations.push({
      code: "missing-blocking-issues",
      field: "blockingIssues",
      message: "Blocked lane completion contracts require at least one blocking issue."
    });
  }

  if (contract.status === "ready" && contract.blockingIssues.length > 0) {
    violations.push({
      code: "unexpected-blocking-issues",
      field: "blockingIssues",
      message: "Ready lane completion contracts cannot include blocking issues."
    });
  }

  return {
    valid: violations.length === 0,
    violations: freezeList(violations.map((violation) => freezeRecord(violation)))
  };
};

const isLaneCompletionContract = (input: LaneCompletionContractInput | LaneCompletionContract): input is LaneCompletionContract => (
  (input as LaneCompletionContract).contractVersion === "v1" && Array.isArray((input as LaneCompletionContract).blockingIssues)
);

export const assertValidLaneCompletionContract = (input: LaneCompletionContractInput | LaneCompletionContract): LaneCompletionContract => {
  const contract = isLaneCompletionContract(input) ? input : createLaneCompletionContract(input);
  const validation = validateLaneCompletionContract(contract);
  if (!validation.valid) {
    throw new Error(validation.violations.map((violation) => violation.message).join(" "));
  }
  return contract;
};
