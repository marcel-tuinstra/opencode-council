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
  it("compacts oversized context while preserving critical slots and recent continuity", () => {
    // Arrange
    const recentContext = [
      "Recent note: keep the rollback checklist visible.",
      "Recent note: wait for the tracing diff before closing the incident.",
      "Recent note: update the owner handoff after validation."
    ].join("\n");
    const oversized = `${longBackendPrompt}\n${"extra detail ".repeat(500)}\n${recentContext}`;

    // Act
    const result = compactWorkflowContext(oversized, "backend");

    // Assert
    expect(result.compacted).toBe(true);
    expect(result.text).toContain("Goals:");
    expect(result.text).toContain("Constraints:");
    expect(result.text).toContain("Blockers:");
    expect(result.text).toContain("Open Actions:");
    expect(result.text).toContain("Continuity:");
    expect(result.text).toContain("Recent note: update the owner handoff after validation.");
    expect(result.summary).toContain("Context condensed for continuity");
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

  it("keeps the full text when compaction would hide recent working context", () => {
    // Arrange
    const oversized = [
      "Goal: restore the checkout flow before the afternoon launch window and keep the approval path stable while support prepares the incident reply and the rollback plan stays ready.",
      "Goal: preserve the manual retry queue details until the payment owner confirms the mitigation copy and support macros stay aligned with the updated customer-facing language.",
      "Goal: document the exact launch hold wording so the release manager can reuse it without re-drafting under pressure and the operations bridge can reference it directly.",
      "Constraint: only the incident channel can approve messaging changes while legal, support, and payments remain on the bridge and the executive summary stays in review until cleared.",
      "Constraint: customer updates must reuse the already-approved incident language and cannot promise retry timing before finance signs off and the queue owner confirms readiness.",
      "Constraint: the launch page banner must stay unchanged until the rollback checklist and owner handoff both clear review and the deployment verification step passes cleanly.",
      "Blocker: payment retries still lack owner confirmation from finance, so support cannot resume the queue yet and the customer-status draft remains on hold until the bridge approves.",
      "Blocker: the customer-status draft is waiting on legal review and cannot be shortened further without losing the approved caveats that protect the retry commitment language.",
      "Blocker: launch approval wording is still under review because the bridge needs one final sign-off from operations and the deployment team has not confirmed the rollback window.",
      "Open action: line up rollback and verification owners before any retries resume for affected customers and ensure the deployment checklist is confirmed by the on-call engineer.",
      "Open action: capture the approved launch hold wording in the handoff so the next operator does not improvise it and the incident channel retains the single-source-of-truth copy.",
      "Open action: keep the customer-status update draft unchanged until legal reviews it and support can publish the final version that includes the approved retry commitment wording.",
      "Open action: wait for the finance sign-off before resuming retries or changing the incident response timing and confirm the payment team has acknowledged the updated queue state.",
      "extra detail ".repeat(600),
      "Recent note: do not lose the latest launch approval wording because the release manager depends on it for the go-or-no-go decision and the bridge will reference it at close.",
      "Recent note: confirm the rollback checklist owners before the bridge closes and make sure the deployment verification step has a named backup who can execute if primary is offline.",
      "Recent note: keep the customer-status update draft unchanged until legal reviews it and support can publish the approved version that includes the exact retry commitment language.",
      "Recent note: verify the retry queue state with the payment team before publishing any customer-facing updates and ensure finance has signed off on the revised timeline estimate.",
      "Recent note: wait for the finance sign-off before resuming retries and confirm the payment owner has acknowledged the updated queue state so support macros remain consistent."
    ].join("\n");

    // Act
    const result = compactWorkflowContext(oversized, "marketing");

    // Assert
    expect(result.compacted).toBe(false);
    expect(result.text).toBe(oversized);
    expect(result.fallbackReason).toContain("fallback.compaction-continuity");
    expect(result.fallbackReason).toContain("latest working context");
  });
});
