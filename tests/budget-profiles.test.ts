import { afterEach, describe, expect, it } from "vitest";
import {
  BUDGET_PROFILES,
  VALID_BUDGET_PROFILE_NAMES,
  getBudgetProfileFromEnv,
  getDefaultBudgetProfileName,
  resolveBudgetProfile
} from "../plugins/orchestration-workflows/budget-profiles";
import type {
  BudgetProfileName,
  BudgetProfilePreset
} from "../plugins/orchestration-workflows/budget-profiles";

const ALL_INTENT_KEYS = ["frontend", "backend", "design", "marketing", "roadmap", "research", "mixed"] as const;

describe("budget profiles", () => {
  afterEach(() => {
    delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE;
  });

  describe("resolveBudgetProfile", () => {
    it("resolves the conservative profile by name", () => {
      const profile = resolveBudgetProfile("conservative");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("conservative");
    });

    it("resolves the standard profile by name", () => {
      const profile = resolveBudgetProfile("standard");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("standard");
    });

    it("resolves the extended profile by name", () => {
      const profile = resolveBudgetProfile("extended");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("extended");
    });

    it("resolves the unlimited profile by name", () => {
      const profile = resolveBudgetProfile("unlimited");
      expect(profile).not.toBeNull();
      expect(profile!.name).toBe("unlimited");
    });

    it("returns null for an unknown profile name", () => {
      const profile = resolveBudgetProfile("turbo");
      expect(profile).toBeNull();
    });

    it("returns null for an empty string", () => {
      const profile = resolveBudgetProfile("");
      expect(profile).toBeNull();
    });
  });

  describe("getDefaultBudgetProfileName", () => {
    it("returns standard as the default profile name", () => {
      expect(getDefaultBudgetProfileName()).toBe("standard");
    });
  });

  describe("getBudgetProfileFromEnv", () => {
    it("reads a valid profile name from the environment variable", () => {
      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE = "extended";
      expect(getBudgetProfileFromEnv()).toBe("extended");
    });

    it("returns null when the environment variable is absent", () => {
      delete process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE;
      expect(getBudgetProfileFromEnv()).toBeNull();
    });

    it("returns null when the environment variable is empty", () => {
      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE = "";
      expect(getBudgetProfileFromEnv()).toBeNull();
    });

    it("returns null for an invalid environment variable value", () => {
      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE = "turbo-mode";
      expect(getBudgetProfileFromEnv()).toBeNull();
    });

    it("normalises case for the environment variable value", () => {
      process.env.ORCHESTRATION_WORKFLOWS_BUDGET_PROFILE = "Conservative";
      expect(getBudgetProfileFromEnv()).toBe("conservative");
    });
  });

  describe("structural invariants", () => {
    for (const profileName of VALID_BUDGET_PROFILE_NAMES) {
      describe(`${profileName} profile`, () => {
        const profile = BUDGET_PROFILES[profileName];

        it("has softRunTokens less than hardRunTokens", () => {
          expect(profile.budget.runtime.softRunTokens).toBeLessThan(
            profile.budget.runtime.hardRunTokens
          );
        });

        it("has softStepTokens less than hardStepTokens", () => {
          expect(profile.budget.runtime.softStepTokens).toBeLessThan(
            profile.budget.runtime.hardStepTokens
          );
        });

        it("has triggerTokens greater than targetTokens for every intent", () => {
          for (const intent of ALL_INTENT_KEYS) {
            const compaction = profile.compaction[intent];
            expect(compaction).toBeDefined();
            expect(compaction.triggerTokens).toBeGreaterThan(compaction.targetTokens);
          }
        });

        it("covers all intent keys in compaction config", () => {
          for (const intent of ALL_INTENT_KEYS) {
            expect(profile.compaction[intent]).toBeDefined();
          }
        });
      });
    }
  });

  describe("conservative matches v1-safe defaults", () => {
    const conservative = BUDGET_PROFILES.conservative;

    it("has matching runtime budget values", () => {
      expect(conservative.budget.runtime.softRunTokens).toBe(6400);
      expect(conservative.budget.runtime.hardRunTokens).toBe(8400);
      expect(conservative.budget.runtime.softStepTokens).toBe(2800);
      expect(conservative.budget.runtime.hardStepTokens).toBe(4000);
      expect(conservative.budget.runtime.truncateAtTokens).toBe(1400);
      expect(conservative.budget.runtime.costPer1kTokensUsd).toBe(0.002);
      expect(conservative.budget.runtime.stepExecutionTokenCost).toBe(120);
    });

    it("has matching governance values", () => {
      expect([...conservative.budget.governance.warningThresholdPercents]).toEqual([80, 100, 120]);
      expect(conservative.budget.governance.escalationThresholdPercent).toBe(120);
      expect(conservative.budget.governance.hardStopEnabled).toBe(false);
      expect(conservative.budget.governance.hardStopThresholdPercent).toBe(131.25);
    });

    it("has matching compaction values for all intents", () => {
      expect(conservative.compaction.frontend).toEqual({ triggerTokens: 720, targetTokens: 430, retainRecentLines: 3 });
      expect(conservative.compaction.backend).toEqual({ triggerTokens: 700, targetTokens: 420, retainRecentLines: 3 });
      expect(conservative.compaction.design).toEqual({ triggerTokens: 760, targetTokens: 460, retainRecentLines: 3 });
      expect(conservative.compaction.marketing).toEqual({ triggerTokens: 640, targetTokens: 380, retainRecentLines: 2 });
      expect(conservative.compaction.roadmap).toEqual({ triggerTokens: 780, targetTokens: 460, retainRecentLines: 3 });
      expect(conservative.compaction.research).toEqual({ triggerTokens: 760, targetTokens: 440, retainRecentLines: 3 });
      expect(conservative.compaction.mixed).toEqual({ triggerTokens: 720, targetTokens: 430, retainRecentLines: 3 });
    });
  });

  describe("scaling relationships", () => {
    const conservative = BUDGET_PROFILES.conservative;
    const standard = BUDGET_PROFILES.standard;
    const extended = BUDGET_PROFILES.extended;

    it("standard has 2x runtime headroom over conservative", () => {
      expect(standard.budget.runtime.softRunTokens).toBe(conservative.budget.runtime.softRunTokens * 2);
      expect(standard.budget.runtime.hardRunTokens).toBe(conservative.budget.runtime.hardRunTokens * 2);
      expect(standard.budget.runtime.softStepTokens).toBe(conservative.budget.runtime.softStepTokens * 2);
      expect(standard.budget.runtime.hardStepTokens).toBe(conservative.budget.runtime.hardStepTokens * 2);
      expect(standard.budget.runtime.truncateAtTokens).toBe(conservative.budget.runtime.truncateAtTokens * 2);
    });

    it("extended has 4x runtime headroom over conservative", () => {
      expect(extended.budget.runtime.softRunTokens).toBe(conservative.budget.runtime.softRunTokens * 4);
      expect(extended.budget.runtime.hardRunTokens).toBe(conservative.budget.runtime.hardRunTokens * 4);
      expect(extended.budget.runtime.softStepTokens).toBe(conservative.budget.runtime.softStepTokens * 4);
      expect(extended.budget.runtime.hardStepTokens).toBe(conservative.budget.runtime.hardStepTokens * 4);
      expect(extended.budget.runtime.truncateAtTokens).toBe(conservative.budget.runtime.truncateAtTokens * 4);
    });
  });

  describe("unlimited profile", () => {
    const unlimited = BUDGET_PROFILES.unlimited;

    it("has compaction triggers at or above 50000 for all intents", () => {
      for (const intent of ALL_INTENT_KEYS) {
        expect(unlimited.compaction[intent].triggerTokens).toBeGreaterThanOrEqual(50000);
      }
    });

    it("has marketing retainRecentLines lower than other intents", () => {
      expect(unlimited.compaction.marketing.retainRecentLines).toBe(12);
      for (const intent of ALL_INTENT_KEYS) {
        if (intent === "marketing") continue;
        expect(unlimited.compaction[intent].retainRecentLines).toBe(15);
      }
    });
  });

  describe("VALID_BUDGET_PROFILE_NAMES", () => {
    it("contains all four profile names in order", () => {
      expect([...VALID_BUDGET_PROFILE_NAMES]).toEqual([
        "conservative",
        "standard",
        "extended",
        "unlimited"
      ]);
    });

    it("matches the keys of BUDGET_PROFILES", () => {
      const profileKeys = Object.keys(BUDGET_PROFILES).sort();
      const validNames = [...VALID_BUDGET_PROFILE_NAMES].sort();
      expect(profileKeys).toEqual(validNames);
    });
  });
});
