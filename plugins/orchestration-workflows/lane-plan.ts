import type { WorkUnit } from "./work-unit";

export type StructuralSignalLevel = "low" | "medium" | "high";
export type BlastRadius = "contained" | "adjacent" | "broad";
export type TestIsolation = "isolated" | "partial" | "shared" | "none";

export type WorkUnitStructuralSignals = {
  fileOverlap: StructuralSignalLevel;
  coupling: StructuralSignalLevel;
  blastRadius: BlastRadius;
  unknownCount: number;
  testIsolation: TestIsolation;
};

export type LanePlanningWorkUnit = {
  id: string;
  workUnit: WorkUnit;
  dependsOn: string[];
  signals: WorkUnitStructuralSignals;
};

export type DependencyNode = {
  id: string;
  blockedBy: string[];
  unblocks: string[];
  parallelizableWith: string[];
  lane: number;
  structuralScore: number;
};

export type LaneRecommendation = {
  lane: number;
  workUnitIds: string[];
  maxStructuralScore: number;
  reasons: string[];
};

export type LanePlan = {
  usesExpectedDuration: false;
  scoringSignals: readonly [
    "fileOverlap",
    "coupling",
    "blastRadius",
    "unknownCount",
    "testIsolation"
  ];
  dependencyGraph: DependencyNode[];
  lanes: LaneRecommendation[];
};

const LEVEL_SCORE: Record<StructuralSignalLevel, number> = {
  low: 1,
  medium: 2,
  high: 3
};

const BLAST_RADIUS_SCORE: Record<BlastRadius, number> = {
  contained: 1,
  adjacent: 2,
  broad: 3
};

const TEST_ISOLATION_SCORE: Record<TestIsolation, number> = {
  isolated: 0,
  partial: 1,
  shared: 2,
  none: 3
};

const SCORING_SIGNALS = [
  "fileOverlap",
  "coupling",
  "blastRadius",
  "unknownCount",
  "testIsolation"
] as const;

const dedupe = (items: string[]): string[] => Array.from(new Set(items));

const compareIds = (left: string, right: string): number => left.localeCompare(right);

const scoreSignalReasons = (signals: WorkUnitStructuralSignals): string[] => {
  const reasons: string[] = [];

  if (signals.fileOverlap !== "low") {
    reasons.push(`file overlap ${signals.fileOverlap}`);
  }

  if (signals.coupling !== "low") {
    reasons.push(`coupling ${signals.coupling}`);
  }

  if (signals.blastRadius !== "contained") {
    reasons.push(`blast radius ${signals.blastRadius}`);
  }

  if (signals.unknownCount > 0) {
    reasons.push(`unknown count ${signals.unknownCount}`);
  }

  if (signals.testIsolation !== "isolated") {
    reasons.push(`test isolation ${signals.testIsolation}`);
  }

  return reasons;
};

export const scoreWorkUnitComplexity = (signals: WorkUnitStructuralSignals): number => {
  const unknownScore = Math.min(Math.max(signals.unknownCount, 0), 3);

  return LEVEL_SCORE[signals.fileOverlap]
    + LEVEL_SCORE[signals.coupling]
    + BLAST_RADIUS_SCORE[signals.blastRadius]
    + unknownScore
    + TEST_ISOLATION_SCORE[signals.testIsolation];
};

const assertUniqueIds = (units: LanePlanningWorkUnit[]): void => {
  const ids = new Set<string>();

  for (const unit of units) {
    if (ids.has(unit.id)) {
      throw new Error(`Duplicate lane planning work unit id: ${unit.id}`);
    }

    ids.add(unit.id);
  }
};

const buildDependencyMap = (units: LanePlanningWorkUnit[]): Map<string, string[]> => {
  const knownIds = new Set(units.map((unit) => unit.id));

  return new Map(
    units.map((unit) => [
      unit.id,
      dedupe(unit.dependsOn.filter((dependencyId) => knownIds.has(dependencyId))).sort(compareIds)
    ])
  );
};

const resolveLane = (
  id: string,
  dependencies: Map<string, string[]>,
  resolved: Map<string, number>,
  visiting: Set<string>
): number => {
  const cached = resolved.get(id);
  if (cached) {
    return cached;
  }

  if (visiting.has(id)) {
    throw new Error(`Cycle detected in lane planning dependencies at ${id}`);
  }

  visiting.add(id);
  const blockedBy = dependencies.get(id) ?? [];
  const lane = blockedBy.length === 0
    ? 1
    : Math.max(...blockedBy.map((dependencyId) => resolveLane(dependencyId, dependencies, resolved, visiting))) + 1;
  visiting.delete(id);
  resolved.set(id, lane);
  return lane;
};

export const planWorkUnitLanes = (units: LanePlanningWorkUnit[]): LanePlan => {
  assertUniqueIds(units);

  const dependencies = buildDependencyMap(units);
  const resolvedLanes = new Map<string, number>();

  for (const unit of units) {
    resolveLane(unit.id, dependencies, resolvedLanes, new Set<string>());
  }

  const reverseDependencies = new Map<string, string[]>();
  for (const unit of units) {
    reverseDependencies.set(unit.id, []);
  }

  for (const [id, blockedBy] of dependencies) {
    for (const dependencyId of blockedBy) {
      reverseDependencies.set(dependencyId, [...(reverseDependencies.get(dependencyId) ?? []), id]);
    }
  }

  const dependencyGraph = units
    .map((unit) => {
      const lane = resolvedLanes.get(unit.id) ?? 1;
      const lanePeers = units
        .filter((candidate) => candidate.id !== unit.id && (resolvedLanes.get(candidate.id) ?? 1) === lane)
        .map((candidate) => candidate.id)
        .sort(compareIds);

      return {
        id: unit.id,
        blockedBy: dependencies.get(unit.id) ?? [],
        unblocks: dedupe(reverseDependencies.get(unit.id) ?? []).sort(compareIds),
        parallelizableWith: lanePeers,
        lane,
        structuralScore: scoreWorkUnitComplexity(unit.signals)
      };
    })
    .sort((left, right) => left.lane - right.lane || compareIds(left.id, right.id));

  const lanes = Array.from(new Set(dependencyGraph.map((node) => node.lane)))
    .sort((left, right) => left - right)
    .map((lane) => {
      const laneUnits = units
        .filter((unit) => (resolvedLanes.get(unit.id) ?? 1) === lane)
        .sort((left, right) => {
          const scoreDifference = scoreWorkUnitComplexity(right.signals) - scoreWorkUnitComplexity(left.signals);
          return scoreDifference !== 0 ? scoreDifference : compareIds(left.id, right.id);
        });

      return {
        lane,
        workUnitIds: laneUnits.map((unit) => unit.id),
        maxStructuralScore: Math.max(...laneUnits.map((unit) => scoreWorkUnitComplexity(unit.signals))),
        reasons: dedupe(laneUnits.flatMap((unit) => scoreSignalReasons(unit.signals)))
      };
    });

  return {
    usesExpectedDuration: false,
    scoringSignals: SCORING_SIGNALS,
    dependencyGraph,
    lanes
  };
};
