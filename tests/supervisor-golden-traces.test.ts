import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileBackedSupervisorStateStore, type SupervisorRunState } from "../plugins/orchestration-workflows/durable-state-store";
import { evaluateGovernancePolicy, type GovernancePolicyDecision } from "../plugins/orchestration-workflows/governance-policy";
import {
  createSupervisorLaneWorktreeProvisioner,
  type GitWorktreeEntry,
  type SupervisorLaneWorktreeSystem
} from "../plugins/orchestration-workflows/lane-worktree-provisioner";
import { planWorkUnitLanes } from "../plugins/orchestration-workflows/lane-plan";
import { evaluateProtectedPathPolicy } from "../plugins/orchestration-workflows/protected-path-policy";
import { createReviewReadyEvidencePacket, type ReviewReadyEvidencePacketInput } from "../plugins/orchestration-workflows/review-ready-packet";
import {
  createSupervisorSessionLifecycle,
  type AttachSupervisorRuntimeSessionInput,
  type LaunchSupervisorRuntimeSessionInput,
  type SupervisorSessionRuntimeAdapter
} from "../plugins/orchestration-workflows/session-runtime-adapter";
import { createSupervisorDispatchLoop, createSupervisorLaneDefinitions, type SupervisorDispatchLaneInput } from "../plugins/orchestration-workflows/supervisor-scheduler";
import { resolveSupervisorPolicy } from "../plugins/orchestration-workflows/supervisor-config";
import { createSupervisorExecutionWorkflow } from "../plugins/orchestration-workflows/supervisor-execution-workflow";
import { normalizeWorkUnit } from "../plugins/orchestration-workflows/work-unit";
import {
  supervisorGoldenTracesFixture,
  type GoldenScenarioFixture,
  type GoldenTraceExpectation
} from "./fixtures/supervisor-golden-traces-fixture";

const tempDirs: string[] = [];

const createTempRoot = (): string => {
  const rootDir = mkdtempSync(path.join(os.tmpdir(), "supervisor-golden-traces-"));
  tempDirs.push(rootDir);
  return rootDir;
};

const createFakeSystem = (): SupervisorLaneWorktreeSystem & { createCount: number } => {
  const gitWorktrees = new Map<string, GitWorktreeEntry>();
  const localBranches = new Set<string>();
  let createCount = 0;

  return {
    get createCount(): number {
      return createCount;
    },

    listGitWorktrees: (): readonly GitWorktreeEntry[] => Object.freeze(
      Array.from(gitWorktrees.values()).map((entry) => Object.freeze({ ...entry }))
    ),

    pathExists: (filePath: string): boolean => existsSync(filePath),

    branchExists: (branch: string): boolean => localBranches.has(branch),

    createWorktree: ({ path: worktreePath, branch, createBranch }): void => {
      mkdirSync(worktreePath, { recursive: true });
      gitWorktrees.set(path.resolve(worktreePath), {
        path: path.resolve(worktreePath),
        branch,
        head: "abc123",
        isBare: false,
        isDetached: false,
        isLocked: false,
        isPrunable: false
      });
      if (createBranch) {
        localBranches.add(branch);
      }
      createCount += 1;
    },

    removeWorktree: (worktreePath: string): void => {
      gitWorktrees.delete(path.resolve(worktreePath));
      rmSync(worktreePath, { force: true, recursive: true });
    },

    listManagedLanePaths: (runWorktreeRoot: string): readonly string[] => {
      if (!existsSync(runWorktreeRoot)) {
        return [];
      }

      return Object.freeze(readdirSync(runWorktreeRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.resolve(path.join(runWorktreeRoot, entry.name))));
    }
  };
};

