import { describe, expect, it } from "vitest";
import { createAdHocRunHistoryRecord, linkAdHocRunArtifact } from "../plugins/orchestration-workflows/ad-hoc-run-history";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("ad-hoc-run-history", () => {
  it("creates an immutable ad-hoc run record from a normalized work unit", () => {
    // Arrange
    const workUnit = normalizeWorkUnit({
      objective: "Capture durable audit history for ad-hoc runs",
      evidenceLinks: [
        {
          label: "Runbook",
          href: "https://example.com/runbook",
          kind: "runbook"
        },
        {
          label: "Runbook",
          href: "https://example.com/runbook",
          kind: "runbook"
        }
      ],
      source: {
        kind: "ad-hoc",
        title: "Operator request",
        reference: "prompt:session-99",
        metadata: {
          capturedBy: "cli"
        }
      }
    });

    // Act
    const record = createAdHocRunHistoryRecord({
      workUnitId: "wu-adhoc-17",
      workUnit,
      repo: "github.com/example/platform",
      branch: "sc-345-adhoc-run-history-registry",
      commitSet: ["abc123", "abc123", "def456"],
      operator: "marcel@tuinstra.dev",
      createdAt: "2026-03-12T17:00:00Z",
      relatedArtifacts: [
        {
          label: "Initial notes",
          href: "https://example.com/notes",
          kind: "document"
        }
      ]
    });

    // Assert
    expect(record).toEqual({
      runId: "adhoc:wu-adhoc-17:2026-03-12T17:00:00Z",
      workUnitId: "wu-adhoc-17",
      objective: "Capture durable audit history for ad-hoc runs",
      repo: "github.com/example/platform",
      branch: "sc-345-adhoc-run-history-registry",
      commitSet: ["abc123", "def456"],
      operator: "marcel@tuinstra.dev",
      createdAt: "2026-03-12T17:00:00Z",
      evidenceLinks: [
        {
          label: "Runbook",
          href: "https://example.com/runbook",
          kind: "runbook"
        }
      ],
      relatedArtifacts: [
        {
          label: "Initial notes",
          href: "https://example.com/notes",
          kind: "document"
        }
      ]
    });
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.commitSet)).toBe(true);
    expect(Object.isFrozen(record.evidenceLinks)).toBe(true);
    expect(Object.isFrozen(record.relatedArtifacts)).toBe(true);
  });

  it("returns a new record when linking later review artifacts", () => {
    // Arrange
    const record = createAdHocRunHistoryRecord({
      runId: "adhoc:wu-2:2026-03-12T18:00:00Z",
      workUnitId: "wu-2",
      workUnit: normalizeWorkUnit({
        objective: "Document an operator-only hotfix",
        source: {
          kind: "ad-hoc",
          title: "Hotfix capture",
          metadata: {}
        }
      }),
      repo: "github.com/example/platform",
      branch: "main",
      commitSet: ["789abc"],
      operator: "operator@example.com",
      createdAt: "2026-03-12T18:00:00Z"
    });

    // Act
    const linked = linkAdHocRunArtifact(record, {
      label: "Follow-up PR",
      href: "https://github.com/example/platform/pull/12",
      kind: "pull-request"
    });

    // Assert
    expect(record.relatedArtifacts).toEqual([]);
    expect(linked.relatedArtifacts).toEqual([
      {
        label: "Follow-up PR",
        href: "https://github.com/example/platform/pull/12",
        kind: "pull-request"
      }
    ]);
    expect(linked.runId).toBe(record.runId);
    expect(linked.workUnitId).toBe(record.workUnitId);
    expect(linked.commitSet).toEqual(record.commitSet);
  });
});
