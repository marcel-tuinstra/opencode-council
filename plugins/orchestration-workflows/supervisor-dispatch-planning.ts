import { decomposeSupervisorGoalIntoLanes, type DecomposeSupervisorGoalIntoLanesInput } from "./lane-decomposition";
import type { LanePlanningWorkUnit } from "./lane-plan";
import {
  routeSupervisorWorkUnit,
  type RouteSupervisorWorkUnitResult
} from "./supervisor-routing";
import type { SupervisorDispatchLaneInput } from "./supervisor-scheduler";
import type { PlanSupervisorGoalResult } from "./supervisor-goal-plan";

export type CreateSupervisorDispatchPlanInput = DecomposeSupervisorGoalIntoLanesInput & {
  readyDependencyReferences?: readonly string[];
};

export type SupervisorDispatchPlanStatus = "supported" | "unsupported";

export type SupervisorDispatchPlanResult = {
  status: SupervisorDispatchPlanStatus;
  goalPlan: PlanSupervisorGoalResult;
  workUnits: readonly LanePlanningWorkUnit[];
  laneInputs: readonly SupervisorDispatchLaneInput[];
  routeResults: readonly RouteSupervisorWorkUnitResult[];
  warnings: readonly string[];
  remediation: readonly string[];
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

const dedupe = (values: readonly string[]): readonly string[] => freezeList(Array.from(new Set(values)));

export const createSupervisorDispatchPlan = (
  input: CreateSupervisorDispatchPlanInput
): SupervisorDispatchPlanResult => {
  const decomposition = decomposeSupervisorGoalIntoLanes(input);

  if (decomposition.status !== "supported" || !decomposition.laneDefinitionsPreview) {
    return {
      status: "unsupported",
      goalPlan: input.goalPlan,
      workUnits: freezeList([...input.workUnits]),
      laneInputs: freezeList([]),
      routeResults: freezeList([]),
      warnings: decomposition.warnings,
      remediation: decomposition.remediation
    };
  }

  const routeResults = freezeList(input.workUnits
    .map((unit) => routeSupervisorWorkUnit({
      workUnitId: unit.id,
      workUnit: unit.workUnit,
      laneDefinitions: decomposition.laneDefinitionsPreview,
      readyDependencyReferences: input.readyDependencyReferences
    })));

  const laneInputs = freezeList(decomposition.laneDefinitionsPreview.map((definition) => {
    const laneRoutes = routeResults.filter((result) => result.laneId === definition.laneId);
    const missingPrerequisites = dedupe(laneRoutes.flatMap((result) => result.missingPrerequisites));
    const manualTriages = laneRoutes.filter((result) => result.nextAction === "manual-triage");
    const waitingOn = dedupe([
      ...missingPrerequisites,
      ...manualTriages.map((result) => `manual triage required for ${result.workUnitId}`)
    ]);

    return Object.freeze({
      definition,
      waitingOn
    });
  }));

  const warnings = dedupe([
    ...decomposition.warnings,
    ...routeResults
      .filter((result) => result.nextAction === "manual-triage")
      .map((result) => `Routing confidence stayed ${result.confidence} for ${result.workUnitId}; dispatch will hold that lane.`)
  ]);

  return {
    status: "supported",
    goalPlan: decomposition.goalPlan,
    workUnits: freezeList([...input.workUnits]),
    laneInputs,
    routeResults,
    warnings,
    remediation: freezeList([])
  };
};
