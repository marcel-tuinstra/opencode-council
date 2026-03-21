import type { Intent } from "./types";

export type BudgetProfileName = "conservative" | "standard" | "extended" | "unlimited";

export type BudgetRuntimeConfig = {
  softRunTokens: number;
  hardRunTokens: number;
  softStepTokens: number;
  hardStepTokens: number;
  truncateAtTokens: number;
  costPer1kTokensUsd: number;
  stepExecutionTokenCost: number;
};

export type BudgetGovernanceConfig = {
  warningThresholdPercents: readonly number[];
  escalationThresholdPercent: number;
  hardStopEnabled: boolean;
  hardStopThresholdPercent: number;
};

export type CompactionConfig = {
  triggerTokens: number;
  targetTokens: number;
  retainRecentLines: number;
};

export type BudgetProfilePreset = {
  name: BudgetProfileName;
  description: string;
  budget: {
    runtime: BudgetRuntimeConfig;
    governance: BudgetGovernanceConfig;
  };
  compaction: Record<string, CompactionConfig>;
};

export const VALID_BUDGET_PROFILE_NAMES: readonly BudgetProfileName[] = [
  "conservative",
  "standard",
  "extended",
  "unlimited"
] as const;

export const BUDGET_PROFILES: Record<BudgetProfileName, BudgetProfilePreset> = {
  conservative: {
    name: "conservative",
    description: "Tight budget matching the v1-safe supervisor defaults. Suitable for small, risk-sensitive repositories.",
    budget: {
      runtime: {
        softRunTokens: 6400,
        hardRunTokens: 8400,
        softStepTokens: 2800,
        hardStepTokens: 4000,
        truncateAtTokens: 1400,
        costPer1kTokensUsd: 0.002,
        stepExecutionTokenCost: 120
      },
      governance: {
        warningThresholdPercents: [80, 100, 120],
        escalationThresholdPercent: 120,
        hardStopEnabled: false,
        hardStopThresholdPercent: 131.25
      }
    },
    compaction: {
      frontend: { triggerTokens: 720, targetTokens: 430, retainRecentLines: 3 },
      backend: { triggerTokens: 700, targetTokens: 420, retainRecentLines: 3 },
      design: { triggerTokens: 760, targetTokens: 460, retainRecentLines: 3 },
      marketing: { triggerTokens: 640, targetTokens: 380, retainRecentLines: 2 },
      roadmap: { triggerTokens: 780, targetTokens: 460, retainRecentLines: 3 },
      research: { triggerTokens: 760, targetTokens: 440, retainRecentLines: 3 },
      mixed: { triggerTokens: 720, targetTokens: 430, retainRecentLines: 3 }
    }
  },
  standard: {
    name: "standard",
    description: "Balanced budget with 2x runtime headroom over conservative. Suitable for medium-sized repositories with moderate risk.",
    budget: {
      runtime: {
        softRunTokens: 12800,
        hardRunTokens: 16800,
        softStepTokens: 5600,
        hardStepTokens: 8000,
        truncateAtTokens: 2800,
        costPer1kTokensUsd: 0.002,
        stepExecutionTokenCost: 120
      },
      governance: {
        warningThresholdPercents: [75, 90, 110],
        escalationThresholdPercent: 110,
        hardStopEnabled: false,
        hardStopThresholdPercent: 130
      }
    },
    compaction: {
      frontend: { triggerTokens: 1440, targetTokens: 860, retainRecentLines: 5 },
      backend: { triggerTokens: 1400, targetTokens: 840, retainRecentLines: 5 },
      design: { triggerTokens: 1520, targetTokens: 920, retainRecentLines: 5 },
      marketing: { triggerTokens: 1280, targetTokens: 760, retainRecentLines: 4 },
      roadmap: { triggerTokens: 1560, targetTokens: 920, retainRecentLines: 5 },
      research: { triggerTokens: 1520, targetTokens: 880, retainRecentLines: 5 },
      mixed: { triggerTokens: 1440, targetTokens: 860, retainRecentLines: 5 }
    }
  },
  extended: {
    name: "extended",
    description: "Generous budget with 4x runtime headroom over conservative. Suitable for large, mature repositories with complex workflows.",
    budget: {
      runtime: {
        softRunTokens: 25600,
        hardRunTokens: 33600,
        softStepTokens: 11200,
        hardStepTokens: 16000,
        truncateAtTokens: 5600,
        costPer1kTokensUsd: 0.002,
        stepExecutionTokenCost: 120
      },
      governance: {
        warningThresholdPercents: [70, 85, 100],
        escalationThresholdPercent: 100,
        hardStopEnabled: false,
        hardStopThresholdPercent: 125
      }
    },
    compaction: {
      frontend: { triggerTokens: 2880, targetTokens: 1720, retainRecentLines: 8 },
      backend: { triggerTokens: 2800, targetTokens: 1680, retainRecentLines: 8 },
      design: { triggerTokens: 3040, targetTokens: 1840, retainRecentLines: 8 },
      marketing: { triggerTokens: 2560, targetTokens: 1520, retainRecentLines: 6 },
      roadmap: { triggerTokens: 3120, targetTokens: 1840, retainRecentLines: 8 },
      research: { triggerTokens: 3040, targetTokens: 1760, retainRecentLines: 8 },
      mixed: { triggerTokens: 2880, targetTokens: 1720, retainRecentLines: 8 }
    }
  },
  unlimited: {
    name: "unlimited",
    description: "Maximum budget with minimal constraints. Suitable for exploratory or unbounded sessions where cost is not a primary concern.",
    budget: {
      runtime: {
        softRunTokens: 100000,
        hardRunTokens: 200000,
        softStepTokens: 50000,
        hardStepTokens: 100000,
        truncateAtTokens: 25000,
        costPer1kTokensUsd: 0.002,
        stepExecutionTokenCost: 120
      },
      governance: {
        warningThresholdPercents: [90],
        escalationThresholdPercent: 150,
        hardStopEnabled: false,
        hardStopThresholdPercent: 200
      }
    },
    compaction: {
      frontend: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 15 },
      backend: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 15 },
      design: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 15 },
      marketing: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 12 },
      roadmap: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 15 },
      research: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 15 },
      mixed: { triggerTokens: 50000, targetTokens: 30000, retainRecentLines: 15 }
    }
  }
};

export const resolveBudgetProfile = (name: string): BudgetProfilePreset | null => {
  if ((VALID_BUDGET_PROFILE_NAMES as readonly string[]).includes(name)) {
    return BUDGET_PROFILES[name as BudgetProfileName];
  }
  return null;
};

export const getDefaultBudgetProfileName = (): BudgetProfileName => {
  return "standard";
};

export const getBudgetProfileFromEnv = (): BudgetProfileName | null => {
  const envValue = process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE;
  if (envValue === undefined || envValue === "") {
    return null;
  }

  const normalized = envValue.trim().toLowerCase();
  if ((VALID_BUDGET_PROFILE_NAMES as readonly string[]).includes(normalized)) {
    return normalized as BudgetProfileName;
  }

  return null;
};
