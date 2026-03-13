import type {
  SupervisorApprovalRecord,
  SupervisorArtifactRecord,
  SupervisorLaneRecord,
  SupervisorRunRecord,
  SupervisorSessionRecord,
  SupervisorWorktreeRecord
} from "./durable-state-store";
import {
  createReviewReadyEvidencePacket,
  type ReviewReadyEvidencePacket,
  type ReviewReadyEvidencePacketInput
} from "./review-ready-packet";

export type ReviewCoordinationExternalSystem = "shortcut" | "jira" | "github" | "linear" | "custom";

export type ReviewCoordinationArtifactLinkKind =
  | "originating-run"
  | "external-tracker"
  | "pull-request"
  | "review-packet"
  | "session-log"
  | "validation"
  | "diff"
  | "approval"
  | "other";

export type ReviewCoordinationArtifactLinkInput = {
  label: string;
  href: string;
  kind: ReviewCoordinationArtifactLinkKind;
};

export type ReviewCoordinationArtifactLink = {
  label: string;
  href: string;
  kind: ReviewCoordinationArtifactLinkKind;
};

export type ReviewCoordinationTrackerReferenceInput = {
  system: ReviewCoordinationExternalSystem;
  reference: string;
  url: string;
};

export type ReviewCoordinationTrackerReference = {
  system: ReviewCoordinationExternalSystem;
  reference: string;
  url: string;
};

export type ReviewCoordinationOriginatingRunInput = {
  href: string;
  label?: string;
};

export type ReviewCoordinationOriginatingRun = {
  href: string;
  label: string;
};

export type ReviewCoordinationPullRequestPrepInput = {
  title: string;
  baseRef: string;
  headRef: string;
  summary: readonly string[];
  before: string;
  after: string;
  example: readonly string[];
  validation: readonly string[];
  reviewers?: readonly string[];
  reviewTeams?: readonly string[];
  labels?: readonly string[];
  draft?: boolean;
};

export type ReviewCoordinationPullRequestPrep = {
  title: string;
  baseRef: string;
  headRef: string;
  summary: readonly string[];
  before: string;
  after: string;
  example: readonly string[];
  validation: readonly string[];
  reviewers: readonly string[];
  reviewTeams: readonly string[];
  labels: readonly string[];
  draft: boolean;
};

export type ReviewCoordinationBundleInput = {
  run: SupervisorRunRecord;
  lane: SupervisorLaneRecord;
  worktree?: SupervisorWorktreeRecord;
  session?: SupervisorSessionRecord;
  approvals?: readonly SupervisorApprovalRecord[];
  artifacts?: readonly SupervisorArtifactRecord[];
  reviewPacket: ReviewReadyEvidencePacketInput | ReviewReadyEvidencePacket;
  externalTracker: ReviewCoordinationTrackerReferenceInput;
  originatingRun: ReviewCoordinationOriginatingRunInput;
  pullRequest: ReviewCoordinationPullRequestPrepInput;
  additionalArtifacts?: readonly ReviewCoordinationArtifactLinkInput[];
};

