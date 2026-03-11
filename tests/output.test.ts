import { describe, expect, it } from "vitest";
import {
  appendMcpSuggestion,
  appendMcpWarnings,
  appendMissingProviderNotice,
  normalizeThreadOutput
} from "../plugins/agent-conversations/output";
import type { Role } from "../plugins/agent-conversations/types";

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
    const raw = [
      "DEV: investigate traces",
      "CTO: define hypothesis",
      "CTO: choose mitigation",
      "CTO: extra line"
    ].join("\n");

    const normalized = normalizeThreadOutput(raw, ["CTO", "DEV"], targets);
    expect(normalized).toBe(
      "[1] CTO: define hypothesis\n\n[2] DEV: investigate traces\n\n[3] CTO: choose mitigation"
    );
  });

  it("returns original text when no valid role lines exist", () => {
    const text = "plain answer without role labels";
    expect(normalizeThreadOutput(text, ["CTO", "DEV"], targets)).toBe(text);
  });

  it("appends /mcp suggestion only when missing", () => {
    const text = "Final recommendation.";
    const withSuggestion = appendMcpSuggestion(text, "CTO", false);
    expect(withSuggestion).toContain("/mcp");

    const already = appendMcpSuggestion("Use /mcp first.", "CTO", false);
    expect(already).toBe("Use /mcp first.");
  });

  it("adds missing provider notice as next numbered turn", () => {
    const text = "[1] CTO: First pass";
    const updated = appendMissingProviderNotice(text, "CTO", true, ["github"]);
    expect(updated).toContain("[2] CTO: Need at least one MCP check for: github before final recommendation.");
  });

  it("appends MCP warning block", () => {
    const updated = appendMcpWarnings("done", ["blocked one", "blocked two"]);
    expect(updated).toContain("[MCP] blocked one");
    expect(updated).toContain("[MCP] blocked two");
  });
});
