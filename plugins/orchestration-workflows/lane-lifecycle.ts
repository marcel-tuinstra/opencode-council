export type LaneLifecycleState = "planned" | "active" | "waiting" | "review_ready" | "complete";

export type RepoRiskTier = "small-high-risk" | "medium-moderate-risk" | "large-mature";

export type LaneCapPolicyConfig = {
  maxActiveLanes?: number;
};

export type LaneLifecyclePolicy = {
  initialState: "planned";
  terminalState: "complete";
  countsTowardActiveLaneCap: readonly ["active"];
  allowedTransitions: Readonly<Record<LaneLifecycleState, readonly LaneLifecycleState[]>>;
};

export type LanePolicy = {
  repoRiskTier: RepoRiskTier;
  defaultMaxActiveLanes: number;
  maxActiveLanes: number;
  overrideSource: "default" | "explicit-config";
  lifecycle: LaneLifecyclePolicy;
};

export const DEFAULT_ACTIVE_LANE_CAPS: Readonly<Record<RepoRiskTier, number>> = {
  "small-high-risk": 2,
  "medium-moderate-risk": 3,
  "large-mature": 4
};

export const LANE_LIFECYCLE_POLICY: LaneLifecyclePolicy = {
  initialState: "planned",
  terminalState: "complete",
  countsTowardActiveLaneCap: ["active"],
  allowedTransitions: {
    planned: ["active"],
    active: ["waiting", "review_ready"],
    waiting: ["active", "review_ready"],
    review_ready: ["active", "complete"],
    complete: []
  }
};

export const getDefaultActiveLaneCap = (repoRiskTier: RepoRiskTier): number => DEFAULT_ACTIVE_LANE_CAPS[repoRiskTier];

export const getAllowedLaneTransitions = (state: LaneLifecycleState): readonly LaneLifecycleState[] => (
  LANE_LIFECYCLE_POLICY.allowedTransitions[state]
);

export const countsTowardActiveLaneCap = (state: LaneLifecycleState): boolean => state === "active";

export const canTransitionLaneState = (from: LaneLifecycleState, to: LaneLifecycleState): boolean => (
  getAllowedLaneTransitions(from).includes(to)
);

export const assertLaneStateTransition = (from: LaneLifecycleState, to: LaneLifecycleState): void => {
  if (!canTransitionLaneState(from, to)) {
    throw new Error(`Invalid lane state transition: ${from} -> ${to}`);
  }
};

const assertExplicitLaneCapOverride = (value: number): void => {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Invalid explicit lane cap override: ${value}`);
  }
};

export const resolveLanePolicy = (
  repoRiskTier: RepoRiskTier,
  config?: LaneCapPolicyConfig
): LanePolicy => {
  const defaultMaxActiveLanes = getDefaultActiveLaneCap(repoRiskTier);
  const override = config?.maxActiveLanes;

  if (override !== undefined) {
    assertExplicitLaneCapOverride(override);
  }

  return {
    repoRiskTier,
    defaultMaxActiveLanes,
    maxActiveLanes: override ?? defaultMaxActiveLanes,
    overrideSource: override === undefined ? "default" : "explicit-config",
    lifecycle: LANE_LIFECYCLE_POLICY
  };
};

export const assertActiveLaneCountWithinPolicy = (
  activeLaneCount: number,
  policy: LanePolicy
): void => {
  if (!Number.isInteger(activeLaneCount) || activeLaneCount < 0) {
    throw new Error(`Invalid active lane count: ${activeLaneCount}`);
  }

  if (activeLaneCount > policy.maxActiveLanes) {
    throw new Error(
      `Active lane cap exceeded: ${activeLaneCount} active lanes exceeds cap ${policy.maxActiveLanes} for ${policy.repoRiskTier}`
    );
  }
};
