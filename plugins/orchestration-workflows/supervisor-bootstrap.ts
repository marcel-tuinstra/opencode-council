import { decomposeSupervisorGoalIntoLanes, type SupervisorLaneDecompositionResult } from "./lane-decomposition";
import type { LanePlanningWorkUnit } from "./lane-plan";
import {
  createSupervisorDispatchPlan,
  type SupervisorDispatchPlanResult
} from "./supervisor-dispatch-planning";
import { planSupervisorGoal, type PlanSupervisorGoalResult } from "./supervisor-goal-plan";
import { getSupervisorPolicy } from "./supervisor-config";
import type { Role } from "./types";

export type SupervisorBootstrapPreviewStatus = "supported" | "unsupported";
export type SupervisorBootstrapCheckStatus = "ready" | "blocked";
export type SupervisorBootstrapStepStatus = "ready" | "blocked" | "preview";

export type SupervisorBootstrapTarget = {
  organization: string;
  repository: string;
  baseBranch: string;
};

export type SupervisorBootstrapPrerequisites = {
  repoConnected?: boolean;
  trackerConnected?: boolean;
  verificationCommand?: string;
  recoveryOwner?: string;
};

export type CreateSupervisorBootstrapPreviewInput = {
  target: SupervisorBootstrapTarget;
  goal: string;
  workUnits: readonly LanePlanningWorkUnit[];
  requestedByRole?: Role;
  availableRoles?: readonly Role[];
  maxRoles?: number;
  readyDependencyReferences?: readonly string[];
  prerequisites?: SupervisorBootstrapPrerequisites;
};

export type SupervisorBootstrapCheck = {
  key:
    | "target"
    | "repo-access"
    | "tracker-access"
    | "policy-defaults"
    | "verification"
    | "recovery";
  status: SupervisorBootstrapCheckStatus;
  summary: string;
  remediation: readonly string[];
};

export type SupervisorBootstrapStep = {
  key:
    | "check-prerequisites"
    | "plan-goal"
    | "decompose-lanes"
    | "preview-dispatch"
    | "verify-manually"
    | "prepare-recovery";
  status: SupervisorBootstrapStepStatus;
  summary: string;
};

export type SupervisorBootstrapPreviewTarget = SupervisorBootstrapTarget & {
  branchPrefix: string;
};