const createFakeRuntime = (): SupervisorSessionRuntimeAdapter => {
  const launched: LaunchSupervisorRuntimeSessionInput[] = [];
  const attached: AttachSupervisorRuntimeSessionInput[] = [];

  return {
    runtime: "opencode",
    launchSession: (input) => {
      launched.push({ ...input });

      return {
        runtimeSessionId: `runtime-${launched.length}`,
        owner: input.owner,
        status: "active",
        attachedAt: input.occurredAt,
        lastHeartbeatAt: input.occurredAt
      };
    },
    attachSession: (input) => {
      attached.push({ ...input });

      return {
        runtimeSessionId: input.sessionId,
        owner: input.owner,
        status: "active",
        attachedAt: input.occurredAt,
        lastHeartbeatAt: input.occurredAt
      };
    }
  };
};

const freezeList = <T>(items: readonly T[]): readonly T[] => Object.freeze([...items]);

type GoldenTrace = GoldenTraceExpectation;

type ScenarioHarness = ReturnType<typeof createScenarioHarness>;

const createScenarioHarness = () => {
  const rootDir = createTempRoot();
  const repoRoot = path.join(rootDir, "repo");
  const worktreeRootDir = path.join(rootDir, "worktrees");
  mkdirSync(repoRoot, { recursive: true });

  const store = createFileBackedSupervisorStateStore({ rootDir: path.join(rootDir, "state") });
  const system = createFakeSystem();
  const runtime = createFakeRuntime();
  const provisioner = createSupervisorLaneWorktreeProvisioner({ repoRoot, worktreeRootDir, store, system });
  const sessions = createSupervisorSessionLifecycle({ store, runtime });
  const dispatchLoop = createSupervisorDispatchLoop({ store, provisioner, sessions });
  const workflow = createSupervisorExecutionWorkflow({ store, dispatchLoop });

  return {
    rootDir,
    store,
    sessions,
    workflow
  };
};

const materializeWorkUnits = (scenario: GoldenScenarioFixture) => scenario.workUnits.map((unit) => ({
  id: unit.id,
  workUnit: normalizeWorkUnit({
    ...unit.draft,
    constraints: unit.draft.constraints ? [...unit.draft.constraints] : undefined,
    acceptanceCriteria: unit.draft.acceptanceCriteria ? [...unit.draft.acceptanceCriteria] : undefined,
    dependencies: unit.draft.dependencies ? [...unit.draft.dependencies] : undefined,
    riskTags: unit.draft.riskTags ? [...unit.draft.riskTags] : undefined
  } as never),
  dependsOn: [...unit.dependsOn],
  signals: unit.signals
}));

const createLaneInputs = (scenario: GoldenScenarioFixture): {
  workUnits: ReturnType<typeof materializeWorkUnits>;
  lanePlan: ReturnType<typeof planWorkUnitLanes>;
  laneInputs: readonly SupervisorDispatchLaneInput[];
} => {
  const workUnits = materializeWorkUnits(scenario);
  const lanePlan = planWorkUnitLanes(workUnits);
  const definitions = createSupervisorLaneDefinitions(lanePlan, {
    branchPrefix: `marceltuinstra/sc-439/${scenario.id}`
  });

  return {
    workUnits,
    lanePlan,
    laneInputs: freezeList(definitions.map((definition) => ({ definition })))
  };
};

