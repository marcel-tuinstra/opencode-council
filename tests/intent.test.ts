import { describe, expect, it } from "vitest";
import { buildTurnTargets, detectIntent, shouldUseHeartbeat } from "../plugins/orchestration-workflows/intent";
import type { Role } from "../plugins/orchestration-workflows/types";

const sumTurns = (targets: Record<Role, number>) => {
  return Object.values(targets).reduce((sum, value) => sum + value, 0);
};

describe("intent", () => {
  it("classifies backend intent", () => {
    // Arrange
    const prompt = "Investigate API latency and p95 regressions";

    // Act
    const intent = detectIntent(prompt);

    // Assert
    expect(intent).toBe("backend");
  });

  it("classifies frontend intent", () => {
    // Arrange
    const prompt = "Build a responsive React component with improved layout and interaction states";

    // Act
    const intent = detectIntent(prompt);

    // Assert
    expect(intent).toBe("frontend");
  });

  it("falls back to mixed when no keywords match", () => {
    // Arrange
    const prompt = "Talk about team vibes and coordination";

    // Act
    const intent = detectIntent(prompt);

    // Assert
    expect(intent).toBe("mixed");
  });

  it("returns zero turns for single role", () => {
    // Arrange

    // Act
    const targets = buildTurnTargets(["CTO"], "Investigate API latency");

    // Assert
    expect(sumTurns(targets)).toBe(0);
  });

  it("allocates backend turns with stronger CTO/BE share", () => {
    // Arrange

    // Act
    const targets = buildTurnTargets(["CTO", "BE", "PM"], "API latency regression and backend performance");

    // Assert
    expect(sumTurns(targets)).toBe(10);
    expect(targets.CTO).toBeGreaterThanOrEqual(targets.PM);
    expect(targets.BE).toBeGreaterThanOrEqual(targets.PM);
  });

  it("uses max turn fallback for larger role groups", () => {
    // Arrange

    // Act
    const targets = buildTurnTargets(
      ["CTO", "DEV", "PO", "PM", "CEO", "MARKETING"],
      "General planning discussion"
    );

    // Assert
    expect(sumTurns(targets)).toBe(14);
  });

  it("enables heartbeat for 3 or more roles", () => {
    // Arrange
    const smallRoleSet = ["CTO", "DEV"] as const;
    const largeRoleSet = ["CTO", "DEV", "PM"] as const;

    // Act
    const smallResult = shouldUseHeartbeat([...smallRoleSet]);
    const largeResult = shouldUseHeartbeat([...largeRoleSet]);

    // Assert
    expect(smallResult).toBe(false);
    expect(largeResult).toBe(true);
  });
});
