import type { DelegationPlan, DelegationWave, Role } from "./types.ts";
import type {
  SupervisorDelegationAssignmentInput,
  SupervisorDelegationPlanInput
} from "./supervisor-delegation.ts";
import type { SupervisorExecutionPolicy } from "./supervisor-config.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Roles that should not own implementation work. */
export const MANAGER_ROLES: readonly Role[] = ["CEO", "CTO", "PM", "PO", "MARKETING", "RESEARCH"] as const;

/** Roles that own implementation. */
export const IMPLEMENTATION_ROLES: readonly Role[] = ["DEV", "FE", "BE", "UX"] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DelegationBridgeInput = {
  plan: DelegationPlan;
  availableRoles?: string[];
};

export type DelegationBridgeProvenanceLog = {
  sourceWaveCount: number;
  sourceLaneCount: number;
  roleMapping: Array<{
    role: string;
    wave: number;
    assignmentIndex: number;
  }>;
  unmappedRoles: string[];
  warnings: string[];
};

export type DelegationBridgeResult = {
  supervisorPlan: SupervisorDelegationPlanInput;
  sourceType: "user-delegation" | "supervisor-delegation";
  provenanceLog: DelegationBridgeProvenanceLog;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isManagerRole = (role: string): boolean =>
  (MANAGER_ROLES as readonly string[]).includes(role);

const buildBranch = (waveNumber: number, role: string): string =>
  `work/supervisor/wave-${waveNumber}/role-${role.toLowerCase()}`;

const buildWorktreePath = (waveNumber: number, role: string): string =>
  `.opencode/supervisor/worktrees/wave-${waveNumber}-${role.toLowerCase()}`;

const defaultExecutionPolicy: SupervisorExecutionPolicy = {
  mode: "delegate-only",
  allowSupervisorDirectEdits: false,
  requireDelegationLog: true,
  requireAgentWorktreeBinding: true,
  requireDedicatedIntegrationAgent: false,
  integrationAgentLabel: "INTEGRATION"
};

// ---------------------------------------------------------------------------
// Core bridge function
// ---------------------------------------------------------------------------

/**
 * Maps a runtime `DelegationPlan` (user-facing, wave-based) into a
 * `SupervisorDelegationPlanInput` that `createSupervisorDelegationPlan` can
 * consume, producing a full provenance log along the way.
 */
export const bridgeDelegationPlan = (input: DelegationBridgeInput): DelegationBridgeResult => {
  const { plan, availableRoles } = input;

  // Validate non-empty waves
  if (!plan.waves || plan.waves.length === 0) {
    throw new Error("DelegationPlan must contain at least one wave.");
  }

  const warnings: string[] = [];
  const roleMapping: DelegationBridgeProvenanceLog["roleMapping"] = [];
  const unmappedRoles: string[] = [];

  // Determine available roles set for unmapped detection
  const availableSet = availableRoles
    ? new Set(availableRoles.map((r) => r.toUpperCase()))
    : null;

  // Build assignments from waves
  const assignments: SupervisorDelegationAssignmentInput[] = [];
  let assignmentIndex = 0;

  for (const wave of plan.waves) {
    for (const role of wave.roles) {
      // Check if role is available when availableRoles is provided
      if (availableSet && !availableSet.has(role)) {
        unmappedRoles.push(role);
        continue;
      }

      // Detect manager roles in implementation assignments
      if (isManagerRole(role)) {
        warnings.push(
          `Manager role '${role}' assigned in wave ${wave.wave}; consider delegating implementation to DEV, FE, BE, or UX.`
        );
      }

      const assignment: SupervisorDelegationAssignmentInput = {
        role: role as Role,
        agentLabel: role,
        branch: buildBranch(wave.wave, role),
        worktreePath: buildWorktreePath(wave.wave, role),
        responsibilities: [wave.goal]
      };

      assignments.push(assignment);

      roleMapping.push({
        role,
        wave: wave.wave,
        assignmentIndex
      });

      assignmentIndex++;
    }
  }

  // Determine supervisorLabel from leadRole, falling back to the first role
  // in the first wave if leadRole is not set
  const supervisorLabel = plan.leadRole
    ?? plan.waves[0]?.roles[0]
    ?? "SUPERVISOR";

  // Count total unique roles across all waves as "lanes"
  const allRoles = new Set(plan.waves.flatMap((w) => w.roles));
  const sourceLaneCount = allRoles.size;

  const provenanceLog: DelegationBridgeProvenanceLog = {
    sourceWaveCount: plan.waves.length,
    sourceLaneCount,
    roleMapping,
    unmappedRoles: [...new Set(unmappedRoles)],
    warnings
  };

  const supervisorPlan: SupervisorDelegationPlanInput = {
    supervisorLabel,
    directEditsRequested: false,
    assignments,
    policy: { ...defaultExecutionPolicy }
  };

  return {
    supervisorPlan,
    sourceType: "user-delegation",
    provenanceLog
  };
};

// ---------------------------------------------------------------------------
// Source detection
// ---------------------------------------------------------------------------

/**
 * Inspects an unknown plan object and determines whether it is a user-facing
 * `DelegationPlan` (has `waves`) or a supervisor-facing plan (has
 * `assignments`).
 */
export const detectDelegationPlanSource = (
  plan: unknown
): "user-delegation" | "supervisor-delegation" => {
  if (typeof plan !== "object" || plan === null) {
    throw new Error("Cannot detect delegation plan source: input is not an object.");
  }

  const record = plan as Record<string, unknown>;

  const hasWaves = Array.isArray(record.waves);
  const hasAssignments = Array.isArray(record.assignments);

  if (hasWaves && hasAssignments) {
    throw new Error("Cannot detect delegation plan source: input includes both 'waves' and 'assignments'.");
  }

  if (hasWaves) {
    return "user-delegation";
  }

  if (hasAssignments) {
    return "supervisor-delegation";
  }

  throw new Error(
    "Cannot detect delegation plan source: input has neither 'waves' nor 'assignments'."
  );
};