const createReviewReadyPacketInput = (input: {
  runId: string;
  laneId: string;
  branch: string;
  occurredAt: string;
  scenarioName: string;
  reviewerOwner?: string;
  omitReviewPacketArtifact?: boolean;
}): ReviewReadyEvidencePacketInput => ({
  acceptanceCriteriaTrace: [
    {
      requirement: `${input.scenarioName} preserves the expected review-ready trace.`,
      evidence: "tests/supervisor-golden-traces.test.ts",
      status: "done"
    }
  ],
  scopedDiffSummary: [`Captures the ${input.scenarioName} golden trace through the existing beta workflow.`],
  verificationResults: [
    {
      check: "npm test -- tests/supervisor-golden-traces.test.ts",
      result: "pass",
      notes: "Golden trace remained stable for the targeted scenario."
    }
  ],
  riskRollbackNotes: ["Re-cut the scenario fixture if the workflow intentionally changes."],
  handoff: {
    laneId: input.laneId,
    currentOwner: "DEV",
    nextOwner: "REVIEWER",
    transferScope: "review",
    transferTrigger: `${input.scenarioName} reached the review-ready checkpoint.`,
    deltaSummary: `Preserve the ${input.scenarioName} golden trace.`,
    risks: [`${input.scenarioName} must keep governance and plan traces stable.`],
    nextRequiredEvidence: ["golden trace review"],
    evidenceAttached: ["tests/supervisor-golden-traces.test.ts"]
  },
  laneOutput: {
    runId: input.runId,
    laneId: input.laneId,
    status: "ready",
    handoff: {
      laneId: input.laneId,
      currentOwner: "DEV",
      nextOwner: "REVIEWER",
      transferScope: "review",
      transferTrigger: `${input.scenarioName} reached the review-ready checkpoint.`,
      deltaSummary: `Preserve the ${input.scenarioName} golden trace.`,
      risks: [`${input.scenarioName} must keep governance and plan traces stable.`],
      nextRequiredEvidence: ["golden trace review"],
      evidenceAttached: ["tests/supervisor-golden-traces.test.ts"]
    },
    artifacts: input.omitReviewPacketArtifact
      ? [
          {
            laneId: input.laneId,
            kind: "branch",
            uri: `branch:${input.branch}`,
            label: "Lane branch"
          }
        ]
      : [
          {
            laneId: input.laneId,
            kind: "branch",
            uri: `branch:${input.branch}`,
            label: "Lane branch"
          },
          {
            laneId: input.laneId,
            kind: "review-packet",
            uri: `docs/supervisor/${input.scenarioName}.md`,
            label: "Review packet"
          }
        ],
    evidence: ["npm test -- tests/supervisor-golden-traces.test.ts"],
    producedAt: input.occurredAt
  },
  ownership: {
    reviewerOwner: input.reviewerOwner ?? "REVIEWER",
    mergeOwner: "Marcel Tuinstra",
    followUpOwner: "DEV"
  }
});

const mapPlanShape = (lanePlan: ReturnType<typeof planWorkUnitLanes>): GoldenTrace["plan"] => ({
  lanes: lanePlan.lanes.map((lane) => ({
    lane: lane.lane,
    workUnitIds: lane.workUnitIds,
    dependsOnLaneIds: lanePlan.dependencyGraph
      .filter((node) => lane.workUnitIds.includes(node.id))
      .flatMap((node) => node.blockedBy)
      .map((workUnitId) => lanePlan.dependencyGraph.find((candidate) => candidate.id === workUnitId)?.lane)
      .filter((laneNumber): laneNumber is number => laneNumber !== undefined && laneNumber !== lane.lane)
      .map((laneNumber) => `lane-${laneNumber}`)
  })),
  dependencyGraph: lanePlan.dependencyGraph.map((node) => ({
    id: node.id,
    lane: node.lane,
    blockedBy: node.blockedBy,
    unblocks: node.unblocks
  }))
});

const mapGovernanceDecision = (
  decision: GovernancePolicyDecision,
  extras: Partial<GoldenTrace["governance"]> = {}
): GoldenTrace["governance"] => ({
  outcome: decision.outcome,
  route: decision.route,
  source: decision.source,
  ...extras
});

const buildTrace = (input: {
  scenarioId: string;
  lanePlan: ReturnType<typeof planWorkUnitLanes>;
  governance: GoldenTrace["governance"];
  state: SupervisorRunState;
  result: ReturnType<ScenarioHarness["workflow"]["advanceRun"]>;
  actionTrace: readonly string[];
  workflowStages: readonly string[];
}): GoldenTrace => ({
  scenarioId: input.scenarioId,
  plan: mapPlanShape(input.lanePlan),
  governance: input.governance,
  final: {
    stage: input.result.stage,
    status: input.result.status,
    nextAction: input.result.nextAction,
    runStatus: input.state.run.status,
    laneStates: input.state.lanes.map((lane) => ({ laneId: lane.laneId, state: lane.state })),
    actionTrace: input.actionTrace,
    workflowStages: input.workflowStages
  }
});

