import { describe, expect, it } from "vitest";
import {
  detectDelegationRequest,
  detectRolesFromMentions
} from "../plugins/orchestration-workflows/roles";
import { detectIntent, buildTurnTargets } from "../plugins/orchestration-workflows/intent";
import { extractDelegatedRoles, appendSupervisorDecisionNotes } from "../plugins/orchestration-workflows/output";
import type { Role } from "../plugins/orchestration-workflows/types";

/**
 * Issue #57 — Acceptance Criteria Tests
 *
 * These tests describe the DESIRED behavior for delegation intent tracking.
 * They should FAIL until the feature is implemented, serving as the
 * acceptance criteria for the fix.
 */
describe("issue #57: delegation intent detection", () => {
  describe("input parsing should detect delegation qualifiers", () => {
    it("detects delegation intent from 'let @ceo delegate'", () => {
      // Arrange
      const text = "Research this with @ceo and let @ceo delegate to other agents";

      // Act
      const roles = detectRolesFromMentions(text);
      const delegation = detectDelegationRequest(text);

      // Assert — roles should include delegation metadata
      expect(roles).toEqual(
        expect.arrayContaining(["CEO"])
      );

      // The system should produce a delegation result that distinguishes
      // "CEO as delegation orchestrator" from "CEO as direct participant"
      expect(delegation).toEqual({
        mode: "agent-led",
        primaryRole: "CEO",
        requestedByUser: ["CEO"]
      });
      expect(detectIntent(text)).toBe("research");
    });

    it("detects delegation intent from 'have @ceo decide which agents'", () => {
      // Arrange
      const text = "Have @ceo decide which agents to involve for this analysis";

      // Act
      const delegation = detectDelegationRequest(text);

      // Assert — should detect explicit agent-led delegation
      expect(delegation).toEqual({
        mode: "agent-led",
        primaryRole: "CEO",
        requestedByUser: ["CEO"]
      });
    });

    it("detects delegation intent from 'use @cto first then let it pull in others'", () => {
      // Arrange
      const text = "Use @cto first, then let it pull in other specialists as needed";

      // Act
      const delegation = detectDelegationRequest(text);

      // Assert
      expect(delegation).toEqual({
        mode: "agent-led",
        primaryRole: "CTO",
        requestedByUser: ["CTO"]
      });
    });

    it("does not detect delegation intent for plain role mentions", () => {
      // Arrange
      const text = "Investigate API latency with @cto and @dev";

      // Act
      const intent = detectIntent(text);
      const delegation = detectDelegationRequest(text);

      // Assert — no delegation keywords, should classify as a concrete domain intent
      expect(intent).toBe("backend");
      expect(delegation).toBeNull();
    });
  });

  describe("extractDelegatedRoles should track provenance", () => {
    it("records the lead role as the delegation source", () => {
      // Arrange
      const llmOutput = "<<DELEGATE:PM,RESEARCH>>\n[1] CEO: Strategic analysis\n[2] PM: Scoping\n[3] RESEARCH: Investigation";

      // Act
      const result = extractDelegatedRoles(llmOutput, "CEO");

      // Assert — should include delegation provenance
      expect(result.roles).toEqual(["CEO", "PM", "RESEARCH"]);
      expect(result).toHaveProperty("delegatedBy", "CEO");
      expect(result).toHaveProperty("delegationSource", "agent-delegated");
    });
  });

  describe("transcript should show delegation attribution", () => {
    it("shows who delegated to whom in delegated-thread annotations", () => {
      // Arrange
      const roles: Role[] = ["CEO", "PM", "RESEARCH"];
      const targets = buildTurnTargets(roles, "strategic analysis");
      const transcript = [
        "[1] CEO: We need market research and project scoping.",
        "[2] PM: Scoping the timeline.",
        "[3] RESEARCH: Analyzing the landscape.",
        "[4] CEO: Here is our recommendation."
      ].join("\n\n");

      // Act
      const annotated = appendSupervisorDecisionNotes(transcript, roles, targets, "delegated-thread", {
        requestedByUser: ["CEO"],
        delegatedBy: "CEO",
        delegatedRoles: ["PM", "RESEARCH"],
        addedByOrchestrator: []
      });

      // Assert — should show delegation chain via wave rendering
      expect(annotated).toMatch(/delegated.*by CEO/);
    });

    it("distinguishes user-requested from agent-delegated roles", () => {
      // Arrange — user requested CEO, CEO delegated to PM and RESEARCH
      const userRequested: Role[] = ["CEO"];
      const agentDelegated: Role[] = ["PM", "RESEARCH"];
      const allRoles: Role[] = [...userRequested, ...agentDelegated];
      const targets = buildTurnTargets(allRoles, "market analysis");
      const transcript = "[1] CEO: x\n\n[2] PM: y\n\n[3] RESEARCH: z";

      // Act
      const annotated = appendSupervisorDecisionNotes(transcript, allRoles, targets, "delegated-thread", {
        requestedByUser: userRequested,
        delegatedBy: "CEO",
        delegatedRoles: agentDelegated,
        addedByOrchestrator: []
      });

      // Assert — annotation should distinguish sources
      expect(annotated).toContain("requested by user: CEO");
      expect(annotated).toMatch(/delegated.*by CEO:.*PM.*RESEARCH/);
    });
  });
});
