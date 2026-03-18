import { describe, expect, it } from "vitest";
import {
  appendMcpSuggestion,
  appendMcpWarnings,
  appendMissingProviderNotice,
  appendSupervisorDecisionNotes,
  applyBudgetAction,
  extractDelegatedRoles,
  normalizeThreadOutput,
  stripControlLeakage
} from "../plugins/orchestration-workflows/output";
import type { Role } from "../plugins/orchestration-workflows/types";

const targets: Record<Role, number> = {
  CTO: 2,
  DEV: 1,
  FE: 0,
  BE: 0,
  UX: 0,
  PO: 0,
  PM: 0,
  CEO: 0,
  MARKETING: 0,
  RESEARCH: 0
};

describe("output", () => {
  it("normalizes thread format and enforces role quotas", () => {
    // Arrange
    const raw = [
      "DEV: investigate traces",
      "CTO: define hypothesis",
      "CTO: choose mitigation",
      "CTO: extra line"
    ].join("\n");

    // Act
    const normalized = normalizeThreadOutput(raw, ["CTO", "DEV"], targets);

    // Assert
    expect(normalized).toBe(
      "[1] CTO: define hypothesis\n\n[2] DEV: investigate traces\n\n[3] CTO: choose mitigation"
    );
  });

  it("returns original text when no valid role lines exist", () => {
    // Arrange
    const text = "plain answer without role labels";

    // Act
    const normalized = normalizeThreadOutput(text, ["CTO", "DEV"], targets);

    // Assert
    expect(normalized).toBe(text);
  });

  it("appends /mcp suggestion only when missing", () => {
    // Arrange
    const text = "Final recommendation.";

    // Act
    const withSuggestion = appendMcpSuggestion(text, "CTO", false);
    const already = appendMcpSuggestion("Use /mcp first.", "CTO", false);

    // Assert
    expect(withSuggestion).toContain("/mcp");
    expect(already).toBe("Use /mcp first.");
  });

  it("adds missing provider notice as next numbered turn", () => {
    // Arrange
    const text = "[1] CTO: First pass";

    // Act
    const updated = appendMissingProviderNotice(text, "CTO", true, ["github"]);

    // Assert
    expect(updated).toContain("[2] CTO: [Supervisor] blocked.missing-mcp-provider: Blocked the final recommendation until at least one MCP check covers: github.");
  });

  it("appends MCP warning block", () => {
    // Arrange

    // Act
    const updated = appendMcpWarnings("done", ["blocked one", "blocked two"]);

    // Assert
    expect(updated).toContain("[MCP] blocked.mcp-access");
    expect(updated).toContain("blocked one");
    expect(updated).toContain("blocked two");
  });

  it("appends compact supervisor decision notes for threaded routes", () => {
    // Arrange
    const text = "[1] CTO: Investigate\n\n[2] DEV: Validate";

    // Act
    const updated = appendSupervisorDecisionNotes(text, ["CTO", "DEV"], targets, "multi-role-thread");

    // Assert
    expect(updated).toContain("route.multi-role-thread");
    expect(updated).toContain("assignment.weighted-turns");
    expect(updated).toContain("CTO:2 DEV:1");
  });

  it("omits orchestrator-additions line when addedByOrchestrator is empty", () => {
    // Arrange
    const text = "[1] CTO: Investigate\n\n[2] DEV: Validate";

    // Act
    const updated = appendSupervisorDecisionNotes(text, ["CTO", "DEV"], targets, "delegated-thread", {
      requestedByUser: ["CTO"],
      delegatedBy: "CTO",
      delegatedRoles: ["DEV"],
      addedByOrchestrator: []
    });

    // Assert
    expect(updated).toMatch(/delegated.*by CTO/);
    expect(updated).not.toContain("provenance.orchestrator-additions");
  });

  it("includes requested-by-user provenance when passed to multi-role-thread", () => {
    // Arrange
    const text = "[1] CTO: Investigate\n\n[2] DEV: Validate";

    // Act
    const updated = appendSupervisorDecisionNotes(text, ["CTO", "DEV"], targets, "multi-role-thread", {
      requestedByUser: ["CTO", "DEV"]
    });

    // Assert
    expect(updated).toContain("route.multi-role-thread");
    expect(updated).toContain("requested by user: CTO, DEV");
  });

  it("extracts delegated roles and removes marker", () => {
    // Arrange
    const text = "<<DELEGATE:PM,RESEARCH,PM>>\n[1] CEO: Opening";

    // Act
    const delegated = extractDelegatedRoles(text, "CEO");

    // Assert
    expect(delegated.roles).toEqual(["CEO", "PM", "RESEARCH"]);
    expect(delegated.text).not.toContain("<<DELEGATE");
  });

  it("caps delegation to three additional roles", () => {
    // Arrange
    const text = "<<DELEGATE:PM,PO,RESEARCH,CTO,DEV>>";

    // Act
    const delegated = extractDelegatedRoles(text, "CEO");

    // Assert
    expect(delegated.roles).toEqual(["CEO", "PM", "PO", "RESEARCH"]);
  });

  it("strips leaked control lines and system reminder blocks", () => {
    // Arrange
    const text = [
      "Format: plain prose, no role prefix, no markdown.",
      "Delegation (optional): if needed, emit <<DELEGATE:ROLE1,ROLE2>> then switch to [n] ROLE: message lines.",
      "<system-reminder>",
      "internal note",
      "</system-reminder>",
      "Real answer line"
    ].join("\n");

    // Act
    const cleaned = stripControlLeakage(text);

    // Assert
    expect(cleaned).toBe("Real answer line");
  });

  it("strips repeated enforcement blocks and task invocation leakage", () => {
    // Arrange
    const text = [
      "Format: [n] ROLE: message | Start with CTO: | Plan: CTO:2 DEV:1 PM:1",
      "Heartbeat: Phase 1 Frame, Phase 2 Challenge (react to another role), Phase 3 Synthesize by lead.",
      "MCP: disabled.",
      "Suggest /mcp if data may be stale.",
      "No markdown. Plain lines only.",
      "Use the above message and context to generate a prompt and call the task tool with subagent: cto",
      "Use the above message and context to generate a prompt and call the task tool with subagent: dev",
      "<system-reminder>",
      "# Plan Mode - System Reminder",
      "CRITICAL: Plan mode ACTIVE",
      "</system-reminder>",
      "[1] CTO: Start with query timing and release correlation.",
      "[2] DEV: Check traces and recent deploy diff."
    ].join("\n");

    // Act
    const cleaned = stripControlLeakage(text);

    // Assert
    expect(cleaned).toBe(
      "[1] CTO: Start with query timing and release correlation.\n[2] DEV: Check traces and recent deploy diff."
    );
  });

  it("applies compact and halt budget actions with reason", () => {
    // Arrange

    // Act
    const compacted = applyBudgetAction("A\nB\nC", "compact", "compact triggered at soft budget on summarize", 200);
    const halted = applyBudgetAction("anything", "halt", "hard budget exceeded on summarize", 200);

    // Assert
    expect(compacted).toContain("budget.output-compact");
    expect(halted).toContain("budget.output-halt");
    expect(halted).toContain("hard budget exceeded");
  });
});
