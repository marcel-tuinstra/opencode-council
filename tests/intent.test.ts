import { describe, expect, it } from "vitest";
import { buildTurnTargets, detectIntent, shouldUseHeartbeat } from "../plugins/orchestration-workflows/intent";
import type { Role } from "../plugins/orchestration-workflows/types";

const sumTurns = (targets: Record<Role, number>) => {
  return Object.values(targets).reduce((sum, value) => sum + value, 0);
};

describe("intent", () => {
  it("classifies backend intent", () => {
    expect(detectIntent("Investigate API latency and p95 regressions")).toBe("backend");
  });

  it("falls back to mixed when no keywords match", () => {
    expect(detectIntent("Talk about team vibes and coordination")).toBe("mixed");
  });

  it("returns zero turns for single role", () => {
    const targets = buildTurnTargets(["CTO"], "Investigate API latency");
    expect(sumTurns(targets)).toBe(0);
  });

  it("allocates backend turns with stronger CTO/DEV share", () => {
    const targets = buildTurnTargets(["CTO", "DEV", "PM"], "API latency regression and backend performance");
    expect(sumTurns(targets)).toBe(10);
    expect(targets.CTO).toBeGreaterThanOrEqual(targets.PM);
    expect(targets.DEV).toBeGreaterThanOrEqual(targets.PM);
  });

  it("uses max turn fallback for larger role groups", () => {
    const targets = buildTurnTargets(
      ["CTO", "DEV", "PO", "PM", "CEO", "MARKETING"],
      "General planning discussion"
    );
    expect(sumTurns(targets)).toBe(14);
  });

  it("enables heartbeat for 3 or more roles", () => {
    expect(shouldUseHeartbeat(["CTO", "DEV"])).toBe(false);
    expect(shouldUseHeartbeat(["CTO", "DEV", "PM"])).toBe(true);
  });
});
