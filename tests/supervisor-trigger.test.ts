import { describe, expect, it } from "vitest";
import {
  SUPERVISOR_TRIGGER_REGEX,
  detectSupervisorTrigger,
  buildSupervisorPlan,
  formatSupervisorPreview
} from "../plugins/orchestration-workflows/supervisor-trigger";
import { buildSupervisorSystemInstruction } from "../plugins/orchestration-workflows/supervisor-system-instructions";

describe("supervisor-trigger", () => {
  describe("SUPERVISOR_TRIGGER_REGEX", () => {
    it("matches text starting with @supervisor followed by a space", () => {
      expect(SUPERVISOR_TRIGGER_REGEX.test("@supervisor Build auth")).toBe(true);
    });

    it("does not match text that does not start with @supervisor", () => {
      expect(SUPERVISOR_TRIGGER_REGEX.test("@cto Build auth")).toBe(false);
    });
  });

  describe("detectSupervisorTrigger", () => {
    it("detects and extracts goal from a valid @supervisor message", () => {
      const result = detectSupervisorTrigger("@supervisor Build auth");
      expect(result.detected).toBe(true);
      expect(result.goal).toBe("Build auth");
    });

    it("is case-insensitive for @Supervisor", () => {
      const result = detectSupervisorTrigger("@Supervisor Build something");
      expect(result.detected).toBe(true);
      expect(result.goal).toBe("Build something");
    });

    it("is case-insensitive for @SUPERVISOR", () => {
      const result = detectSupervisorTrigger("@SUPERVISOR build the feature");
      expect(result.detected).toBe(true);
      expect(result.goal).toBe("build the feature");
    });

    it("returns not detected for non-supervisor prefix", () => {
      const result = detectSupervisorTrigger("@cto Build auth");
      expect(result.detected).toBe(false);
      expect(result.goal).toBe("");
    });

    it("returns detected with empty goal when @supervisor is used alone", () => {
      const result = detectSupervisorTrigger("@supervisor");
      expect(result.detected).toBe(true);
      expect(result.goal).toBe("");
    });

    it("trims whitespace around the goal text", () => {
      const result = detectSupervisorTrigger("@supervisor   Build auth module  ");
      expect(result.detected).toBe(true);
      expect(result.goal).toBe("Build auth module");
    });

    it("returns not detected for empty string", () => {
      const result = detectSupervisorTrigger("");
      expect(result.detected).toBe(false);
      expect(result.goal).toBe("");
    });
  });

  describe("buildSupervisorPlan", () => {
    it("returns supported status with lanes for a valid multi-part goal", () => {
      const result = buildSupervisorPlan(
        "build user auth module, refactor API layer, update docs"
      );

      expect(result.status).toBe("supported");
      expect(result.goalPlan.status).toBe("supported");
      expect(result.workUnits.length).toBe(3);
      expect(result.laneDecomposition).not.toBeNull();
      expect(result.preview).toContain("[Supervisor] Plan");
    });

    it("returns unsupported status for a too-short ambiguous goal", () => {
      const result = buildSupervisorPlan("fix it");

      expect(result.status).toBe("unsupported");
      expect(result.goalPlan.status).toBe("unsupported");
      expect(result.workUnits).toEqual([]);
      expect(result.laneDecomposition).toBeNull();
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("creates sequential dependency chain from comma-separated segments", () => {
      const result = buildSupervisorPlan(
        "implement auth service, add API validation, write integration tests"
      );

      expect(result.workUnits.length).toBe(3);
      expect(result.workUnits[0]!.dependsOn).toEqual([]);
      expect(result.workUnits[1]!.dependsOn).toEqual(["wu-1"]);
      expect(result.workUnits[2]!.dependsOn).toEqual(["wu-2"]);
    });

    it("splits goals on semicolons and newlines", () => {
      const result = buildSupervisorPlan(
        "build the auth module; refactor the API layer"
      );

      expect(result.workUnits.length).toBe(2);
      expect(result.workUnits[0]!.workUnit.objective).toBe("build the auth module");
      expect(result.workUnits[1]!.workUnit.objective).toBe("refactor the API layer");
    });

    it("splits comma-separated segments without space after comma", () => {
      const result = buildSupervisorPlan(
        "build the user authentication API,add integration tests for the auth module"
      );

      expect(result.workUnits.length).toBe(2);
      expect(result.workUnits[0]!.workUnit.objective).toBe("build the user authentication API");
      expect(result.workUnits[1]!.workUnit.objective).toBe("add integration tests for the auth module");
    });
  });

  describe("formatSupervisorPreview", () => {
    it("produces readable output with lane table for a supported plan", () => {
      const plan = buildSupervisorPlan(
        "build user auth module, refactor API layer, update documentation"
      );

      const preview = formatSupervisorPreview(plan);

      expect(preview).toContain("[Supervisor] Plan");
      expect(preview).toContain("Goal:");
      expect(preview).toContain("Intent:");
      expect(preview).toContain("Confidence:");
      expect(preview).toContain("Budget:");
      expect(preview).toContain("Lanes:");
      expect(preview).toContain("Execution:");
      expect(preview).toContain("Merge:");
      expect(preview).toContain("Policy:");
      expect(preview).toContain("[Supervisor] Mode: active. Child sessions will be launched for each lane.");
    });

    it("shows unsupported reason for an unsupported plan", () => {
      const plan = buildSupervisorPlan("help");

      const preview = formatSupervisorPreview(plan);

      expect(preview).toContain("Unsupported");
      expect(preview).toContain("Reasons:");
    });

    it("shows warnings from lane decomposition in unsupported preview", () => {
      const plan = buildSupervisorPlan(
        "build user auth module, refactor API layer, update documentation"
      );

      // Simulate lane decomposition marking the plan unsupported with warnings
      plan.status = "unsupported";
      plan.warnings = ["Lane coupling too high", "Circular dependency detected"];

      const preview = formatSupervisorPreview(plan);

      expect(preview).toContain("Unsupported");
      expect(preview).toContain("Lane coupling too high");
      expect(preview).toContain("Circular dependency detected");
    });

    it("shows fallback when no reasons are available in unsupported preview", () => {
      const plan = buildSupervisorPlan(
        "build user auth module, refactor API layer"
      );

      // Simulate unsupported status with empty warnings
      plan.status = "unsupported";
      plan.warnings = [];

      const preview = formatSupervisorPreview(plan);

      expect(preview).toContain("Unsupported");
      expect(preview).toContain("No reason provided");
    });
  });

  describe("buildSupervisorSystemInstruction", () => {
    it("includes supervisor mode declaration", () => {
      const plan = buildSupervisorPlan(
        "build user auth module, refactor API layer, update documentation"
      );

      const instruction = buildSupervisorSystemInstruction(plan);

      expect(instruction).toContain("You are operating in Supervisor mode.");
    });

    it("includes lane assignments with objectives and roles", () => {
      const plan = buildSupervisorPlan(
        "implement auth service, add API validation, write integration tests"
      );

      const instruction = buildSupervisorSystemInstruction(plan);

      expect(instruction).toContain("Lane Assignments");
      expect(instruction).toContain("lane-");
      expect(instruction).toContain("implement auth service");
    });

    it("includes dependency ordering constraints", () => {
      const plan = buildSupervisorPlan(
        "implement auth service, add API validation, write integration tests"
      );

      const instruction = buildSupervisorSystemInstruction(plan);

      expect(instruction).toContain("Dependency Ordering Constraints");
      expect(instruction).toContain("must not start until");
    });

    it("includes execution protocol and budget boundaries", () => {
      const plan = buildSupervisorPlan(
        "build user auth module, refactor API layer, update docs"
      );

      const instruction = buildSupervisorSystemInstruction(plan);

      expect(instruction).toContain("Execute lanes in order. For each lane, use the `supervisor` tool to launch a child session.");
      expect(instruction).toContain("Budget class:");
      expect(instruction).toContain("Report progress after each lane completes.");
    });

    it("includes merge mode and escalation mode from policy", () => {
      const plan = buildSupervisorPlan(
        "build user auth module, refactor API layer"
      );

      const instruction = buildSupervisorSystemInstruction(plan);

      expect(instruction).toContain("Merge mode:");
      expect(instruction).toContain("Escalation mode:");
    });
  });
});
