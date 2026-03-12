import { describe, expect, it } from "vitest";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

describe("work-unit", () => {
  it("normalizes shortcut-backed intake into the canonical work-unit shape", () => {
    const workUnit = normalizeWorkUnit({
      objective: "Normalize Supervisor intake for ticketed work",
      constraints: ["safe-route-only", "safe-route-only", "base branch must be main"],
      acceptanceCriteria: [
        "Supervisor can create WorkUnits from Shortcut inputs",
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
        kind: "shortcut-story",
        id: 342,
        title: "Supervisor Intake: Ticketed + Ad-hoc Work Units",
        url: "https://app.shortcut.com/tuinstradev/story/342",
        metadata: {
          epicId: 323,
          workflowStateId: 500000008,
          ownerIds: ["user-1"]
        }
      }
    });

    expect(workUnit).toEqual({
      objective: "Normalize Supervisor intake for ticketed work",
      constraints: ["safe-route-only", "base branch must be main"],
      acceptanceCriteria: [
        "Supervisor can create WorkUnits from Shortcut inputs",
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
        kind: "shortcut-story",
        title: "Supervisor Intake: Ticketed + Ad-hoc Work Units",
        reference: "sc-342",
        url: "https://app.shortcut.com/tuinstradev/story/342",
        metadata: {
          shortcutId: 342,
          epicId: 323,
          workflowStateId: 500000008,
          ownerIds: ["user-1"]
        }
      }
    });
  });

  it("supports ad-hoc intake without requiring ticket metadata", () => {
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

  it("falls back to the source title when a shortcut objective is omitted", () => {
    const workUnit = normalizeWorkUnit({
      source: {
        kind: "shortcut-epic",
        id: 323,
        title: "OpenCode Orchestration Workflows"
      }
    });

    expect(workUnit.objective).toBe("OpenCode Orchestration Workflows");
    expect(workUnit.source.reference).toBe("shortcut-epic:323");
    expect(workUnit.source.metadata).toEqual({ shortcutId: 323 });
  });
});
