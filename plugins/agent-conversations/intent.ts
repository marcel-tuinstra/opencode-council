import {
  INTENT_KEYWORDS,
  INTENT_ROLE_WEIGHTS,
  TURN_COUNTS
} from "./constants";
import type { Intent, Role } from "./types";

export const detectIntent = (text: string): Intent => {
  const scores: Record<Intent, number> = {
    backend: 0,
    design: 0,
    marketing: 0,
    roadmap: 0,
    research: 0,
    mixed: 0
  };

  for (const intent of Object.keys(INTENT_KEYWORDS) as Intent[]) {
    if (intent === "mixed") {
      continue;
    }
    for (const regex of INTENT_KEYWORDS[intent]) {
      if (regex.test(text)) {
        scores[intent] += 1;
      }
    }
  }

  let best: Intent = "mixed";
  let bestScore = 0;
  for (const intent of ["backend", "design", "marketing", "roadmap", "research"] as Intent[]) {
    if (scores[intent] > bestScore) {
      best = intent;
      bestScore = scores[intent];
    }
  }

  return bestScore > 0 ? best : "mixed";
};

const getTotalTurns = (roles: Role[], intent: Intent): number => {
  if (roles.length <= 1) {
    return 0;
  }

  const roleCount = roles.length;
  const intentConfig = TURN_COUNTS[intent as keyof typeof TURN_COUNTS] ?? TURN_COUNTS.default;
  const defaultConfig = TURN_COUNTS.default;

  if (roleCount in intentConfig) {
    return intentConfig[roleCount as keyof typeof intentConfig] as number;
  }
  if (roleCount in defaultConfig) {
    return defaultConfig[roleCount as keyof typeof defaultConfig] as number;
  }

  return (intentConfig as { max?: number }).max ?? defaultConfig.max;
};

const emptyTargets = (): Record<Role, number> => {
  return {
    CTO: 0,
    DEV: 0,
    PO: 0,
    PM: 0,
    CEO: 0,
    MARKETING: 0,
    RESEARCH: 0
  };
};

export const buildTurnTargets = (roles: Role[], sourceText: string): Record<Role, number> => {
  const targets = emptyTargets();

  if (roles.length <= 1) {
    return targets;
  }

  const intent = detectIntent(sourceText);
  const totalTurns = getTotalTurns(roles, intent);
  const weights = INTENT_ROLE_WEIGHTS[intent];
  const lead = roles[0];

  const mins = new Map<Role, number>();
  for (const role of roles) {
    const weight = weights[role];
    if (role === lead) {
      mins.set(role, 2);
      continue;
    }
    mins.set(role, weight > 0 ? 1 : 0);
  }

  let minSum = 0;
  for (const role of roles) {
    minSum += mins.get(role) ?? 0;
  }

  if (minSum > totalTurns) {
    for (let i = roles.length - 1; i >= 0 && minSum > totalTurns; i -= 1) {
      const role = roles[i];
      if (role === lead) {
        continue;
      }
      const current = mins.get(role) ?? 0;
      if (current > 0) {
        mins.set(role, current - 1);
        minSum -= 1;
      }
    }
  }

  for (const role of roles) {
    targets[role] = mins.get(role) ?? 0;
  }

  const remaining = totalTurns - minSum;
  if (remaining <= 0) {
    return targets;
  }

  const effectiveWeights = new Map<Role, number>();
  let weightSum = 0;
  for (const role of roles) {
    const weight = Math.max(0, weights[role] + (role === lead ? 1 : 0));
    effectiveWeights.set(role, weight);
    weightSum += weight;
  }

  if (weightSum <= 0) {
    targets[lead] += remaining;
    return targets;
  }

  const fractions: Array<{ role: Role; fraction: number }> = [];
  let assigned = 0;
  for (const role of roles) {
    const exact = (remaining * (effectiveWeights.get(role) ?? 0)) / weightSum;
    const whole = Math.floor(exact);
    targets[role] += whole;
    assigned += whole;
    fractions.push({ role, fraction: exact - whole });
  }

  fractions.sort((a, b) => b.fraction - a.fraction);
  let extra = remaining - assigned;
  let index = 0;
  while (extra > 0 && fractions.length > 0) {
    const role = fractions[index % fractions.length].role;
    targets[role] += 1;
    extra -= 1;
    index += 1;
  }

  return targets;
};