const bootstrapScenario = (
  harness: ScenarioHarness,
  scenario: GoldenScenarioFixture,
  workUnits: ReturnType<typeof materializeWorkUnits>,
  laneInputs: readonly SupervisorDispatchLaneInput[]
): void => {
  const bootstrap = harness.workflow.bootstrapRun({
    runId: `run-${scenario.id}`,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:00:00.000Z",
    objective: `Execute the ${scenario.name} golden trace.`,
    goal: `Validate the ${scenario.name} beta workflow scenario.`,
    workUnits,
    readyDependencyReferences: [],
    mutationId: `bootstrap:${scenario.id}`
  });

  expect(bootstrap.dispatchPlan.laneInputs.map((lane) => lane.definition.laneId)).toEqual(laneInputs.map((lane) => lane.definition.laneId));
};

const collectStages = (state: SupervisorRunState): readonly string[] => state.auditLog
  .flatMap((entry) => entry.sideEffects.filter((sideEffect) => sideEffect.startsWith("workflow-stage:")))
  .map((sideEffect) => sideEffect.slice("workflow-stage:".length));

const runSingleLaneHappyPath = (harness: ScenarioHarness, scenario: GoldenScenarioFixture, lanePlan: ReturnType<typeof planWorkUnitLanes>, laneInputs: readonly SupervisorDispatchLaneInput[]): GoldenTrace => {
  const runId = `run-${scenario.id}`;
  const first = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:01:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const second = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:02:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const packet = createReviewReadyPacketInput({
    runId,
    laneId: "lane-1",
    branch: laneInputs[0]!.definition.branch,
    occurredAt: "2026-03-13T20:03:00.000Z",
    scenarioName: scenario.id
  });
  const governance = mapGovernanceDecision(evaluateGovernancePolicy({
    checkpoint: "review-ready",
    violations: createReviewReadyEvidencePacket(packet).handoffValidation.violations
  }));
  const third = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:03:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [{ ...laneInputs[0]!, reviewReadyPacket: packet }],
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const state = harness.store.getRunState(runId)!;

  return buildTrace({
    scenarioId: scenario.id,
    lanePlan,
    governance,
    state,
    result: third,
    actionTrace: [first, second, third].flatMap((result) => result.dispatch.decisions.map((decision) => decision.action).filter((action) => action !== "none")),
    workflowStages: collectStages(state)
  });
};

const runMultiLaneDependencyPath = (harness: ScenarioHarness, scenario: GoldenScenarioFixture, lanePlan: ReturnType<typeof planWorkUnitLanes>, laneInputs: readonly SupervisorDispatchLaneInput[]): GoldenTrace => {
  const runId = `run-${scenario.id}`;
  const first = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:11:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a", "developer-b"],
    baseRef: "origin/beta"
  });
  const second = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:12:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a", "developer-b"],
    baseRef: "origin/beta"
  });
  const laneOnePacket = createReviewReadyPacketInput({
    runId,
    laneId: "lane-1",
    branch: laneInputs[0]!.definition.branch,
    occurredAt: "2026-03-13T20:13:00.000Z",
    scenarioName: `${scenario.id}-foundation`
  });
  const third = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:13:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [
      { ...laneInputs[0]!, reviewReadyPacket: laneOnePacket },
      laneInputs[1]!
    ],
    sessionOwners: ["developer-a", "developer-b"],
    baseRef: "origin/beta"
  });
  const fourth = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:14:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [
      { ...laneInputs[0]!, complete: true },
      laneInputs[1]!
    ],
    sessionOwners: ["developer-a", "developer-b"],
    baseRef: "origin/beta"
  });
  const fifth = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:15:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [
      { ...laneInputs[0]!, complete: true },
      laneInputs[1]!
    ],
    sessionOwners: ["developer-a", "developer-b"],
    baseRef: "origin/beta"
  });
  const packet = createReviewReadyPacketInput({
    runId,
    laneId: "lane-2",
    branch: laneInputs[1]!.definition.branch,
    occurredAt: "2026-03-13T20:16:00.000Z",
    scenarioName: scenario.id
  });
  const governance = mapGovernanceDecision(evaluateGovernancePolicy({
    checkpoint: "review-ready",
    violations: createReviewReadyEvidencePacket(packet).handoffValidation.violations
  }));
  const sixth = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:16:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [
      { ...laneInputs[0]!, complete: true },
      { ...laneInputs[1]!, reviewReadyPacket: packet }
    ],
    sessionOwners: ["developer-a", "developer-b"],
    baseRef: "origin/beta"
  });
  const state = harness.store.getRunState(runId)!;

  return buildTrace({
    scenarioId: scenario.id,
    lanePlan,
    governance,
    state,
    result: sixth,
    actionTrace: [first, second, third, fourth, fifth, sixth]
      .flatMap((result) => result.dispatch.decisions.map((decision) => decision.action).filter((action) => action !== "none")),
    workflowStages: collectStages(state)
  });
};

