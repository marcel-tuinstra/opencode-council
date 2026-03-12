import { describe, expect, it } from "vitest";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("work-unit", () => {
  it("normalizes tracker-backed intake into the canonical work-unit shape", () => {
    // Arrange

    // Act
    const workUnit = normalizeWorkUnit({
      objective: "Normalize Supervisor intake for ticketed work",
      constraints: ["safe-route-only", "safe-route-only", "base branch must be main"],
      acceptanceCriteria: [
        "Supervisor can create WorkUnits from tracker-backed inputs",
        "Canonical schema preserves planning fields"
      ],
      dependencies: [
        {
          description: "Policy defaults are already defined",
          kind: "document",
          reference: "POLICY_PROFILES.md"
        }
      ],
      riskTags: ["workflow", "workflow", "reliability"],
      evidenceLinks: [
        {
          label: "Story",
          href: "https://app.shortcut.com/tuinstradev/story/342",
          kind: "ticket"
        }
      ],
      source: {
        kind: "tracker",
        tracker: "shortcut",
        entityType: "story",
        id: 342,
        title: "Supervisor Intake: Ticketed + Ad-hoc Work Units",
        reference: "SC-342",
        url: "https://app.shortcut.com/tuinstradev/story/342",
        metadata: {
          epicId: 323,
          workflowStateId: 500000008,
          ownerIds: ["user-1"]
        }
      }
    });

    // Assert
    expect(workUnit).toEqual({
      objective: "Normalize Supervisor intake for ticketed work",
      constraints: ["safe-route-only", "base branch must be main"],
      acceptanceCriteria: [
        "Supervisor can create WorkUnits from tracker-backed inputs",
        "Canonical schema preserves planning fields"
      ],
      dependencies: [
        {
          description: "Policy defaults are already defined",
          kind: "document",
          reference: "POLICY_PROFILES.md"
        }
      ],
      riskTags: ["workflow", "reliability"],
      evidenceLinks: [
        {
          label: "Story",
          href: "https://app.shortcut.com/tuinstradev/story/342",
          kind: "ticket"
        }
      ],
      source: {
        kind: "tracker",
        title: "Supervisor Intake: Ticketed + Ad-hoc Work Units",
        reference: "SC-342",
        url: "https://app.shortcut.com/tuinstradev/story/342",
        metadata: {
          tracker: "shortcut",
          trackerEntityType: "story",
          trackerId: 342,
          epicId: 323,
          workflowStateId: 500000008,
          ownerIds: ["user-1"]
        },
        tracker: "shortcut",
        trackerEntityType: "story"
      }
    });
  });

  it("supports ad-hoc intake without requiring ticket metadata", () => {
    // Arrange

    // Act
    const workUnit = normalizeWorkUnit({
      objective: "Draft a rollout checklist from the pasted prompt",
      acceptanceCriteria: ["Checklist covers launch, rollback, and owner handoff"],
      source: {
        kind: "ad-hoc",
        title: "Prompt-defined rollout checklist",
        reference: "prompt:session-12",
        metadata: {
          capturedFrom: "cli-prompt"
        }
      }
    });

    // Assert
    expect(workUnit).toEqual({
      objective: "Draft a rollout checklist from the pasted prompt",
      constraints: [],
      acceptanceCriteria: ["Checklist covers launch, rollback, and owner handoff"],
      dependencies: [],
      riskTags: [],
      evidenceLinks: [],
      source: {
        kind: "ad-hoc",
        title: "Prompt-defined rollout checklist",
        reference: "prompt:session-12",
        url: undefined,
        metadata: {
          capturedFrom: "cli-prompt"
        }
      }
    });
  });

  it("falls back to the source title when a tracker-backed objective is omitted", () => {
    // Arrange

    // Act
    const workUnit = normalizeWorkUnit({
      source: {
        kind: "tracker",
        tracker: "jira",
        entityType: "epic",
        id: 323,
        title: "OpenCode Orchestration Workflows"
      }
    });

    // Assert
    expect(workUnit.objective).toBe("OpenCode Orchestration Workflows");
    expect(workUnit.source.reference).toBe("jira:epic:323");
    expect(workUnit.source.metadata).toEqual({
      tracker: "jira",
      trackerEntityType: "epic",
      trackerId: 323
    });
    expect(workUnit.source.tracker).toBe("jira");
    expect(workUnit.source.trackerEntityType).toBe("epic");
  });
});
