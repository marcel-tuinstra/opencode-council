import { describe, expect, it } from "vitest";
import { appendCompactionNotice, compactWorkflowContext } from "../plugins/orchestration-workflows/compact";

const longBackendPrompt = [
  "Goal: reduce API latency and restore p95.",
  "Constraint: budget is capped this sprint.",
  "Blocker: incident investigation still open.",
  "Open action: assign owners for tracing and query optimization.",
  "Additional context: repeat this sentence to inflate token footprint for compaction testing."
].join("\n");

describe("compaction", () => {
  it("compacts oversized context while preserving critical slots", () => {
    // Arrange
    const oversized = `${longBackendPrompt}\n${"extra detail ".repeat(500)}`;

    // Act
    const result = compactWorkflowContext(oversized, "backend");

    // Assert
    expect(result.compacted).toBe(true);
    expect(result.text).toContain("Goals:");
    expect(result.text).toContain("Constraints:");
    expect(result.text).toContain("Blockers:");
    expect(result.text).toContain("Open Actions:");
    expect(result.summary).toContain("Compaction applied");
  });

  it("keeps original text when context is under trigger", () => {
    // Arrange

    // Act
    const result = compactWorkflowContext("short prompt", "mixed");

    // Assert
    expect(result.compacted).toBe(false);
    expect(result.text).toBe("short prompt");
  });

  it("appends notice only when provided", () => {
    // Arrange

    // Act
    const untouched = appendCompactionNotice("hello", null);
    const annotated = appendCompactionNotice("hello", "fallback applied");

    // Assert
    expect(untouched).toBe("hello");
    expect(annotated).toContain("[Compaction]");
  });
});
