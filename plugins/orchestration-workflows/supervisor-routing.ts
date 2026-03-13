import type { SupervisorRunState } from "./durable-state-store";
import { detectIntent } from "./intent";
import type { SupervisorReasonCode, SupervisorReasonDetail } from "./reason-codes";
import { createSupervisorReasonDetail } from "./reason-codes";
import { getSupervisorPolicy, type SupervisorExecutionPath } from "./supervisor-config";
import type { SupervisorLaneDefinition } from "./supervisor-scheduler";
import type { Role } from "./types";
import type { WorkUnit } from "./work-unit";

export type SupervisorRoutingConfidence = "low" | "medium" | "high";

export type SupervisorRoutingAction =
  | "none"
  | "dispatch-lane"
  | "provision-worktree"
  | "launch-session"
  | "resume-session"
  | "replace-session"
  | "wait-for-prerequisites"
  | "manual-triage";

export type RouteSupervisorWorkUnitInput = {
  workUnitId: string;
  workUnit: WorkUnit;
  laneDefinitions?: readonly SupervisorLaneDefinition[];
  runState?: SupervisorRunState | null;
  sessionOwners?: readonly string[];
  readyDependencyReferences?: readonly string[];
};

export type RouteSupervisorWorkUnitResult = {
  workUnitId: string;
  intent: ReturnType<typeof detectIntent>;
  executionPath: SupervisorExecutionPath;
  leadRole: Role;
  confidence: SupervisorRoutingConfidence;
  laneId?: string;
  assignedOwner?: string;
  nextAction: SupervisorRoutingAction;
  missingPrerequisites: readonly string[];
  reasonDetails: readonly SupervisorReasonDetail[];
  reasons: readonly string[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const buildRoutingText = (workUnit: WorkUnit): string => [
  workUnit.objective,
  ...workUnit.constraints,
  ...workUnit.acceptanceCriteria,
  ...workUnit.riskTags,
  workUnit.source.title
].join("\n");

const findLaneDefinition = (
  laneDefinitions: readonly SupervisorLaneDefinition[] | undefined,
  workUnitId: string
): SupervisorLaneDefinition | undefined => laneDefinitions?.find((lane) => lane.workUnitIds.includes(workUnitId));

const getMissingPrerequisites = (
  workUnit: WorkUnit,
  readyDependencyReferences: readonly string[] | undefined
): readonly string[] => {
  if (!readyDependencyReferences) {
    return freezeList([]);
  }

  const ready = new Set(readyDependencyReferences.map((value) => value.trim()).filter(Boolean));
  return freezeList(
    workUnit.dependencies
      .map((dependency) => dependency.reference?.trim())
      .filter((reference): reference is string => typeof reference === "string" && reference.length > 0)
      .filter((reference) => !ready.has(reference))
  );
};

const resolveConfidence = (score: number, minimumSignalScore: number): SupervisorRoutingConfidence => {
  if (score >= minimumSignalScore + 1) {
    return "high";
  }

  if (score >= minimumSignalScore) {
    return "medium";
  }

  return "low";
};

const scoreRoutingSignals = (
  workUnit: WorkUnit,
  intent: ReturnType<typeof detectIntent>,
  laneDefinition?: SupervisorLaneDefinition
): number => {
  let score = 0;

  if (intent !== "mixed") {
    score += 1;
  }

  if (workUnit.source.kind === "tracker") {
    score += 1;
  }

  if (workUnit.acceptanceCriteria.length > 0) {
    score += 1;
  }

  if (laneDefinition) {
    score += 1;
  }

  return score;
};

const stableIndexFromText = (text: string, size: number): number => {
  let hash = 0;

  for (const character of text) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return hash % size;
};

const selectAssignedOwner = (input: RouteSupervisorWorkUnitInput, laneId: string | undefined): {
  owner?: string;
  reasonCode?: Extract<SupervisorReasonCode, "assignment.sticky-session-owner" | "assignment.deterministic-owner">;
} => {
  const lane = laneId ? input.runState?.lanes.find((candidate) => candidate.laneId === laneId) : undefined;
  const session = lane?.sessionId
    ? input.runState?.sessions.find((candidate) => candidate.sessionId === lane.sessionId)
    : undefined;

  if (session?.owner) {
    return {
      owner: session.owner,
      reasonCode: "assignment.sticky-session-owner"
    };
  }

  if (!input.sessionOwners || input.sessionOwners.length === 0) {
    return {};
  }

  const stableKey = `${input.workUnit.source.reference ?? input.workUnit.objective}:${laneId ?? "no-lane"}`;
  return {
    owner: input.sessionOwners[stableIndexFromText(stableKey, input.sessionOwners.length)],
    reasonCode: "assignment.deterministic-owner"
  };
};

const resolveNextAction = (
  input: RouteSupervisorWorkUnitInput,
  laneId: string | undefined,
  missingPrerequisites: readonly string[],
  confidence: SupervisorRoutingConfidence
): SupervisorRoutingAction => {
  if (missingPrerequisites.length > 0) {
    return "wait-for-prerequisites";
  }

  if (confidence === "low") {
    return "manual-triage";
  }

  if (!laneId) {
    return "dispatch-lane";
  }

  const lane = input.runState?.lanes.find((candidate) => candidate.laneId === laneId);
  if (!lane) {
    return "dispatch-lane";
  }

  const worktree = lane.worktreeId
    ? input.runState?.worktrees.find((candidate) => candidate.worktreeId === lane.worktreeId)
    : undefined;
  const session = lane.sessionId
    ? input.runState?.sessions.find((candidate) => candidate.sessionId === lane.sessionId)
    : undefined;

  if (!worktree || worktree.status === "released") {
    return "provision-worktree";
  }

  if (!session) {
    return "launch-session";
  }

  if (session.status === "paused") {
    return "resume-session";
  }

  if (session.status === "stalled" || session.status === "failed" || session.status === "replaced") {
    return "replace-session";
  }

  return "none";
};

export const routeSupervisorWorkUnit = (input: RouteSupervisorWorkUnitInput): RouteSupervisorWorkUnitResult => {
  const policy = getSupervisorPolicy().routing;
  const laneDefinition = findLaneDefinition(input.laneDefinitions, input.workUnitId);
  const intent = detectIntent(buildRoutingText(input.workUnit));
  const profile = policy.intentProfiles[intent];
  const missingPrerequisites = getMissingPrerequisites(input.workUnit, input.readyDependencyReferences);
  const confidenceScore = scoreRoutingSignals(input.workUnit, intent, laneDefinition);
  const confidence = resolveConfidence(confidenceScore, policy.minimumSignalScore);
  const fallbackActive = missingPrerequisites.length > 0 || confidence === "low";
  const executionPath: SupervisorExecutionPath = fallbackActive ? "safe-hold" : profile.path;
  const leadRole = fallbackActive ? profile.fallbackLeadRole : profile.leadRole;
  const laneId = laneDefinition?.laneId;
  const assignment = selectAssignedOwner(input, laneId);
  const nextAction = resolveNextAction(input, laneId, missingPrerequisites, confidence);
  const reasonDetails: SupervisorReasonDetail[] = [];

  if (fallbackActive) {
    if (missingPrerequisites.length > 0) {
      reasonDetails.push(createSupervisorReasonDetail("fallback.missing-prerequisites", {
        missingPrerequisites
      }));
    } else {
      reasonDetails.push(createSupervisorReasonDetail("fallback.low-confidence", {
        confidence
      }));
    }
  } else {
    reasonDetails.push(createSupervisorReasonDetail("route.intent-profile", {
      intent,
      path: executionPath
    }));

    if (laneId) {
      reasonDetails.push(createSupervisorReasonDetail("route.lane-match", {
        laneId,
        path: executionPath
      }));
    }
  }

  if (assignment.reasonCode) {
    reasonDetails.push(createSupervisorReasonDetail(assignment.reasonCode, {
      owner: assignment.owner
    }));
  }

  return {
    workUnitId: input.workUnitId,
    intent,
    executionPath,
    leadRole,
    confidence,
    laneId,
    assignedOwner: assignment.owner,
    nextAction,
    missingPrerequisites,
    reasonDetails: freezeList(reasonDetails),
    reasons: freezeList(reasonDetails.map((detail) => detail.explanation))
  };
};
