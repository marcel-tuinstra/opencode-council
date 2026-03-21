import {
  planSupervisorGoal,
  type PlanSupervisorGoalResult
} from "./supervisor-goal-plan";
import {
  decomposeSupervisorGoalIntoLanes,
  type SupervisorLaneDecompositionResult
} from "./lane-decomposition";
import { normalizeWorkUnit } from "./work-unit";
import type { LanePlanningWorkUnit } from "./lane-plan";
import type { SupervisorLaneDefinition } from "./supervisor-scheduler";
import { SUPPORTED_ROLES } from "./types";
import { getSupervisorPolicy } from "./supervisor-config";

export const SUPERVISOR_TRIGGER_REGEX = /^@supervisor\s+/i;

export type SupervisorPlanResult = {
  goalPlan: PlanSupervisorGoalResult;
  workUnits: LanePlanningWorkUnit[];
  laneDecomposition: SupervisorLaneDecompositionResult | null;
  preview: string;
  status: "supported" | "unsupported";
  warnings: string[];
};

export const detectSupervisorTrigger = (
  text: string
): { detected: boolean; goal: string } => {
  const trimmed = text.trim();

  if (/^@supervisor$/i.test(trimmed)) {
    return { detected: true, goal: "" };
  }

  if (SUPERVISOR_TRIGGER_REGEX.test(trimmed)) {
    const goal = trimmed.replace(/^@supervisor\s+/i, "").trim();
    return { detected: true, goal };
  }

  return { detected: false, goal: "" };
};

const SEGMENT_SPLIT_REGEX = /[;,]\s*|\n+/;

const DISCOVERY_GOAL_REGEX = /\b(research|explore|assess|evaluate|compare|benchmark|analy[sz]e|synthesize|recommend|findings|summary|summari[sz]e|scope|define|audience|persona|icp|competitor|mvp|prd|requirements?|roadmap|positioning|messaging|goals?)\b/i;
const EXECUTION_LIST_CUE_REGEX = /\b(build|implement|fix|refactor|update|write|add|remove|migrate|ship|document|test|validate)\b/i;
const SYNTHESIS_JOINER_REGEX = /\b(and|plus|with)\b/i;

const normalizeGoalText = (value: string): string => value.replace(/\s+/g, " ").trim();

const titleCaseFirst = (value: string): string =>
  value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);

const buildSequentialWorkUnits = (segments: readonly string[]): LanePlanningWorkUnit[] => {
  const workUnits: LanePlanningWorkUnit[] = [];

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const id = `wu-${index + 1}`;
    const dependsOn = index > 0 ? [`wu-${index}`] : [];

    const normalized = normalizeWorkUnit({
      objective: segment,
      source: {
        kind: "ad-hoc",
        title: segment
      }
    });

    workUnits.push({
      id,
      workUnit: normalized,
      dependsOn,
      signals: {
        fileOverlap: "low",
        coupling: index > 0 ? "medium" : "low",
        blastRadius: "contained",
        unknownCount: 0,
        testIsolation: "isolated"
      }
    });
  }

  return workUnits;
};

const splitIntoSegments = (goalText: string): string[] => goalText
  .split(SEGMENT_SPLIT_REGEX)
  .map((segment) => normalizeGoalText(segment))
  .filter(Boolean);

const isDiscoveryStyleGoal = (goalText: string, intent: string): boolean => {
  if (["research", "marketing", "roadmap"].includes(intent)) {
    return true;
  }

  return DISCOVERY_GOAL_REGEX.test(goalText);
};

const shouldPreserveExecutionList = (goalText: string, segments: readonly string[]): boolean => {
  if (segments.length <= 1) {
    return false;
  }

  const executionSegmentCount = segments.filter((segment) => EXECUTION_LIST_CUE_REGEX.test(segment)).length;
  const discoverySegmentCount = segments.filter((segment) => DISCOVERY_GOAL_REGEX.test(segment)).length;

  if (executionSegmentCount === segments.length) {
    return true;
  }

  if (executionSegmentCount >= 2 && discoverySegmentCount === 0) {
    return true;
  }

  return /[,;\n]/.test(goalText) && /\bthen\b/i.test(goalText);
};

