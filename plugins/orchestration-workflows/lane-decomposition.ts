import { planWorkUnitLanes, type LanePlan, type LanePlanningWorkUnit } from "./lane-plan";
import { createSupervisorLaneDefinitions, type CreateSupervisorLaneDefinitionsOptions, type SupervisorLaneDefinition } from "./supervisor-scheduler";
import type { PlanSupervisorGoalResult } from "./supervisor-goal-plan";

export type DecomposeSupervisorGoalIntoLanesInput = {
  goalPlan: PlanSupervisorGoalResult;
  workUnits: readonly LanePlanningWorkUnit[];
  scheduler?: CreateSupervisorLaneDefinitionsOptions;
};

export type SupervisorLaneDecompositionStatus = "supported" | "unsupported";

export type SupervisorLaneDecompositionResult = {
  status: SupervisorLaneDecompositionStatus;
  goalPlan: PlanSupervisorGoalResult;
  lanePlan?: LanePlan;
  laneDefinitionsPreview?: readonly SupervisorLaneDefinition[];
  warnings: readonly string[];
  remediation: readonly string[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

export const decomposeSupervisorGoalIntoLanes = (
  input: DecomposeSupervisorGoalIntoLanesInput
): SupervisorLaneDecompositionResult => {
  if (input.goalPlan.status !== "supported") {
    return {
      status: "unsupported",
      goalPlan: input.goalPlan,
      warnings: freezeList([
        "Lane decomposition is blocked because goal planning did not produce a safe supported result."
      ]),
      remediation: freezeList(input.goalPlan.remediation)
    };
  }

  if (input.workUnits.length === 0) {
    return {
      status: "unsupported",
      goalPlan: input.goalPlan,
      warnings: freezeList([
        "Lane decomposition requires at least one explicit normalized work unit."
      ]),
      remediation: freezeList([
        "Provide one or more normalized work units with explicit dependency ids and structural signals."
      ])
    };
  }

  const lanePlan = planWorkUnitLanes([...input.workUnits]);
  const laneDefinitionsPreview = createSupervisorLaneDefinitions(lanePlan, input.scheduler);
  const warnings: string[] = [];

  if (input.goalPlan.laneCount !== laneDefinitionsPreview.length) {
    warnings.push(
      `Goal planning suggested ${input.goalPlan.laneCount} lane(s), while dependency-safe decomposition produced ${laneDefinitionsPreview.length}.`
    );
  }

  return {
    status: "supported",
    goalPlan: input.goalPlan,
    lanePlan,
    laneDefinitionsPreview,
    warnings: freezeList(warnings),
    remediation: freezeList([])
  };
};
