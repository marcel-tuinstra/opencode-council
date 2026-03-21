import type { SupervisorPlanResult } from "./supervisor-trigger";
import type { SupervisorLaneDefinition } from "./supervisor-scheduler";
import { getSupervisorPolicy } from "./supervisor-config";

const DISCOVERY_INSTRUCTION_INTENTS = new Set(["research", "marketing", "roadmap"]);
const DISCOVERY_OUTPUT_REGEX = /\b(research|compare|evaluate|benchmark|synthesize|recommend|findings|summary|summari[sz]e|scope|define|audience|persona|icp|competitor|mvp|prd|requirements?|roadmap|positioning|messaging)\b/i;

const isDiscoveryOrientedPlan = (plan: SupervisorPlanResult): boolean => {
  return DISCOVERY_INSTRUCTION_INTENTS.has(plan.goalPlan.intent) || DISCOVERY_OUTPUT_REGEX.test(plan.goalPlan.goal);
};

export const buildSupervisorSystemInstruction = (
  plan: SupervisorPlanResult
): string => {
  if (plan.status === "unsupported") {
    return [
      "You are operating in Supervisor mode.",
      "",
      "Supervisor planning is currently unsupported for this goal.",
      `Warnings: ${plan.warnings.join("; ") || "none provided"}`,
      "",
      "Do not launch child sessions. Request clarification or remediation from the user."
    ].join("\n");
  }

  const policy = getSupervisorPolicy();
  const lines: string[] = [];
  const discoveryPlan = isDiscoveryOrientedPlan(plan);

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
  lines.push("Execute lanes in order. For each lane, use the `supervisor` tool to launch a child session.");
  if (discoveryPlan) {
    lines.push("Keep the plan bounded and synthesis-oriented; do not turn this into an open-ended brainstorm.");
    lines.push("Each lane should produce concrete findings, comparisons, recommendations, assumptions, and scoped next steps when relevant.");
  } else {
    lines.push("Bias toward concrete execution progress, implementation evidence, validation, and review-ready handoff notes.");
  }
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

  if (discoveryPlan) {
    lines.push("Report progress after each lane with findings, recommendation shifts, assumptions, and next-step scope.");
  } else {
    lines.push("Report progress after each lane completes.");
  }

  return lines.join("\n");
};