export type ReviewCoordinationBundle = {
  run: SupervisorRunRecord;
  lane: SupervisorLaneRecord;
  worktree?: SupervisorWorktreeRecord;
  session?: SupervisorSessionRecord;
  approvals: readonly SupervisorApprovalRecord[];
  artifacts: readonly SupervisorArtifactRecord[];
  reviewPacket: ReviewReadyEvidencePacket;
  sourceOfTruth: "external-tracker";
  externalTracker: ReviewCoordinationTrackerReference;
  originatingRun: ReviewCoordinationOriginatingRun;
  reviewArtifacts: readonly ReviewCoordinationArtifactLink[];
  pullRequest: ReviewCoordinationPullRequestPrep;
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const assertNonEmpty = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Review coordination requires a non-empty ${field}.`);
  }

  return normalized;
};

const normalizeNonEmptyList = (values: readonly string[], field: string): readonly string[] => {
  const normalized = Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));

  if (normalized.length === 0) {
    throw new Error(`Review coordination requires at least one ${field}.`);
  }

  return freezeList(normalized);
};

const normalizeOptionalList = (values: readonly string[] | undefined): readonly string[] => freezeList(
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean)))
);

const normalizeArtifactLinks = (
  values: readonly ReviewCoordinationArtifactLinkInput[]
): readonly ReviewCoordinationArtifactLink[] => {
  const deduped = new Map<string, ReviewCoordinationArtifactLink>();

  for (const value of values) {
    const normalized = freezeRecord({
      label: assertNonEmpty(value.label, "artifact label"),
      href: assertNonEmpty(value.href, "artifact href"),
      kind: value.kind
    });
    deduped.set(`${normalized.kind}:${normalized.href}:${normalized.label}`, normalized);
  }

  return freezeList(Array.from(deduped.values()));
};

const mapArtifactKind = (kind: SupervisorArtifactRecord["kind"]): ReviewCoordinationArtifactLinkKind => {
  switch (kind) {
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

const normalizePullRequestPrep = (
  input: ReviewCoordinationPullRequestPrepInput
): ReviewCoordinationPullRequestPrep => freezeRecord({
  title: assertNonEmpty(input.title, "pull request title"),
  baseRef: assertNonEmpty(input.baseRef, "pull request base ref"),
  headRef: assertNonEmpty(input.headRef, "pull request head ref"),
  summary: normalizeNonEmptyList(input.summary, "pull request summary item"),
  before: assertNonEmpty(input.before, "pull request before section"),
  after: assertNonEmpty(input.after, "pull request after section"),
  example: normalizeNonEmptyList(input.example, "pull request example item"),
  validation: normalizeNonEmptyList(input.validation, "pull request validation item"),
  reviewers: normalizeOptionalList(input.reviewers),
  reviewTeams: normalizeOptionalList(input.reviewTeams),
  labels: normalizeOptionalList(input.labels),
  draft: input.draft ?? false
});

export const createReviewCoordinationBundle = (
  input: ReviewCoordinationBundleInput
): ReviewCoordinationBundle => {
  const reviewPacket = createReviewReadyEvidencePacket(input.reviewPacket);
  const approvals = freezeList((input.approvals ?? []).filter((approval) => approval.laneId === input.lane.laneId));
  const artifacts = freezeList((input.artifacts ?? []).filter((artifact) => artifact.laneId === input.lane.laneId));
  const originatingRun = freezeRecord({
    href: assertNonEmpty(input.originatingRun.href, "originating run href"),
    label: input.originatingRun.label?.trim() || `${input.run.runId} / ${input.lane.laneId}`
  });
  const externalTracker = freezeRecord({
    system: input.externalTracker.system,
    reference: assertNonEmpty(input.externalTracker.reference, "external tracker reference"),
    url: assertNonEmpty(input.externalTracker.url, "external tracker url")
  });
  const approvalArtifacts = approvals.map((approval) => ({
    label: `Approval ${approval.approvalId}`,
    href: `approval:${approval.approvalId}`,
    kind: "approval" as const
  }));
  const persistedArtifacts = artifacts.map((artifact) => ({
    label: `${artifact.kind} ${artifact.artifactId}`,
    href: artifact.uri,
    kind: mapArtifactKind(artifact.kind)
  }));
  const reviewArtifacts = normalizeArtifactLinks([
    {
      label: originatingRun.label,
      href: originatingRun.href,
      kind: "originating-run"
    },
    {
      label: `${externalTracker.system} ${externalTracker.reference}`,
      href: externalTracker.url,
      kind: "external-tracker"
    },
    ...persistedArtifacts,
    ...approvalArtifacts,
    ...(input.additionalArtifacts ?? [])
  ]);

  return freezeRecord({
    run: input.run,
    lane: input.lane,
    worktree: input.worktree,
    session: input.session,
    approvals,
    artifacts,
    reviewPacket,
    sourceOfTruth: "external-tracker",
    externalTracker,
    originatingRun,
    reviewArtifacts,
    pullRequest: normalizePullRequestPrep(input.pullRequest)
  });
};

export const renderReviewCoordinationPullRequestBody = (bundle: ReviewCoordinationBundle): string => {
  const artifactSummary = bundle.reviewArtifacts
    .map((artifact) => `- ${artifact.label}: ${artifact.href}`)
    .join("\n");

  const reviewers = bundle.pullRequest.reviewers.length > 0
    ? `- Requested reviewers: ${bundle.pullRequest.reviewers.join(", ")}`
    : "- Requested reviewers: none specified";
  const reviewTeams = bundle.pullRequest.reviewTeams.length > 0
    ? `- Requested teams: ${bundle.pullRequest.reviewTeams.join(", ")}`
    : "- Requested teams: none specified";

  return [
    "## Summary",
    ...bundle.pullRequest.summary.map((item) => `- ${item}`),
    `- External tracker remains the source of truth: ${bundle.externalTracker.system} ${bundle.externalTracker.reference}`,
    `- Originating run: ${bundle.originatingRun.label} (${bundle.originatingRun.href})`,
    "",
    "## Before",
    bundle.pullRequest.before,
    "",
    "## After",
    bundle.pullRequest.after,
    "",
    "## Example",
    ...bundle.pullRequest.example.map((item) => `- ${item}`),
    `- Base / head: ${bundle.pullRequest.baseRef} <- ${bundle.pullRequest.headRef}`,
    reviewers,
    reviewTeams,
    artifactSummary,
    "",
    "## Validation",
    ...bundle.pullRequest.validation.map((item) => `- ${item}`)
  ].join("\n");
};
