import { describe, expect, it } from "vitest";
import {
  appendMcpSuggestion,
  appendMcpWarnings,
  appendMissingProviderNotice,
  applyBudgetAction,
  extractDelegatedRoles,
  normalizeThreadOutput,
  stripControlLeakage
} from "../plugins/orchestration-workflows/output";
import type { Role } from "../plugins/orchestration-workflows/types";

const targets: Record<Role, number> = {
  CTO: 2,
  DEV: 1,
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
    expect(updated).toContain("[2] CTO: Need at least one MCP check for: github before final recommendation.");
  });

  it("appends MCP warning block", () => {
    // Arrange

    // Act
    const updated = appendMcpWarnings("done", ["blocked one", "blocked two"]);

    // Assert
    expect(updated).toContain("[MCP] blocked one");
    expect(updated).toContain("[MCP] blocked two");
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
    expect(compacted).toContain("[Budget] Compact mode enabled");
    expect(halted).toContain("budget governor");
    expect(halted).toContain("hard budget exceeded");
  });
});
