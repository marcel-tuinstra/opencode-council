import { getSupervisorPolicy, type SupervisorExecutionPolicy } from "./supervisor-config";
import type { Role } from "./types";

const EXECUTION_ROLES = Object.freeze(["DEV", "FE", "BE", "UX"] as const satisfies readonly Role[]);
const MANAGER_ROLES = Object.freeze(["CEO", "CTO", "PM", "PO", "RESEARCH", "MARKETING"] as const satisfies readonly Role[]);
const IMPLEMENTATION_RESPONSIBILITY_REGEX = /\b(implement|build|code|ship|write code|develop|patch|refactor|debug|wire up)\b/i;
const IMPLEMENTATION_PHRASE_REGEXES = Object.freeze([
  /\bimplement\b/i,
  /\bbuild\b/i,
  /\bfix\b/i,
  /\bpatch\b/i,
  /\brefactor\b/i,
  /\bdebug\b/i,
  /\bwire up\b/i,
  /\brun tests?\b/i,
  /\bvalidate (the )?(fix|change|implementation|release flow|workflow|feature)\b/i,
  /\btest (the )?(fix|change|implementation|workflow|feature)\b/i
]);
const NON_IMPLEMENTATION_RESPONSIBILITY_REGEX = /\b(review|architecture|architect|scope|plan|research|message|position|document|docs|requirements|acceptance|risk|test plan|review test plan|deliver roadmap|validate architecture|validate scope)\b/i;

export type SupervisorDelegationAssignmentInput = {
  storyId?: string;
  laneId?: string;
  role: Role;
  agentLabel: string;
  branch?: string;
  worktreePath?: string;
  responsibilities: readonly string[];
};

export type SupervisorDelegationAssignment = {
  storyId?: string;
  laneId?: string;
  role: Role;
  agentLabel: string;
  branch?: string;
  worktreePath?: string;
  responsibilities: readonly string[];
};

export type SupervisorIntegrationAssignmentInput = {
  agentLabel: string;
  role?: Role;
  worktreePath?: string;
  responsibilities: readonly string[];
};

export type SupervisorIntegrationAssignment = {
  agentLabel: string;
  role?: Role;
  worktreePath?: string;
  responsibilities: readonly string[];
};

export type SupervisorDelegationPlanInput = {
  supervisorLabel?: string;
  directEditsRequested?: boolean;
  assignments: readonly SupervisorDelegationAssignmentInput[];
  integration?: SupervisorIntegrationAssignmentInput;
  policy?: SupervisorExecutionPolicy;
};

export type SupervisorDelegationPlan = {
  supervisorLabel: string;
  directEditsRequested: boolean;
  assignments: readonly SupervisorDelegationAssignment[];
  integration?: SupervisorIntegrationAssignment;
  policy: SupervisorExecutionPolicy;
};

export type SupervisorDelegationValidation = {
  valid: boolean;
  violations: readonly string[];
  plan: SupervisorDelegationPlan;
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);
const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const normalizeString = (value: string | undefined, field: string): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`Supervisor delegation requires a non-empty ${field} when provided.`);
  }

  return normalized;
};

