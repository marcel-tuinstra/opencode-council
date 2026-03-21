import { INTENT_ROLE_WEIGHTS } from "./constants";
import { detectIntent } from "./intent";
import { getSupervisorPolicy } from "./supervisor-config";
import type { Intent, Role } from "./types";
import { SUPPORTED_ROLES } from "./types";

export type SupervisorGoalPlanningConfidence = "low" | "medium" | "high";
export type SupervisorGoalBudgetClass = "light" | "standard" | "intensive";
export type SupervisorGoalPlanningStatus = "supported" | "unsupported";

export type SupervisorGoalRoleRecommendation = {
  role: Role;
  count: number;
  rationale: string;
};

export type PlanSupervisorGoalInput = {
  goal: string;
  requestedByRole?: Role;
  availableRoles?: readonly Role[];
  maxRoles?: number;
};

export type PlanSupervisorGoalResult = {
  status: SupervisorGoalPlanningStatus;
  goal: string;
  intent: Intent;
  confidence: SupervisorGoalPlanningConfidence;
  budgetClass: SupervisorGoalBudgetClass;
  laneCount: number;
  requiresApproval: boolean;
  approvalBoundaries: readonly string[];
  recommendedRoles: readonly SupervisorGoalRoleRecommendation[];
  reasons: readonly string[];
  remediation: readonly string[];
};

const ACTION_REGEX = /\b(implement|build|fix|refactor|design|plan|investigate|analy[sz]e|draft|ship|deliver|create|update|migrate|optimi[sz]e|test|validate|document|research|explore|scope|define|identify|assess|evaluate|compare|synthesize|recommend|benchmark|map|size)\b/i;
const DELIVERABLE_REGEX = /\b(pull request|pr|test|docs?|release|workflow|story|lane|runbook|policy|dashboard|playbook|plan|mvp|persona|audience|icp|competitor analysis|brief|prd|requirements?|recommendation|findings|shortlist|options?|decision memo|summary|patterns?)\b/i;
const DISCOVERY_CUE_REGEX = /\b(research|explore|scope|define|identify|assess|evaluate|compare|synthesize|recommend|benchmark|map|size|mvp|persona|audience|icp|competitor|brief|prd|requirements?|recommendation|findings|shortlist|options?|decision memo)\b/i;
const OPEN_ENDED_IDEATION_REGEX = /\b(brainstorm|ideate|blue-sky|startup ideas?)\b/i;
const UNBOUNDED_DISCOVERY_REGEX = /\b(entire|whole|full|all(?:\s+of)?)\b[\s\S]{0,40}\b(market|landscape|industry|category|space)\b/i;
const LONG_HORIZON_STRATEGY_REGEX = /\b(?:\d{1,2}[- ]month|annual|year(?:ly)?|long[- ]term|multi[- ]year)\s+strategy\b/i;
const COMPLEXITY_CUES_REGEX = /\b(parallel|multiple|multi-|across|plus|and|integration|migrate|end-to-end|orchestrat|handoff|dependency)\b/gi;
const RISK_CUES_REGEX = /\b(security|production|prod|release|merge|destructive|delete|billing|auth|credential|secret)\b/gi;

const APPROVAL_KEYWORDS = Object.freeze({
  merge: /\b(merge|auto-merge|pull request)\b/i,
  release: /\b(release|deploy|production|prod)\b/i,
  destructive: /\b(delete|drop|truncate|force|destroy|reset)\b/i,
  securitySensitive: /\b(security|auth|credential|secret|token|key|permission)\b/i,
  budgetExceptions: /\b(budget|overrun|override)\b/i,
  automationWidening: /\b(auto-merge|full autonomy|without review|bypass)\b/i
} as const);

const dedupeStrings = (values: readonly string[]): readonly string[] => Object.freeze(Array.from(new Set(values)));

const countRegexMatches = (input: string, regex: RegExp): number => {
  const matches = input.match(regex);
  return matches ? matches.length : 0;
};