const runFailedHandoff = (harness: ScenarioHarness, scenario: GoldenScenarioFixture, lanePlan: ReturnType<typeof planWorkUnitLanes>, laneInputs: readonly SupervisorDispatchLaneInput[]): GoldenTrace => {
  const runId = `run-${scenario.id}`;
  const first = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:21:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const second = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:22:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const packet = createReviewReadyPacketInput({
    runId,
    laneId: "lane-1",
    branch: laneInputs[0]!.definition.branch,
    occurredAt: "2026-03-13T20:23:00.000Z",
    scenarioName: scenario.id,
    omitReviewPacketArtifact: true
  });
  const governance = mapGovernanceDecision(evaluateGovernancePolicy({
    checkpoint: "review-ready",
    violations: createReviewReadyEvidencePacket(packet).handoffValidation.violations
  }));
  const third = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:23:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [{ ...laneInputs[0]!, reviewReadyPacket: packet }],
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const state = harness.store.getRunState(runId)!;

  return buildTrace({
    scenarioId: scenario.id,
    lanePlan,
    governance,
    state,
    result: third,
    actionTrace: [first, second, third].flatMap((result) => result.dispatch.decisions.map((decision) => decision.action).filter((action) => action !== "none")),
    workflowStages: collectStages(state)
  });
};

const runProtectedPathGovernanceBlock = (harness: ScenarioHarness, scenario: GoldenScenarioFixture, lanePlan: ReturnType<typeof planWorkUnitLanes>, laneInputs: readonly SupervisorDispatchLaneInput[]): GoldenTrace => {
  const runId = `run-${scenario.id}`;
  const first = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:31:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const second = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:32:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const protectedPathDecision = evaluateProtectedPathPolicy(
    scenario.changedPaths ?? [],
    resolveSupervisorPolicy(undefined).config.protectedPaths
  );
  const governance = mapGovernanceDecision(evaluateGovernancePolicy({
    checkpoint: "review-ready",
    violations: protectedPathDecision.violationCodes.map((code) => ({
      code,
      field: "changedPaths",
      message: `Protected path policy emitted '${code}'.`
    }))
  }), {
    protectedPathOutcome: protectedPathDecision.outcome
  });
  const state = harness.store.getRunState(runId)!;

  return buildTrace({
    scenarioId: scenario.id,
    lanePlan,
    governance,
    state,
    result: second,
    actionTrace: [first, second].flatMap((result) => result.dispatch.decisions.map((decision) => decision.action).filter((action) => action !== "none")),
    workflowStages: collectStages(state)
  });
};