const normalizeResponsibilities = (responsibilities: readonly string[], field: string): readonly string[] => {
  const normalized = Array.from(new Set(responsibilities.map((item) => item.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    throw new Error(`Supervisor delegation requires at least one ${field}.`);
  }

  return freezeList(normalized);
};

const normalizeAssignment = (input: SupervisorDelegationAssignmentInput): SupervisorDelegationAssignment => freezeRecord({
  storyId: normalizeString(input.storyId, "assignment story id"),
  laneId: normalizeString(input.laneId, "assignment lane id"),
  role: input.role,
  agentLabel: normalizeString(input.agentLabel, "assignment agent label")!,
  branch: normalizeString(input.branch, "assignment branch"),
  worktreePath: normalizeString(input.worktreePath, "assignment worktree path"),
  responsibilities: normalizeResponsibilities(input.responsibilities, "assignment responsibility")
});

const normalizeIntegration = (input: SupervisorIntegrationAssignmentInput): SupervisorIntegrationAssignment => freezeRecord({
  agentLabel: normalizeString(input.agentLabel, "integration agent label")!,
  role: input.role,
  worktreePath: normalizeString(input.worktreePath, "integration worktree path"),
  responsibilities: normalizeResponsibilities(input.responsibilities, "integration responsibility")
});

const isExecutionRole = (role: Role): boolean => (EXECUTION_ROLES as readonly Role[]).includes(role);

const isManagerRole = (role: Role): boolean => (MANAGER_ROLES as readonly Role[]).includes(role);

const hasImplementationResponsibility = (responsibilities: readonly string[]): boolean => responsibilities
  .some((responsibility) => {
    const normalized = responsibility.trim();

    if (IMPLEMENTATION_PHRASE_REGEXES.some((regex) => regex.test(normalized))) {
      return true;
    }

    if (!IMPLEMENTATION_RESPONSIBILITY_REGEX.test(normalized)) {
      return false;
    }

    return !NON_IMPLEMENTATION_RESPONSIBILITY_REGEX.test(normalized);
  });

const isDelegationPlan = (input: SupervisorDelegationPlanInput | SupervisorDelegationPlan): input is SupervisorDelegationPlan => {
  return typeof (input as SupervisorDelegationPlan).supervisorLabel === "string"
    && typeof (input as SupervisorDelegationPlan).directEditsRequested === "boolean"
    && (input as SupervisorDelegationPlan).policy !== undefined;
};

export const createSupervisorDelegationPlan = (input: SupervisorDelegationPlanInput): SupervisorDelegationPlan => {
  const policy = input.policy ?? getSupervisorPolicy().execution;

  return freezeRecord({
    supervisorLabel: normalizeString(input.supervisorLabel, "supervisor label") ?? "SUPERVISOR",
    directEditsRequested: input.directEditsRequested ?? false,
    assignments: freezeList(input.assignments.map(normalizeAssignment)),
    integration: input.integration ? normalizeIntegration(input.integration) : undefined,
    policy: freezeRecord({ ...policy })
  });
};

export const validateSupervisorDelegationPlan = (
  input: SupervisorDelegationPlanInput | SupervisorDelegationPlan
): SupervisorDelegationValidation => {
  const plan = isDelegationPlan(input) ? input : createSupervisorDelegationPlan(input);
  const violations: string[] = [];

  if (plan.policy.mode === "delegate-only" && (plan.policy.allowSupervisorDirectEdits || plan.directEditsRequested)) {
    violations.push("Supervisor direct product-code edits are disabled in delegate-only mode.");
  }

  if (plan.policy.requireDelegationLog && plan.assignments.length === 0) {
    violations.push("Supervisor execution requires at least one delegated assignment in the audit log.");
  }

  const implementationAssignments = plan.assignments.filter((assignment) => hasImplementationResponsibility(assignment.responsibilities));

  for (const assignment of implementationAssignments) {
    if (isManagerRole(assignment.role)) {
      violations.push(
        `Assignment '${assignment.agentLabel}' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.`
      );
    }
  }

  if (implementationAssignments.length > 0 && !plan.assignments.some((assignment) => isExecutionRole(assignment.role))) {
    violations.push("Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment.");
  }

  if (plan.policy.requireAgentWorktreeBinding) {
    for (const assignment of plan.assignments) {
      if (!assignment.worktreePath) {
        violations.push(`Assignment '${assignment.agentLabel}' is missing a bound worktree path.`);
      }
    }

    if (plan.integration && !plan.integration.worktreePath) {
      violations.push(`Integration agent '${plan.integration.agentLabel}' is missing a bound worktree path.`);
    }
  }

  if (plan.policy.requireDedicatedIntegrationAgent) {
    if (!plan.integration) {
      violations.push(`Supervisor execution requires a dedicated ${plan.policy.integrationAgentLabel} agent for integration.`);
    } else if (plan.assignments.some((assignment) => assignment.agentLabel === plan.integration!.agentLabel)) {
      violations.push("Integration agent must stay distinct from implementation agents when dedicated integration is required.");
    }
  }

  return freezeRecord({
    valid: violations.length === 0,
    violations: freezeList(violations),
    plan
  });
};
