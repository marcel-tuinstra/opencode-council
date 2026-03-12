import { describe, expect, it } from "vitest";
import { buildSystemInstruction, enforceUserContract } from "../plugins/orchestration-workflows/contracts";
import type { Role } from "../plugins/orchestration-workflows/types";

const targets: Record<Role, number> = {
  CTO: 2,
  DEV: 1,
  PO: 0,
  PM: 1,
  CEO: 0,
  MARKETING: 0,
  RESEARCH: 0
};

describe("contracts", () => {
  it("adds heartbeat phases in system instruction for 3+ role mode", () => {
    // Arrange

    // Act
    const instruction = buildSystemInstruction(["CTO", "DEV", "PM"], targets, true, [], false);

    // Assert
    expect(instruction).toContain("Heartbeat phases:");
    expect(instruction).toContain("Phase 2 (Challenge)");
  });

  it("omits heartbeat phases when heartbeat is disabled", () => {
    // Arrange

    // Act
    const instruction = buildSystemInstruction(["CTO", "DEV"], targets, false, [], false);

    // Assert
    expect(instruction).not.toContain("Heartbeat phases:");
  });

  it("injects heartbeat note in user contract", () => {
    // Arrange

    // Act
    const text = enforceUserContract("Discuss tradeoffs", ["CTO", "DEV", "PM"], targets, true, [], false);

    // Assert
    expect(text).toContain("Heartbeat: Phase 1 Frame");
  });

  it("includes delegation protocol for single-role mode", () => {
    // Arrange

    // Act
    const instruction = buildSystemInstruction(["CEO"], targets, false, [], false);
    const userText = enforceUserContract("Should we prioritize this?", ["CEO"], targets, false, [], false);

    // Assert
    expect(instruction).toContain("<<DELEGATE:ROLE1,ROLE2>>");
    expect(userText).toBe("Should we prioritize this?");
  });
});