const runRecoveryResume = (harness: ScenarioHarness, scenario: GoldenScenarioFixture, lanePlan: ReturnType<typeof planWorkUnitLanes>, laneInputs: readonly SupervisorDispatchLaneInput[]): GoldenTrace => {
  const runId = `run-${scenario.id}`;
  const first = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:41:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const second = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:42:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  harness.sessions.detectStalledSession({
    runId,
    laneId: "lane-1",
    actor: "supervisor",
    mutationId: `${runId}:stalled`,
    observedAt: "2026-03-13T20:49:00.000Z",
    stallTimeoutMs: 5 * 60 * 1000,
    failureReason: "Scenario fixture stalled the delegated session."
  });
  const third = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:50:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: laneInputs,
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const approvalRequest = {
    boundary: "merge" as const,
    requestedAction: "resume lane-1 after recovery",
    summary: "Pause the recovered lane at the merge checkpoint.",
    rationale: "Recovery should still require explicit resume approval."
  };
  harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:51:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [{ ...laneInputs[0]!, approvalGate: { request: approvalRequest } }],
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const governance = mapGovernanceDecision(evaluateGovernancePolicy({
    checkpoint: "review-ready",
    violations: []
  }), {
    approvalStatus: "approved"
  });
  const fifth = harness.workflow.advanceRun({
    runId,
    actor: "supervisor",
    occurredAt: "2026-03-13T20:52:00.000Z",
    repoRiskTier: "medium-moderate-risk",
    lanes: [{
      ...laneInputs[0]!,
      approvalGate: {
        request: approvalRequest,
        signal: {
          status: "approved",
          actor: "reviewer",
          occurredAt: "2026-03-13T20:52:30.000Z",
          note: "Recovered lane may resume."
        }
      }
    }],
    sessionOwners: ["developer-a"],
    baseRef: "origin/beta"
  });
  const state = harness.store.getRunState(runId)!;

  return buildTrace({
    scenarioId: scenario.id,
    lanePlan,
    governance,
    state,
    result: fifth,
    actionTrace: [first, second, third, fifth].flatMap((result) => result.dispatch.decisions.map((decision) => decision.action).filter((action) => action !== "none")),
    workflowStages: collectStages(state)
  });
};

const runScenario = (scenario: GoldenScenarioFixture): GoldenTrace => {
  const harness = createScenarioHarness();
  const { workUnits, lanePlan, laneInputs } = createLaneInputs(scenario);
  bootstrapScenario(harness, scenario, workUnits, laneInputs);

  switch (scenario.id) {
    case "single-lane-happy-path":
      return runSingleLaneHappyPath(harness, scenario, lanePlan, laneInputs);
    case "multi-lane-dependency-path":
      return runMultiLaneDependencyPath(harness, scenario, lanePlan, laneInputs);
    case "failed-handoff":
      return runFailedHandoff(harness, scenario, lanePlan, laneInputs);
    case "protected-path-governance-block":
      return runProtectedPathGovernanceBlock(harness, scenario, lanePlan, laneInputs);
    case "recovery-resume":
      return runRecoveryResume(harness, scenario, lanePlan, laneInputs);
    default:
      throw new Error(`Unhandled golden trace scenario '${scenario.id}'.`);
  }
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { force: true, recursive: true });
  }
});

describe("supervisor-golden-traces", () => {
  for (const scenario of supervisorGoldenTracesFixture.scenarios) {
    it(`keeps the ${scenario.name} trace stable`, () => {
      // Arrange + Act
      const trace = runScenario(scenario);

      // Assert
      expect(trace).toEqual(scenario.expectedTrace);
    });
  }

  it("produces a compact beta release-readiness proof from the scenario outcomes", () => {
    // Arrange + Act
    const proof = supervisorGoldenTracesFixture.scenarios.map((scenario) => {
      const trace = runScenario(scenario);

      return {
        scenario: scenario.name,
        governance: trace.governance.outcome,
        finalRunStatus: trace.final.runStatus,
        finalLaneStates: trace.final.laneStates.map((lane) => `${lane.laneId}:${lane.state}`)
      };
    });

    // Assert
    expect(proof).toEqual(supervisorGoldenTracesFixture.releaseReadinessProof);
  });
});