const detectApprovalBoundaries = (goal: string): readonly string[] => {
  const boundaries = getSupervisorPolicy().approvalGates.boundaries;
  const detected: string[] = [];

  if (boundaries.merge && APPROVAL_KEYWORDS.merge.test(goal)) {
    detected.push("merge");
  }

  if (boundaries.release && APPROVAL_KEYWORDS.release.test(goal)) {
    detected.push("release");
  }

  if (boundaries.destructive && APPROVAL_KEYWORDS.destructive.test(goal)) {
    detected.push("destructive");
  }

  if (boundaries.securitySensitive && APPROVAL_KEYWORDS.securitySensitive.test(goal)) {
    detected.push("securitySensitive");
  }

  if (boundaries.budgetExceptions && APPROVAL_KEYWORDS.budgetExceptions.test(goal)) {
    detected.push("budgetExceptions");
  }

  if (boundaries.automationWidening && APPROVAL_KEYWORDS.automationWidening.test(goal)) {
    detected.push("automationWidening");
  }

  return dedupeStrings(detected);
};

const resolveBudgetClass = (complexityCueCount: number, riskCueCount: number, goalLength: number): SupervisorGoalBudgetClass => {
  if (complexityCueCount >= 3 || riskCueCount >= 2) {
    return "intensive";
  }

  if (complexityCueCount >= 1 || goalLength >= 120) {
    return "standard";
  }

  return "light";
};

const resolveConfidence = (
  intent: Intent,
  hasActionVerb: boolean,
  hasDeliverableCue: boolean,
  hasDiscoveryCue: boolean,
  ambiguous: boolean
): SupervisorGoalPlanningConfidence => {
  if (ambiguous) {
    return "low";
  }

  if (intent === "mixed" || (!hasDeliverableCue && !hasDiscoveryCue)) {
    return "medium";
  }

  return hasActionVerb ? "high" : "medium";
};

const resolveAmbiguity = (
  goal: string,
  intent: Intent,
  hasActionVerb: boolean,
  hasDeliverableCue: boolean,
  hasDiscoveryCue: boolean
): boolean => {
  if (goal.trim().length < 20) {
    return true;
  }

  if (
    OPEN_ENDED_IDEATION_REGEX.test(goal) ||
    UNBOUNDED_DISCOVERY_REGEX.test(goal) ||
    LONG_HORIZON_STRATEGY_REGEX.test(goal)
  ) {
    return true;
  }

  if (!hasActionVerb && !hasDeliverableCue) {
    return true;
  }

  return intent === "mixed" && !hasActionVerb && !hasDeliverableCue && !hasDiscoveryCue;
};

const resolveLeadRole = (intent: Intent): Role => getSupervisorPolicy().routing.intentProfiles[intent].leadRole;

const clampRoleCount = (value: number): number => Math.max(1, Math.min(value, 3));

const buildRoleRecommendations = (input: {
  intent: Intent;
  requestedByRole: Role;
  confidence: SupervisorGoalPlanningConfidence;
  budgetClass: SupervisorGoalBudgetClass;
  availableRoles: readonly Role[];
  maxRoles: number;
}): readonly SupervisorGoalRoleRecommendation[] => {
  const intentWeights = INTENT_ROLE_WEIGHTS[input.intent];
  const leadRole = resolveLeadRole(input.intent);
  const selected = new Set<Role>();

  const maybeSelect = (role: Role): void => {
    if (selected.size >= input.maxRoles) {
      return;
    }

    if (!input.availableRoles.includes(role)) {
      return;
    }

    selected.add(role);
  };

  maybeSelect(input.requestedByRole);
  maybeSelect(leadRole);

  if (input.confidence === "low") {
    maybeSelect(getSupervisorPolicy().routing.intentProfiles[input.intent].fallbackLeadRole);
  }

  const weightedRoles = [...input.availableRoles]
    .sort((left, right) => intentWeights[right] - intentWeights[left] || left.localeCompare(right));

  for (const role of weightedRoles) {
    if (intentWeights[role] < 3) {
      continue;
    }

    maybeSelect(role);
  }

  if (selected.size === 0) {
    maybeSelect(input.requestedByRole);
  }

  const recommendations = [...selected]
    .map((role) => {
      const roleWeight = intentWeights[role];
      const boosted = input.budgetClass === "intensive" && (role === "DEV" || role === "RESEARCH" || role === leadRole);
      const count = clampRoleCount(1 + (boosted ? 1 : 0) + (roleWeight >= 5 && input.budgetClass !== "light" ? 1 : 0));
      const rationaleParts = [
        role === leadRole ? "Lead role for detected intent" : "Supporting role for detected intent",
        `intent weight ${roleWeight}`
      ];

      if (role === input.requestedByRole) {
        rationaleParts.push("Requested delegate role");
      }

      if (boosted) {
        rationaleParts.push(`Boosted for ${input.budgetClass} scope`);
      }

      return {
        role,
        count,
        rationale: `${rationaleParts.join("; ")}.`
      } satisfies SupervisorGoalRoleRecommendation;
    })
    .sort((left, right) => right.count - left.count || left.role.localeCompare(right.role));

  return Object.freeze(recommendations);
};