export type SupervisorBootstrapPreviewResult = {
  status: SupervisorBootstrapPreviewStatus;
  target: SupervisorBootstrapPreviewTarget;
  checks: readonly SupervisorBootstrapCheck[];
  steps: readonly SupervisorBootstrapStep[];
  goalPlan: PlanSupervisorGoalResult;
  laneDecomposition: SupervisorLaneDecompositionResult;
  dispatchPlan: SupervisorDispatchPlanResult;
  verificationGuidance: readonly string[];
  recoveryGuidance: readonly string[];
  warnings: readonly string[];
  remediation: readonly string[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const dedupe = (values: readonly string[]): readonly string[] => freezeList(Array.from(new Set(values)));

const slugify = (value: string): string => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");

const buildBranchPrefix = (target: SupervisorBootstrapTarget): string => {
  const organization = slugify(target.organization) || "org";
  const repository = slugify(target.repository) || "repo";
  return `beta/${organization}/${repository}`;
};

const buildPolicyCheck = (): SupervisorBootstrapCheck => {
  const policy = getSupervisorPolicy();
  const boundaries = policy.approvalGates.boundaries;
  const safeDefaults = policy.approvalGates.mergeMode === "manual"
    && boundaries.merge
    && boundaries.release
    && boundaries.destructive
    && boundaries.securitySensitive
    && boundaries.budgetExceptions
    && boundaries.automationWidening
    && policy.limits.worktrees.maxActive === 1
    && policy.limits.sessions.maxPerWorktree === 1;

  if (safeDefaults) {
    return {
      key: "policy-defaults",
      status: "ready",
      summary: "Beta policy stays fail-closed with manual merge review and single active worktree/session defaults.",
      remediation: freezeList([])
    };
  }

  return {
    key: "policy-defaults",
    status: "blocked",
    summary: "Beta bootstrap requires manual merge review, full approval boundaries, and single active worktree/session defaults.",
    remediation: freezeList([
      "Restore manual merge review before onboarding this repository.",
      "Re-enable all approval boundaries for merge, release, destructive, security, budget, and automation widening decisions.",
      "Reduce active worktrees and sessions to 1 so Beta stays fail-closed."
    ])
  };
};

const buildChecks = (
  target: SupervisorBootstrapTarget,
  prerequisites: SupervisorBootstrapPrerequisites | undefined
): readonly SupervisorBootstrapCheck[] => {
  const targetReady = [target.organization, target.repository, target.baseBranch].every((value) => value.trim().length > 0);

  return freezeList([
    {
      key: "target",
      status: targetReady ? "ready" : "blocked",
      summary: targetReady
        ? `Bootstrap target ${target.organization}/${target.repository} on ${target.baseBranch} is explicit.`
        : "Bootstrap target must name an organization, repository, and base branch.",
      remediation: targetReady
        ? freezeList([])
        : freezeList(["Provide target.organization, target.repository, and target.baseBranch before creating a preview."])
    },
    {
      key: "repo-access",
      status: prerequisites?.repoConnected === false ? "blocked" : "ready",
      summary: prerequisites?.repoConnected === false
        ? "Repository access is not confirmed for this bootstrap target."
        : "Repository access is confirmed or left to manual verification.",
      remediation: prerequisites?.repoConnected === false
        ? freezeList(["Confirm the Beta operator can read the repository and create review branches manually."])
        : freezeList([])
    },
    {
      key: "tracker-access",
      status: prerequisites?.trackerConnected === false ? "blocked" : "ready",
      summary: prerequisites?.trackerConnected === false
        ? "Tracker access is not confirmed, so story-backed verification may drift."
        : "Tracker access is confirmed or left to manual verification.",
      remediation: prerequisites?.trackerConnected === false
        ? freezeList(["Confirm the operator can open the tracker source and attach review evidence manually."])
        : freezeList([])
    },
    buildPolicyCheck(),
    {
      key: "verification",
      status: prerequisites?.verificationCommand?.trim() ? "ready" : "blocked",
      summary: prerequisites?.verificationCommand?.trim()
        ? `Manual verification command is defined as '${prerequisites.verificationCommand.trim()}'.`
        : "Bootstrap preview requires one manual verification command for reviewers to run after implementation.",
      remediation: prerequisites?.verificationCommand?.trim()
        ? freezeList([])
        : freezeList(["Provide prerequisites.verificationCommand so the preview includes an explicit validation step."])
    },
    {
      key: "recovery",
      status: prerequisites?.recoveryOwner?.trim() ? "ready" : "blocked",
      summary: prerequisites?.recoveryOwner?.trim()
        ? `Recovery owner is assigned to ${prerequisites.recoveryOwner.trim()}.`
        : "Bootstrap preview requires a named recovery owner for manual rollback and triage.",
      remediation: prerequisites?.recoveryOwner?.trim()
        ? freezeList([])
        : freezeList(["Provide prerequisites.recoveryOwner so blocked previews have a clear human escalation path."])
    }
  ]);
};

const buildVerificationGuidance = (input: {
  verificationCommand?: string;
  workUnits: readonly LanePlanningWorkUnit[];
  dispatchPlan: SupervisorDispatchPlanResult;
}): readonly string[] => {
  const guidance = [
    input.verificationCommand?.trim()
      ? `Run '${input.verificationCommand.trim()}' after the planned code changes land in the target repository.`
      : "Define a manual verification command before dispatching any previewed lane."
  ];

  for (const unit of input.workUnits) {
    if (unit.workUnit.acceptanceCriteria.length === 0) {
      guidance.push(`Add acceptance criteria for ${unit.id} before treating the preview as execution-ready.`);
      continue;
    }

    guidance.push(`Verify ${unit.id} against: ${unit.workUnit.acceptanceCriteria.join("; ")}`);
  }

  const waitingLaneIds = input.dispatchPlan.laneInputs
    .filter((lane) => (lane.waitingOn?.length ?? 0) > 0)
    .map((lane) => `${lane.definition.laneId} waits on ${lane.waitingOn?.join(", ")}`);

  guidance.push(...waitingLaneIds.map((entry) => `Do not dispatch until ${entry}.`));

  return dedupe(guidance);
};

const buildRecoveryGuidance = (input: {
  recoveryOwner?: string;
  dispatchPlan: SupervisorDispatchPlanResult;
}): readonly string[] => {
  const guidance = [
    input.recoveryOwner?.trim()
      ? `Escalate blocked or stalled bootstrap steps to ${input.recoveryOwner.trim()} before changing policy or lane definitions.`
      : "Assign a recovery owner before using this preview for onboarding decisions.",
    "Keep merge, release, destructive, and security-sensitive actions manual during Beta onboarding.",
    "If routing falls back to safe-hold, resolve the missing prerequisite or ambiguity first and then regenerate the preview."
  ];

  for (const route of input.dispatchPlan.routeResults) {
    if (route.nextAction === "wait-for-prerequisites" && route.missingPrerequisites.length > 0) {
      guidance.push(`Recover ${route.workUnitId} by resolving prerequisite references: ${route.missingPrerequisites.join(", ")}.`);
    }

    if (route.nextAction === "manual-triage") {
      guidance.push(`Recover ${route.workUnitId} with manual triage because routing confidence remained ${route.confidence}.`);
    }
  }

  return dedupe(guidance);
};

const buildSteps = (input: {
  checks: readonly SupervisorBootstrapCheck[];
  goalPlan: PlanSupervisorGoalResult;
  laneDecomposition: SupervisorLaneDecompositionResult;
  dispatchPlan: SupervisorDispatchPlanResult;
}): readonly SupervisorBootstrapStep[] => {
  const prerequisitesBlocked = input.checks.some((check) => check.status === "blocked");

  return freezeList([
    {
      key: "check-prerequisites",
      status: prerequisitesBlocked ? "blocked" : "ready",
      summary: prerequisitesBlocked
        ? "Bootstrap prerequisites need manual fixes before Beta onboarding is execution-ready."
        : "Bootstrap prerequisites pass the fail-closed Beta checks."
    },
    {
      key: "plan-goal",
      status: input.goalPlan.status === "supported" ? "ready" : "blocked",
      summary: input.goalPlan.status === "supported"
        ? `Goal planning resolved ${input.goalPlan.intent} intent with ${input.goalPlan.laneCount} advisory lane(s).`
        : "Goal planning stayed unsupported, so the bootstrap flow cannot move past review-only mode."
    },
    {
      key: "decompose-lanes",
      status: input.laneDecomposition.status === "supported" ? "ready" : "blocked",
      summary: input.laneDecomposition.status === "supported"
        ? `Lane decomposition produced ${input.laneDecomposition.laneDefinitionsPreview?.length ?? 0} dependency-safe lane preview(s).`
        : "Lane decomposition did not produce a safe dependency-respecting preview."
    },
    {
      key: "preview-dispatch",
      status: input.dispatchPlan.status === "supported" ? "preview" : "blocked",
      summary: input.dispatchPlan.status === "supported"
        ? `Dispatch preview generated ${input.dispatchPlan.routeResults.length} deterministic routing decision(s) without executing automation.`
        : "Dispatch preview is blocked until planning prerequisites are fixed."
    },
    {
      key: "verify-manually",
      status: prerequisitesBlocked ? "blocked" : "preview",
      summary: prerequisitesBlocked
        ? "Manual verification is blocked until the bootstrap checks define validation ownership and commands."
        : "Manual verification guidance is ready for reviewer-run validation."
    },
    {
      key: "prepare-recovery",
      status: prerequisitesBlocked ? "blocked" : "preview",
      summary: prerequisitesBlocked
        ? "Recovery guidance is incomplete until a named recovery owner is present."
        : "Recovery guidance is ready for manual rollback and triage decisions."
    }
  ]);
};

export const createSupervisorBootstrapPreview = (
  input: CreateSupervisorBootstrapPreviewInput
): SupervisorBootstrapPreviewResult => {
  const target = {
    organization: input.target.organization.trim(),
    repository: input.target.repository.trim(),
    baseBranch: input.target.baseBranch.trim(),
    branchPrefix: buildBranchPrefix(input.target)
  } satisfies SupervisorBootstrapPreviewTarget;
  const checks = buildChecks(target, input.prerequisites);
  const goalPlan = planSupervisorGoal({
    goal: input.goal,
    requestedByRole: input.requestedByRole,
    availableRoles: input.availableRoles,
    maxRoles: input.maxRoles
  });
  const laneDecomposition = decomposeSupervisorGoalIntoLanes({
    goalPlan,
    workUnits: input.workUnits,
    scheduler: {
      branchPrefix: target.branchPrefix
    }
  });
  const dispatchPlan = createSupervisorDispatchPlan({
    goalPlan,
    workUnits: input.workUnits,
    scheduler: {
      branchPrefix: target.branchPrefix
    },
    readyDependencyReferences: input.readyDependencyReferences
  });
  const verificationGuidance = buildVerificationGuidance({
    verificationCommand: input.prerequisites?.verificationCommand,
    workUnits: input.workUnits,
    dispatchPlan
  });
  const recoveryGuidance = buildRecoveryGuidance({
    recoveryOwner: input.prerequisites?.recoveryOwner,
    dispatchPlan
  });
  const warnings = dedupe([
    ...laneDecomposition.warnings,
    ...dispatchPlan.warnings,
    ...checks
      .filter((check) => check.status === "blocked")
      .map((check) => check.summary)
  ]);
  const remediation = dedupe([
    ...goalPlan.remediation,
    ...laneDecomposition.remediation,
    ...dispatchPlan.remediation,
    ...checks.flatMap((check) => check.remediation)
  ]);
  const status = checks.every((check) => check.status === "ready")
    && goalPlan.status === "supported"
    && laneDecomposition.status === "supported"
    && dispatchPlan.status === "supported"
    ? "supported"
    : "unsupported";

  return {
    status,
    target,
    checks,
    steps: buildSteps({
      checks,
      goalPlan,
      laneDecomposition,
      dispatchPlan
    }),
    goalPlan,
    laneDecomposition,
    dispatchPlan,
    verificationGuidance,
    recoveryGuidance,
    warnings,
    remediation
  };
};