const buildDiscoveryWorkUnitObjectives = (goalText: string): string[] => {
  const normalizedGoal = normalizeGoalText(goalText);

  if (/\bcompare\b/i.test(normalizedGoal) && /\brecommend\b/i.test(normalizedGoal)) {
    return [
      "Frame the comparison criteria, constraints, and decision goals",
      titleCaseFirst(normalizedGoal),
      "Recommend the best option, note tradeoffs, and outline scoped next steps"
    ];
  }

  if (/\bresearch\b/i.test(normalizedGoal) && /\bcompetitor\b/i.test(normalizedGoal)) {
    return [
      "Define the competitor scan, comparison dimensions, and assumptions",
      titleCaseFirst(normalizedGoal),
      "Summarize the most relevant findings, recommendations, implications, and bounded next steps"
    ];
  }

  if (/\bdefine\b/i.test(normalizedGoal) && /\bmvp\b/i.test(normalizedGoal)) {
    return [
      "Define the target audience, core user goals, and product assumptions",
      "Translate the goals into a bounded MVP scope with exclusions and tradeoffs",
      "Recommend the initial delivery plan, open questions, and next steps"
    ];
  }

  const parts = normalizedGoal
    .split(/,|;|\band\b/gi)
    .map((part) => normalizeGoalText(part.replace(/^(research|compare|define|scope|summari[sz]e)\s+/i, "")))
    .filter(Boolean);
  const focus = parts.slice(0, 3).join(", ");
  const workUnits = [
    focus.length > 0
      ? `Frame the discovery scope, success criteria, and assumptions for ${focus}`
      : "Frame the discovery scope, success criteria, and assumptions",
    titleCaseFirst(normalizedGoal)
  ];

  if (parts.length > 1 || SYNTHESIS_JOINER_REGEX.test(normalizedGoal)) {
    workUnits.push("Synthesize the findings into recommendations, scoped next steps, and follow-up questions");
  }

  return workUnits.slice(0, 4);
};

export const buildWorkUnitsFromGoal = (
  goalText: string,
  intent = "mixed"
): LanePlanningWorkUnit[] => {
  const segments = splitIntoSegments(goalText);

  if (shouldPreserveExecutionList(goalText, segments)) {
    return buildSequentialWorkUnits(segments);
  }

  if (isDiscoveryStyleGoal(goalText, intent)) {
    return buildSequentialWorkUnits(buildDiscoveryWorkUnitObjectives(goalText));
  }

  return buildSequentialWorkUnits(segments.length > 0 ? segments : [normalizeGoalText(goalText)]);
};

export const buildSupervisorPlan = (goalText: string): SupervisorPlanResult => {
  const goalPlan = planSupervisorGoal({
    goal: goalText,
    availableRoles: [...SUPPORTED_ROLES]
  });

  if (goalPlan.status === "unsupported") {
    const preview = formatUnsupportedPreview(goalPlan);
    return {
      goalPlan,
      workUnits: [],
      laneDecomposition: null,
      preview,
      status: "unsupported",
      warnings: [...goalPlan.reasons]
    };
  }

  const workUnits = buildWorkUnitsFromGoal(goalText, goalPlan.intent);
  const laneDecomposition = decomposeSupervisorGoalIntoLanes({
    goalPlan,
    workUnits
  });

  const warnings: string[] = [...laneDecomposition.warnings];
  const result: SupervisorPlanResult = {
    goalPlan,
    workUnits,
    laneDecomposition,
    preview: "",
    status: laneDecomposition.status === "supported" ? "supported" : "unsupported",
    warnings
  };

  result.preview = formatSupervisorPreview(result);
  return result;
};

