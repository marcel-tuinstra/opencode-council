import { describe, expect, it } from "vitest";
import {
  createSupervisorDelegationPlan,
  validateSupervisorDelegationPlan
} from "../plugins/orchestration-workflows/supervisor-delegation";

describe("supervisor-delegation", () => {
  it("accepts a delegate-only plan with separate implementation and integration agents", () => {
    // Arrange
    const plan = createSupervisorDelegationPlan({
      assignments: [
        {
          storyId: "sc-328",
          role: "DEV",
          agentLabel: "DEV-A",
          branch: "marceltuinstra/sc-328-parallel",
          worktreePath: "/tmp/wt-sc328",
          responsibilities: ["Implement sc-328", "Run targeted tests"]
        },
        {
          storyId: "sc-439",
          role: "DEV",
          agentLabel: "DEV-B",
          branch: "marceltuinstra/sc-439-parallel",
          worktreePath: "/tmp/wt-sc439",
          responsibilities: ["Implement sc-439", "Run targeted tests"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        role: "DEV",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Resolve integration issues", "Run full validation"]
      }
    });

    // Act
    const result = validateSupervisorDelegationPlan(plan);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.plan.policy.mode).toBe("delegate-only");
  });

  it("rejects delegate-only execution when supervisor direct edits are requested", () => {
    // Arrange
    const input = {
      directEditsRequested: true,
      assignments: [{
        storyId: "sc-328",
        role: "DEV" as const,
        agentLabel: "DEV-A",
        worktreePath: "/tmp/wt-sc328",
        responsibilities: ["Implement sc-328"]
      }],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Run integration"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toContain("Supervisor direct product-code edits are disabled in delegate-only mode.");
  });

  it("rejects missing worktree bindings and a reused integration agent", () => {
    // Arrange
    const input = {
      assignments: [{
        storyId: "sc-328",
        role: "DEV" as const,
        agentLabel: "DEV-A",
        responsibilities: ["Implement sc-328"]
      }],
      integration: {
        agentLabel: "DEV-A",
        responsibilities: ["Integrate outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'DEV-A' is missing a bound worktree path.",
      "Integration agent 'DEV-A' is missing a bound worktree path.",
      "Integration agent must stay distinct from implementation agents when dedicated integration is required."
    ]));
  });

  it("rejects a CTO assignment that absorbs implementation work without an execution role", () => {
    // Arrange
    const input = {
      assignments: [{
        storyId: "sc-v1-boundary",
        role: "CTO" as const,
        agentLabel: "CTO",
        worktreePath: "/tmp/wt-cto",
        responsibilities: ["Implement the core workflow", "Run the tests"]
      }],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'CTO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("allows a CTO assignment when implementation work is delegated to execution roles", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Define architecture", "Review technical risks"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "DEV" as const,
          agentLabel: "DEV-A",
          worktreePath: "/tmp/wt-dev",
          responsibilities: ["Implement the core workflow", "Run the tests"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("rejects CEO and PM assignments that absorb implementation work without execution roles", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "CEO" as const,
          agentLabel: "CEO",
          worktreePath: "/tmp/wt-ceo",
          responsibilities: ["Implement the launch workflow"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Build the release checklist flow"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'CEO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'PM' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("does not treat review and planning responsibilities as implementation ownership for manager roles", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Validate architecture", "Review test plan"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Deliver roadmap", "Document requirements"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("still rejects mixed manager responsibilities that include real implementation work", () => {
    // Arrange
    const input = {
      assignments: [{
        storyId: "sc-v1-boundary",
        role: "CTO" as const,
        agentLabel: "CTO",
        worktreePath: "/tmp/wt-cto",
        responsibilities: ["Review the diff and implement the fix"]
      }],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'CTO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("rejects manager-owned execution phrasing like run tests or validate the fix", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Run tests for the release flow"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "CEO" as const,
          agentLabel: "CEO",
          worktreePath: "/tmp/wt-ceo",
          responsibilities: ["Validate the fix before launch"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'PM' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'CEO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("rejects write and deliver phrasing when they imply execution ownership", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Write the migration"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "CEO" as const,
          agentLabel: "CEO",
          worktreePath: "/tmp/wt-ceo",
          responsibilities: ["Deliver the feature"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'CTO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'CEO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("rejects manager-owned execution phrasing for fix and release flow work", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Fix the release flow"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Ship the feature"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'CTO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'PM' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("rejects manager-owned execution phrasing for testing and api implementation work", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Test the release candidate"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Write the API client"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'PM' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'CTO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("does not flag release-notes or messaging-plan work as implementation ownership", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Write release notes"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "MARKETING" as const,
          agentLabel: "MARKETING",
          worktreePath: "/tmp/wt-marketing",
          responsibilities: ["Deliver messaging plan"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("does not flag planning language like build the test plan or develop roadmap", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Build the test plan"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Develop roadmap"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "MARKETING" as const,
          agentLabel: "MARKETING",
          worktreePath: "/tmp/wt-marketing",
          responsibilities: ["Develop positioning"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("still rejects implementation work even when plan or docs nouns appear in the sentence", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "CTO" as const,
          agentLabel: "CTO",
          worktreePath: "/tmp/wt-cto",
          responsibilities: ["Build the deployment plan generator"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Write docs generator"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "CEO" as const,
          agentLabel: "CEO",
          worktreePath: "/tmp/wt-ceo",
          responsibilities: ["Ship the requirements workflow"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'CTO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'PM' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'CEO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });

  it("does not flag review phrasing when no execution work is present", () => {
    // Arrange
    const input = {
      assignments: [{
        storyId: "sc-v1-boundary",
        role: "CTO" as const,
        agentLabel: "CTO",
        worktreePath: "/tmp/wt-cto",
        responsibilities: ["Review the fix"]
      }],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("rejects testing and validation phrasing when it targets executable artifacts", () => {
    // Arrange
    const input = {
      assignments: [
        {
          storyId: "sc-v1-boundary",
          role: "PM" as const,
          agentLabel: "PM",
          worktreePath: "/tmp/wt-pm",
          responsibilities: ["Test the migration"]
        },
        {
          storyId: "sc-v1-boundary",
          role: "CEO" as const,
          agentLabel: "CEO",
          worktreePath: "/tmp/wt-ceo",
          responsibilities: ["Validate the API client"]
        }
      ],
      integration: {
        agentLabel: "INTEGRATION",
        worktreePath: "/tmp/wt-integration",
        responsibilities: ["Review outputs"]
      }
    };

    // Act
    const result = validateSupervisorDelegationPlan(input);

    // Assert
    expect(result.valid).toBe(false);
    expect(result.violations).toEqual(expect.arrayContaining([
      "Assignment 'PM' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Assignment 'CEO' cannot own implementation responsibilities directly; delegate that work to DEV, FE, BE, or UX.",
      "Implementation-scoped runs require at least one DEV, FE, BE, or UX assignment."
    ]));
  });
});
