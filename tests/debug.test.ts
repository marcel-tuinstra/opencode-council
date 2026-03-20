import { describe, expect, it } from "vitest";
import { buildDiagnosticsEnvelope } from "../plugins/orchestration-workflows/debug";

describe("debug diagnostics envelope", () => {
  it("normalizes correlation ids, reason codes, remediation, and details", () => {
    const envelope = buildDiagnosticsEnvelope("tool.execute.before.blocked", {
      sessionID: "session-123",
      runId: "run-123",
      laneId: "lane-7",
      reasonCode: "blocked.mcp-access",
      remediation: ["Retry after approving the provider."],
      provider: "sentry",
      tool: "sentry_list_issues"
    });

    expect(envelope).toEqual({
      kind: "orchestration-diagnostic",
      event: "tool.execute.before.blocked",
      occurredAt: expect.any(String),
      correlation: {
        sessionId: "session-123",
        runId: "run-123",
        laneId: "lane-7"
      },
      reasonCode: "blocked.mcp-access",
      remediation: ["Retry after approving the provider."],
      details: {
        provider: "sentry",
        tool: "sentry_list_issues"
      }
    });
  });
});
