import { describe, expect, it } from "vitest";
import {
  appendSupervisorDecisionNotes,
  stripControlLeakage
} from "../plugins/orchestration-workflows/output";
import { buildTurnTargets } from "../plugins/orchestration-workflows/intent";
import type { Role } from "../plugins/orchestration-workflows/types";

/**
 * Acceptance tests for the remaining delegated task-launch gap.
 *
 * These intentionally describe the desired visible transcript behavior for
 * agent-led delegation in the CLI task/subagent flow. They should fail until
 * the runtime/task transcript layer preserves delegated launch provenance and
 * strips interactive control leakage.
 */
describe("delegated task launch transcript", () => {
  it("strips interactive CLI control hints from delegated transcripts", () => {
    // Arrange
    const leakedTranscript = [
      "Task CTO orchestrate phases 1 and 2",
      "ctrl+x down view subagents",
      "[1] CTO: Pick up phases 1 and 2 plus UX in one smooth flow.",
      "[2] FE: Build the layout foundation.",
      "[3] BE: Implement the Periode API contract.",
      "[4] CTO: Hold wave 2 until contracts are stable."
    ].join("\n");

    // Act
    const cleaned = stripControlLeakage(leakedTranscript);

    // Assert
    expect(cleaned).toBe([
      "Task CTO orchestrate phases 1 and 2",
      "[1] CTO: Pick up phases 1 and 2 plus UX in one smooth flow.",
      "[2] FE: Build the layout foundation.",
      "[3] BE: Implement the Periode API contract.",
      "[4] CTO: Hold wave 2 until contracts are stable."
    ].join("\n"));
  });

  it("renders delegated launches as CTO-driven instead of generic orchestrator narration", () => {
    // Arrange
    const roles: Role[] = ["CTO", "FE", "BE", "UX"];
    const targets = buildTurnTargets(roles, "pickup phases 1 & 2 + UX in one smooth flow");
    const rawTranscript = [
      "Task CTO orchestrate phases 1 and 2",
      "Ik start nu wave 1 met 3 parallelle agents: layout foundation, Periode API, en magic-link backend.",
      "Task A: Periode API backend",
      "Task B: Magic link backend",
      "Task C: Layout foundation frontend"
    ].join("\n");

    // Act
    const annotated = appendSupervisorDecisionNotes(rawTranscript, roles, targets, "delegated-thread", {
      requestedByUser: ["CTO"],
      delegatedBy: "CTO",
      delegatedRoles: ["FE", "BE", "UX"],
      addedByOrchestrator: []
    });

    // Assert
    expect(annotated).not.toContain("Ik start nu wave 1 met 3 parallelle agents");
    expect(annotated).toContain("delegated launch by CTO");
    expect(annotated).toContain("FE, BE, UX");
  });

  it("preserves delegated wave metadata in the visible transcript", () => {
    // Arrange
    const roles: Role[] = ["CTO", "FE", "BE", "UX"];
    const targets = buildTurnTargets(roles, "pickup phases 1 & 2 + UX in one smooth flow. max parallel agents 6");
    const transcript = [
      "Task CTO orchestrate phases 1 and 2",
      "Task A: Periode API backend",
      "Task B: Magic link backend",
      "Task C: Layout foundation frontend"
    ].join("\n");

    // Act
    const annotated = appendSupervisorDecisionNotes(transcript, roles, targets, "delegated-thread", {
      requestedByUser: ["CTO"],
      delegatedBy: "CTO",
      delegatedRoles: ["FE", "BE", "UX"],
      addedByOrchestrator: [],
      maxParallelAgents: 6
    });

    // Assert
    expect(annotated).toContain("requested by user: CTO");
    expect(annotated).toContain("delegated wave 1 by CTO: FE, BE, UX");
    expect(annotated).toContain("max parallel agents: 6");
  });
});
