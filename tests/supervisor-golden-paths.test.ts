import { afterEach, describe, expect, it } from "vitest";
import { evaluateBudgetGovernance, resolveBudgetGovernancePolicy } from "../plugins/orchestration-workflows/budget-governance";
import { evaluateMergePolicy, resolveMergePolicy } from "../plugins/orchestration-workflows/merge-policy";
import {
  appendMcpWarnings,
  appendMissingProviderNotice,
  appendSupervisorDecisionNotes,
  normalizeThreadOutput,
  stripControlLeakage
} from "../plugins/orchestration-workflows/output";
import { assertReviewReadyTransition } from "../plugins/orchestration-workflows/review-ready-packet";
import { resetSessionState, sessionPolicy, systemInjectedForSession } from "../plugins/orchestration-workflows/session";
import { transferLaneTurn, type LaneTurnOwnership } from "../plugins/orchestration-workflows/turn-ownership";
import type { Role, SessionPolicy } from "../plugins/orchestration-workflows/types";
import { planWorkUnitLanes } from "../plugins/orchestration-workflows/lane-plan";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";

const threadTargets: Record<Role, number> = {
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

const createSessionPolicy = (): SessionPolicy => ({
  roles: ["CTO", "DEV"],
  targets: threadTargets,
  heartbeat: true,
  intent: "backend",
  mcpProviders: ["github"],
  mcpHints: ["GitHub MCP"],
  staleSensitive: true,
  allowDeepMcp: false,
  mcpCallCount: 0,
  mcpTouched: {},
  mcpWarnings: []
});

afterEach(() => {
  sessionPolicy.clear();
  systemInjectedForSession.clear();
});

describe("supervisor golden paths", () => {
  it("keeps a trusted delivery flow explainable from work unit intake through review prep", () => {
    // Arrange
    const intake = [
      {
        id: "sc-339-harness",
        workUnit: normalizeWorkUnit({
          objective: "Add supervisor golden path coverage",
          constraints: ["base branch must be main", "base branch must be main", "no unsupported runtime behavior"],
          acceptanceCriteria: [
            "Golden scenarios catch leakage and governance regressions",
            "Critical runtime paths stay explainable to operators"
          ],
          riskTags: ["workflow", "workflow", "testing"],
          source: {
            kind: "tracker",
            tracker: "shortcut",
            entityType: "story",
            id: 339,
            title: "Supervisor Golden Paths + Regression Harness",
            reference: "sc-339",
            url: "https://app.shortcut.com/tuinstradev/story/339",
            metadata: {
              epicId: 323,
              workflowStateId: 500000008
            }
          }
        }),
        dependsOn: [],
        signals: {
          fileOverlap: "medium" as const,
          coupling: "medium" as const,
          blastRadius: "adjacent" as const,
          unknownCount: 1,
          testIsolation: "partial" as const
        }
      },
      {
        id: "review-packet",
        workUnit: normalizeWorkUnit({
          objective: "Prepare review evidence for the supervisor harness",
          dependencies: [{ description: "Wait for the harness lane to finish", reference: "sc-339-harness" }],
          source: {
            kind: "ad-hoc",
            title: "Review-ready packet",
            reference: "doc:review-ready"
          }
        }),
        dependsOn: ["sc-339-harness"],
        signals: {
          fileOverlap: "low" as const,
          coupling: "low" as const,
          blastRadius: "contained" as const,
          unknownCount: 0,
          testIsolation: "isolated" as const
        }
      }
    ];
    const activeOwnership: LaneTurnOwnership = {
      laneId: "lane-1",
      activeRole: "DEV",
      writeAuthorityRole: "DEV",
      handoffHistory: []
    };

    // Act
    const lanePlan = planWorkUnitLanes(intake);
    const reviewOwnership = transferLaneTurn(activeOwnership, {
      laneId: "lane-1",
      currentOwner: "DEV",
      nextOwner: "REVIEWER",
      transferScope: "review",
      transferTrigger: "Golden path coverage and targeted validation are complete.",
      deltaSummary: "Added golden regression tests for supervisor invariants.",
      risks: ["Runtime output regressions could erode operator trust."],
      nextRequiredEvidence: ["npm test"],
      evidenceAttached: ["tests/supervisor-golden-paths.test.ts"]
    });
    const reviewPacket = assertReviewReadyTransition("active", "review_ready", {
      acceptanceCriteriaTrace: [
        {
          requirement: "Critical supervisor paths are covered by automated tests.",
          evidence: "tests/supervisor-golden-paths.test.ts",
          status: "done"
        }
      ],
      scopedDiffSummary: [
        "Adds a focused golden-path harness around supervisor intake, planning, governance, session, and output invariants."
      ],
      verificationResults: [
        {
          check: "npm test",
          result: "pass",
          notes: "Exercises the supervisor golden paths alongside the existing targeted helpers."
        }
      ],
      riskRollbackNotes: [
        "Remove the focused harness file if the scenario needs to be re-cut without changing runtime behavior."
      ],
      handoff: {
        laneId: "lane-1",
        currentOwner: "DEV",
        nextOwner: "REVIEWER",
        transferScope: "review",
        transferTrigger: "Golden path coverage and targeted validation are complete.",
        deltaSummary: "Added golden regression tests for supervisor invariants.",
        risks: ["Runtime output regressions could erode operator trust."],
        nextRequiredEvidence: ["npm test"],
        evidenceAttached: ["tests/supervisor-golden-paths.test.ts"]
      },
      ownership: {
        reviewerOwner: "REVIEWER",
        mergeOwner: "Marcel Tuinstra",
        followUpOwner: "DEV"
      }
    });

    // Assert
    expect(lanePlan.lanes).toEqual([
      {
        lane: 1,
        workUnitIds: ["sc-339-harness"],
        maxStructuralScore: 8,
        reasons: ["file overlap medium", "coupling medium", "blast radius adjacent", "unknown count 1", "test isolation partial"]
      },
      {
        lane: 2,
        workUnitIds: ["review-packet"],
        maxStructuralScore: 3,
        reasons: []
      }
    ]);
    expect(lanePlan.dependencyGraph).toEqual([
      {
        id: "sc-339-harness",
        blockedBy: [],
        unblocks: ["review-packet"],
        parallelizableWith: [],
        lane: 1,
        structuralScore: 8
      },
      {
        id: "review-packet",
        blockedBy: ["sc-339-harness"],
        unblocks: [],
        parallelizableWith: [],
        lane: 2,
        structuralScore: 3
      }
    ]);
    expect(reviewOwnership).toEqual({
      laneId: "lane-1",
      activeRole: "REVIEWER",
      writeAuthorityRole: "REVIEWER",
      handoffHistory: [
        {
          laneId: "lane-1",
          currentOwner: "DEV",
          nextOwner: "REVIEWER",
          transferScope: "review",
          transferTrigger: "Golden path coverage and targeted validation are complete.",
          deltaSummary: "Added golden regression tests for supervisor invariants.",
          risks: ["Runtime output regressions could erode operator trust."],
          nextRequiredEvidence: ["npm test"],
          evidenceAttached: ["tests/supervisor-golden-paths.test.ts"],
          openQuestions: []
        }
      ]
    });
    expect(reviewPacket?.ownership).toEqual({
      reviewerOwner: "REVIEWER",
      mergeOwner: "Marcel Tuinstra",
      followUpOwner: "DEV"
    });
    expect(reviewPacket?.handoff.nextOwner).toBe("REVIEWER");
  });

  it("preserves operator-visible runtime invariants for threaded supervisor output", () => {
    // Arrange
    const leakedThread = [
      "Format: [n] ROLE: message | Start with CTO: | Plan: CTO:2 DEV:1",
      "Heartbeat: Phase 1 Frame, Phase 2 Challenge (react to another role), Phase 3 Synthesize by lead.",
      "MCP: github only, max 2 calls.",
      "No markdown. Plain lines only.",
      "<system-reminder>",
      "internal reminder that must never leak",
      "</system-reminder>",
      "[1] CTO: Keep the harness focused on shipped supervisor helpers.",
      "[2] DEV: Prove leakage stripping, governance notices, and review prep still work.",
      "[3] CTO: Explain why these checks are the alpha trust layer."
    ].join("\n");

    // Act
    const cleaned = stripControlLeakage(leakedThread);
    const normalized = normalizeThreadOutput(cleaned, ["CTO", "DEV"], threadTargets);
    const withMissingProvider = appendMissingProviderNotice(normalized, "CTO", true, ["github"]);
    const withWarnings = appendMcpWarnings(withMissingProvider, [
      "GitHub MCP evidence has not run yet for this session."
    ]);
    const finalOutput = appendSupervisorDecisionNotes(withWarnings, ["CTO", "DEV"], threadTargets, "multi-role-thread");

    // Assert
    expect(finalOutput).toBe([
      "[1] CTO: Keep the harness focused on shipped supervisor helpers.",
      "",
      "[2] DEV: Prove leakage stripping, governance notices, and review prep still work.",
      "",
      "[3] CTO: Explain why these checks are the alpha trust layer.",
      "",
      "[4] CTO: [Supervisor] blocked.missing-mcp-provider: Blocked the final recommendation until at least one MCP check covers: github.",
      "",
      "---",
      "[MCP] blocked.mcp-access: Blocked the MCP action: GitHub MCP evidence has not run yet for this session..",
      "",
      "---",
      "[Supervisor] route.multi-role-thread: Routed this checkpoint through a threaded discussion because multiple roles stayed active: CTO, DEV.",
      "[Supervisor] assignment.weighted-turns: Assigned turns with the weighted plan CTO:2 DEV:1. Lead CTO opens and closes."
    ].join("\n"));
  });

  it("keeps governance gates explicit when budget pressure and merge approval checks trigger", () => {
    // Arrange
    const budgetPolicy = resolveBudgetGovernancePolicy({
      warningThresholdPercents: [70, 90],
      escalationThresholdPercent: 90
    });
    const mergePolicy = resolveMergePolicy("medium-moderate-risk");

    // Act
    const budgetDecision = evaluateBudgetGovernance(budgetPolicy, {
      scope: "run",
      usedTokens: 950,
      budgetTokens: 1000
    });
    const mergeDecision = evaluateMergePolicy(mergePolicy, {
      serviceCriticality: "standard",
      changedPaths: ["tests/supervisor-golden-paths.test.ts"]
    });

    // Assert
    expect(budgetDecision).toMatchObject({
      status: "escalation-required",
      shouldPauseAutomation: true,
      recommendations: [
        "reduce-scope",
        "reduce-active-lanes",
        "request-checkpoint-review",
        "enable-hard-stop-for-runaway-risk"
      ],
      requiredActions: [
        "justify-budget-overrun",
        "record-scope-or-lane-reduction",
        "schedule-checkpoint-review"
      ]
    });
    expect(budgetDecision.reasonDetails.map((detail) => detail.code)).toEqual(["budget.escalation-required"]);
    expect(mergeDecision).toMatchObject({
      status: "requires-human",
      resolvedMode: "manual",
      reasons: ["Merge policy defaults to manual human approval."]
    });
    expect(mergeDecision.reasonDetails.map((detail) => detail.code)).toEqual(["approval.manual-review-default"]);
  });

  it("resets only the targeted session coordination hooks", () => {
    // Arrange
    sessionPolicy.set("session-a", createSessionPolicy());
    sessionPolicy.set("session-b", {
      ...createSessionPolicy(),
      mcpProviders: ["github", "shortcut"]
    });
    systemInjectedForSession.add("session-a");
    systemInjectedForSession.add("session-b");

    // Act
    resetSessionState("session-a");

    // Assert
    expect(sessionPolicy.has("session-a")).toBe(false);
    expect(systemInjectedForSession.has("session-a")).toBe(false);
    expect(sessionPolicy.get("session-b")?.mcpProviders).toEqual(["github", "shortcut"]);
    expect(systemInjectedForSession.has("session-b")).toBe(true);
  });
});
