import type { SupervisorPlanResult } from "./supervisor-trigger";
import type { SupervisorLaneDefinition } from "./supervisor-scheduler";
import { getSupervisorPolicy } from "./supervisor-config";

export const buildSupervisorSystemInstruction = (
  plan: SupervisorPlanResult
): string => {
  const policy = getSupervisorPolicy();
  const lines: string[] = [];

  lines.push("You are operating in Supervisor mode.");
  lines.push("");

  const laneDefinitions: readonly SupervisorLaneDefinition[] =
    plan.laneDecomposition?.laneDefinitionsPreview ?? [];
  const objectiveMap = new Map<string, string>();
  for (const unit of plan.workUnits) {
    objectiveMap.set(unit.id, unit.workUnit.objective);
  }

  const roleRecommendations = plan.goalPlan.recommendedRoles;
  const defaultRole = roleRecommendations.length > 0 ? roleRecommendations[0]!.role : "DEV";

  if (laneDefinitions.length > 0) {
    lines.push("## Lane Assignments");
    lines.push("");

    for (const def of laneDefinitions) {
      const objective = def.workUnitIds
        .map((id: string) => objectiveMap.get(id) ?? id)
        .join(", ");

      const role = def.sequence <= roleRecommendations.length
        ? roleRecommendations[def.sequence - 1]!.role
        : defaultRole;

      const deps = def.dependsOnLaneIds.length > 0
        ? ` (depends on: ${def.dependsOnLaneIds.join(", ")})`
        : "";

      lines.push(`- **${def.laneId}** [${role}]: ${objective}${deps}`);
    }

    lines.push("");
  }

  if (laneDefinitions.some((def: SupervisorLaneDefinition) => def.dependsOnLaneIds.length > 0)) {
    lines.push("## Dependency Ordering Constraints");
    lines.push("");

    for (const def of laneDefinitions) {
      if (def.dependsOnLaneIds.length > 0) {
        lines.push(
          `- ${def.laneId} must not start until ${def.dependsOnLaneIds.join(" and ")} ${def.dependsOnLaneIds.length === 1 ? "has" : "have"} completed.`
        );
      }
    }

    lines.push("");
  }

  lines.push("## Execution Protocol");
  lines.push("");
  lines.push(
    "Execute lanes in order. For each lane, use the `supervisor` tool to launch a child session."
  );
  lines.push("");

  lines.push("## Budget and Approval Boundaries");
  lines.push("");
  lines.push(`- Budget class: ${plan.goalPlan.budgetClass}`);
  lines.push(`- Requires approval: ${plan.goalPlan.requiresApproval ? "yes" : "no"}`);

  if (plan.goalPlan.approvalBoundaries.length > 0) {
    lines.push(
      `- Approval boundaries: ${plan.goalPlan.approvalBoundaries.join(", ")}`
    );
  }

  lines.push(`- Merge mode: ${policy.approvalGates.mergeMode}`);
  lines.push(`- Escalation mode: ${policy.approvalGates.escalationMode}`);
  lines.push("");

  lines.push("Report progress after each lane completes.");

  return lines.join("\n");
};