const resolveLaneCount = (
  recommendationCount: number,
  complexityCueCount: number,
  maxRoles: number
): number => {
  const policyLaneCaps = getSupervisorPolicy().limits.lanes.activeCapsByTier;
  const maxLaneCap = Math.max(
    policyLaneCaps["small-high-risk"],
    policyLaneCaps["medium-moderate-risk"],
    policyLaneCaps["large-mature"]
  );
  const proposed = Math.max(1, Math.min(maxRoles, recommendationCount) + (complexityCueCount >= 2 ? 1 : 0));
  return Math.min(proposed, maxLaneCap);
};

export const planSupervisorGoal = (input: PlanSupervisorGoalInput): PlanSupervisorGoalResult => {
  const goal = input.goal.trim();
  const requestedByRole = input.requestedByRole ?? "CTO";
  const availableRoles = (input.availableRoles ?? SUPPORTED_ROLES).filter(
    (role: Role, index: number, all: readonly Role[]) => all.indexOf(role) === index
  );
  const maxRoles = Math.max(1, Math.min(input.maxRoles ?? 4, availableRoles.length));
  const intent = detectIntent(goal);
  const hasActionVerb = ACTION_REGEX.test(goal);
  const hasDeliverableCue = DELIVERABLE_REGEX.test(goal);
  const hasDiscoveryCue = DISCOVERY_CUE_REGEX.test(goal) || ["research", "marketing", "roadmap"].includes(intent);
  const complexityCueCount = countRegexMatches(goal, COMPLEXITY_CUES_REGEX);
  const riskCueCount = countRegexMatches(goal, RISK_CUES_REGEX);
  const ambiguous = resolveAmbiguity(goal, intent, hasActionVerb, hasDeliverableCue, hasDiscoveryCue);
  const confidence = resolveConfidence(intent, hasActionVerb, hasDeliverableCue, hasDiscoveryCue, ambiguous);
  const budgetClass = resolveBudgetClass(complexityCueCount, riskCueCount, goal.length);
  const approvalBoundaries = detectApprovalBoundaries(goal);
  const reasons: string[] = [
    `Detected intent '${intent}'.`,
    `Resolved confidence '${confidence}'.`,
    `Assigned budget class '${budgetClass}'.`
  ];

  if (approvalBoundaries.length > 0) {
    reasons.push(`Detected approval boundaries: ${approvalBoundaries.join(", ")}.`);
  }

  if (ambiguous) {
    return {
      status: "unsupported",
      goal,
      intent,
      confidence,
      budgetClass,
      laneCount: 0,
      requiresApproval: approvalBoundaries.length > 0,
      approvalBoundaries,
      recommendedRoles: Object.freeze([]),
      reasons: dedupeStrings(reasons.concat("Goal is too ambiguous for safe autonomous planning.")),
      remediation: Object.freeze([
        "State one concrete deliverable (for example: code change, review packet, or validation outcome).",
        "State at least one domain signal (frontend, backend, roadmap, design, marketing, or research).",
        "State a safety boundary when relevant (merge, release, destructive, or security-sensitive)."
      ])
    };
  }

  const recommendedRoles = buildRoleRecommendations({
    intent,
    requestedByRole,
    confidence,
    budgetClass,
    availableRoles,
    maxRoles
  });
  const laneCount = resolveLaneCount(recommendedRoles.length, complexityCueCount, maxRoles);

  return {
    status: "supported",
    goal,
    intent,
    confidence,
    budgetClass,
    laneCount,
    requiresApproval: approvalBoundaries.length > 0,
    approvalBoundaries,
    recommendedRoles,
    reasons: dedupeStrings(reasons),
    remediation: Object.freeze([])
  };
};