const formatUnsupportedPreview = (
  goalPlan: PlanSupervisorGoalResult,
  reasons?: readonly string[]
): string => {
  const effectiveReasons = reasons ?? goalPlan.reasons;
  const lines: string[] = [];
  lines.push("[Supervisor] Plan — Unsupported");
  lines.push("");
  lines.push(`Goal: ${goalPlan.goal}`);
  lines.push("");
  lines.push("Reasons:");
  if (effectiveReasons.length === 0) {
    lines.push("  - No reason provided");
  } else {
    for (const reason of effectiveReasons) {
      lines.push(`  - ${reason}`);
    }
  }
  if (goalPlan.remediation.length > 0) {
    lines.push("");
    lines.push("Remediation:");
    for (const item of goalPlan.remediation) {
      lines.push(`  - ${item}`);
    }
  }
  return lines.join("\n");
};

const padRight = (value: string, width: number): string =>
  value + " ".repeat(Math.max(0, width - value.length));

export const formatSupervisorPreview = (plan: SupervisorPlanResult): string => {
  if (plan.status === "unsupported") {
    return formatUnsupportedPreview(plan.goalPlan, plan.warnings);
  }

  const policy = getSupervisorPolicy();
  const lines: string[] = [];

  lines.push("[Supervisor] Plan");
  lines.push("");
  lines.push(`Goal: ${plan.goalPlan.goal}`);
  lines.push(`Intent: ${plan.goalPlan.intent} | Confidence: ${plan.goalPlan.confidence} | Budget: ${plan.goalPlan.budgetClass}`);
  lines.push("");

  const laneDefinitions: readonly SupervisorLaneDefinition[] =
    plan.laneDecomposition?.laneDefinitionsPreview ?? [];

  if (laneDefinitions.length > 0) {
    lines.push("Lanes:");

    const laneIdWidth = Math.max(
      ...laneDefinitions.map((def: SupervisorLaneDefinition) => def.laneId.length),
      6
    );
    const objectiveMap = new Map<string, string>();
    for (const unit of plan.workUnits) {
      objectiveMap.set(unit.id, unit.workUnit.objective);
    }

    const roleRecommendations = plan.goalPlan.recommendedRoles;
    const defaultRole = roleRecommendations.length > 0 ? roleRecommendations[0]!.role : "DEV";

    const objectiveWidth = Math.max(
      ...laneDefinitions.map((d: SupervisorLaneDefinition) =>
        d.workUnitIds.map((id: string) => objectiveMap.get(id) ?? id).join(", ").length
      ),
      32
    );

    for (const def of laneDefinitions) {
      const objective = def.workUnitIds
        .map((id: string) => objectiveMap.get(id) ?? id)
        .join(", ");

      const role = def.sequence <= roleRecommendations.length
        ? roleRecommendations[def.sequence - 1]!.role
        : defaultRole;

      const deps = def.dependsOnLaneIds.length > 0
        ? `depends on ${def.dependsOnLaneIds.join(", ")}`
        : "--";

      lines.push(
        `  ${padRight(def.laneId, laneIdWidth)}  ${padRight(objective, objectiveWidth)}  ${padRight(String(role), 4)}  ${deps}`
      );
    }

    lines.push("");
  }

  const activeLaneCap = Math.min(
    policy.limits.lanes.activeCapsByTier["small-high-risk"],
    policy.limits.lanes.activeCapsByTier["medium-moderate-risk"],
    policy.limits.lanes.activeCapsByTier["large-mature"]
  );

  const executionMode = laneDefinitions.length <= 1
    ? "single"
    : activeLaneCap <= 1
      ? `sequential (${activeLaneCap} active lane)`
      : `parallel (up to ${activeLaneCap} active lanes)`;

  lines.push(`Execution: ${executionMode} | Merge: ${policy.approvalGates.mergeMode}`);
  lines.push(`Policy: ${policy.profile}`);
  lines.push("");
  lines.push("[Supervisor] Mode: active. Child sessions will be launched for each lane.");

  return lines.join("\n");
};
