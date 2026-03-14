export type GoldenTraceExpectation = {
  scenarioId: string;
  plan: {
    lanes: readonly {
      lane: number;
      workUnitIds: readonly string[];
      dependsOnLaneIds: readonly string[];
    }[];
    dependencyGraph: readonly {
      id: string;
      lane: number;
      blockedBy: readonly string[];
      unblocks: readonly string[];
    }[];
  };
  governance: {
    outcome: string;
    route: string;
    source: string;
    protectedPathOutcome?: "allow" | "requires-human" | "deny";
    approvalStatus?: "approved";
  };
  final: {
    stage: string;
    status: string;
    nextAction: string;
    runStatus: string;
    laneStates: readonly {
      laneId: string;
      state: string;
    }[];
    actionTrace: readonly string[];
    workflowStages: readonly string[];
  };
};

type FixtureWorkUnit = {
  id: string;
  dependsOn: readonly string[];
  signals: {
    fileOverlap: "low" | "medium" | "high";
    coupling: "low" | "medium" | "high";
    blastRadius: "contained" | "adjacent" | "broad";
    unknownCount: number;
    testIsolation: "isolated" | "partial" | "shared";
  };
  draft: {
    objective: string;
    constraints?: readonly string[];
    acceptanceCriteria?: readonly string[];
    dependencies?: readonly {
      description: string;
      reference: string;
    }[];
    riskTags?: readonly string[];
    source: {
      kind: "ad-hoc" | "tracker";
      title: string;
      reference?: string;
      tracker?: "shortcut";
      entityType?: "story";
      id?: number;
      url?: string;
      metadata?: Readonly<Record<string, string | number>>;
    };
  };
};

export type GoldenScenarioFixture = {
  id: string;
  name: string;
  workUnits: readonly FixtureWorkUnit[];
  changedPaths?: readonly string[];
  expectedTrace: GoldenTraceExpectation;
};

const scenarios: readonly GoldenScenarioFixture[] = [
  {
    id: "single-lane-happy-path",
    name: "single-lane happy path",
    workUnits: [
      {
        id: "sc-439-single-lane",
        dependsOn: [],
        signals: {
          fileOverlap: "low",
          coupling: "low",
          blastRadius: "contained",
          unknownCount: 0,
          testIsolation: "isolated"
        },
        draft: {
          objective: "Validate a single delivery lane can reach review ready without governance drift.",
          acceptanceCriteria: [
            "The lane plan stays single-lane and auditable.",
            "The final review-ready handoff stays accepted."
          ],
          riskTags: ["workflow", "testing"],
          source: {
            kind: "tracker",
            tracker: "shortcut",
            entityType: "story",
            id: 439,
            title: "Supervisor Scenario Evals + Golden Traces",
            reference: "sc-439",
            url: "https://app.shortcut.com/tuinstradev/story/439"
          }
        }
      }
    ],
    expectedTrace: {
      scenarioId: "single-lane-happy-path",
      plan: {
        lanes: [
          {
            lane: 1,
            workUnitIds: ["sc-439-single-lane"],
            dependsOnLaneIds: []
          }
        ],
        dependencyGraph: [
          {
            id: "sc-439-single-lane",
            lane: 1,
            blockedBy: [],
            unblocks: []
          }
        ]
      },
      governance: {
        outcome: "accept",
        route: "continue",
        source: "policy-default"
      },
      final: {
        stage: "review",
        status: "ready",
        nextAction: "prepare-review",
        runStatus: "review_ready",
        laneStates: [{ laneId: "lane-1", state: "review_ready" }],
        actionTrace: ["provision-worktree", "launch-session"],
        workflowStages: ["intake", "dispatch", "dispatch", "review"]
      }
    }
  },
  {
    id: "multi-lane-dependency-path",
    name: "multi-lane dependency path",
    workUnits: [
      {
        id: "sc-439-foundation",
        dependsOn: [],
        signals: {
          fileOverlap: "medium",
          coupling: "medium",
          blastRadius: "adjacent",
          unknownCount: 1,
          testIsolation: "partial"
        },
        draft: {
          objective: "Deliver the dependency foundation lane first.",
          acceptanceCriteria: ["Foundation lane lands before follow-up validation."],
          riskTags: ["workflow", "testing"],
          source: {
            kind: "ad-hoc",
            title: "Dependency foundation lane",
            reference: "fixture:foundation"
          }
        }
      },
      {
        id: "sc-439-follow-up",
        dependsOn: ["sc-439-foundation"],
        signals: {
          fileOverlap: "low",
          coupling: "medium",
          blastRadius: "contained",
          unknownCount: 0,
          testIsolation: "isolated"
        },
        draft: {
          objective: "Validate the dependent lane only starts after the upstream lane completes.",
          dependencies: [
            {
              description: "Wait for the foundation lane to complete.",
              reference: "sc-439-foundation"
            }
          ],
          acceptanceCriteria: ["Dependent review prep stays blocked until the foundation lane completes."],
          riskTags: ["workflow", "coordination"],
          source: {
            kind: "ad-hoc",
            title: "Dependent validation lane",
            reference: "fixture:follow-up"
          }
        }
      }
    ],
    expectedTrace: {
      scenarioId: "multi-lane-dependency-path",
      plan: {
        lanes: [
          {
            lane: 1,
            workUnitIds: ["sc-439-foundation"],
            dependsOnLaneIds: []
          },
          {
            lane: 2,
            workUnitIds: ["sc-439-follow-up"],
            dependsOnLaneIds: ["lane-1"]
          }
        ],
        dependencyGraph: [
          {
            id: "sc-439-foundation",
            lane: 1,
            blockedBy: [],
            unblocks: ["sc-439-follow-up"]
          },
          {
            id: "sc-439-follow-up",
            lane: 2,
            blockedBy: ["sc-439-foundation"],
            unblocks: []
          }
        ]
      },
      governance: {
        outcome: "accept",
        route: "continue",
        source: "policy-default"
      },
      final: {
        stage: "review",
        status: "ready",
        nextAction: "prepare-review",
        runStatus: "review_ready",
        laneStates: [
          { laneId: "lane-1", state: "complete" },
          { laneId: "lane-2", state: "review_ready" }
        ],
        actionTrace: [
          "provision-worktree",
          "launch-session",
          "release-worktree",
          "provision-worktree",
          "launch-session"
        ],
        workflowStages: ["intake", "dispatch", "dispatch", "review", "dispatch", "dispatch", "review"]
      }
    }
  },
  {
    id: "failed-handoff",
    name: "failed handoff",
    workUnits: [
      {
        id: "sc-439-handoff",
        dependsOn: [],
        signals: {
          fileOverlap: "low",
          coupling: "low",
          blastRadius: "contained",
          unknownCount: 0,
          testIsolation: "isolated"
        },
        draft: {
          objective: "Keep incomplete handoff evidence from reaching review ready.",
          acceptanceCriteria: ["Review-ready stays fail-closed when required artifacts are missing."],
          riskTags: ["workflow", "handoff"],
          source: {
            kind: "ad-hoc",
            title: "Failed handoff lane",
            reference: "fixture:failed-handoff"
          }
        }
      }
    ],
    expectedTrace: {
      scenarioId: "failed-handoff",
      plan: {
        lanes: [
          {
            lane: 1,
            workUnitIds: ["sc-439-handoff"],
            dependsOnLaneIds: []
          }
        ],
        dependencyGraph: [
          {
            id: "sc-439-handoff",
            lane: 1,
            blockedBy: [],
            unblocks: []
          }
        ]
      },
      governance: {
        outcome: "repair",
        route: "repair-lane",
        source: "explicit-policy"
      },
      final: {
        stage: "dispatch",
        status: "blocked",
        nextAction: "remediate-blockers",
        runStatus: "paused",
        laneStates: [{ laneId: "lane-1", state: "active" }],
        actionTrace: ["provision-worktree", "launch-session"],
        workflowStages: ["intake", "dispatch", "dispatch", "dispatch"]
      }
    }
  },
  {
    id: "protected-path-governance-block",
    name: "protected-path governance block",
    workUnits: [
      {
        id: "sc-439-protected-path",
        dependsOn: [],
        signals: {
          fileOverlap: "medium",
          coupling: "medium",
          blastRadius: "adjacent",
          unknownCount: 1,
          testIsolation: "partial"
        },
        draft: {
          objective: "Block review-ready whenever a protected path denial appears in the trace.",
          acceptanceCriteria: ["Protected-path denials route the checkpoint to block-checkpoint."],
          riskTags: ["governance", "testing"],
          source: {
            kind: "ad-hoc",
            title: "Protected path governance lane",
            reference: "fixture:protected-path"
          }
        }
      }
    ],
    changedPaths: [
      "secrets/beta.env",
      "tests/supervisor-golden-traces.test.ts"
    ],
    expectedTrace: {
      scenarioId: "protected-path-governance-block",
      plan: {
        lanes: [
          {
            lane: 1,
            workUnitIds: ["sc-439-protected-path"],
            dependsOnLaneIds: []
          }
        ],
        dependencyGraph: [
          {
            id: "sc-439-protected-path",
            lane: 1,
            blockedBy: [],
            unblocks: []
          }
        ]
      },
      governance: {
        outcome: "block",
        route: "block-checkpoint",
        source: "explicit-policy",
        protectedPathOutcome: "deny"
      },
      final: {
        stage: "dispatch",
        status: "ready",
        nextAction: "continue-dispatch",
        runStatus: "active",
        laneStates: [{ laneId: "lane-1", state: "active" }],
        actionTrace: ["provision-worktree", "launch-session"],
        workflowStages: ["intake", "dispatch", "dispatch"]
      }
    }
  },
  {
    id: "recovery-resume",
    name: "recovery/resume",
    workUnits: [
      {
        id: "sc-439-recovery",
        dependsOn: [],
        signals: {
          fileOverlap: "medium",
          coupling: "medium",
          blastRadius: "adjacent",
          unknownCount: 1,
          testIsolation: "partial"
        },
        draft: {
          objective: "Recover a stalled lane and resume it only after explicit approval.",
          acceptanceCriteria: [
            "Recovery replaces the stalled session.",
            "Approval resumes the lane without widening automation."
          ],
          riskTags: ["recovery", "governance"],
          source: {
            kind: "ad-hoc",
            title: "Recovery and resume lane",
            reference: "fixture:recovery-resume"
          }
        }
      }
    ],
    expectedTrace: {
      scenarioId: "recovery-resume",
      plan: {
        lanes: [
          {
            lane: 1,
            workUnitIds: ["sc-439-recovery"],
            dependsOnLaneIds: []
          }
        ],
        dependencyGraph: [
          {
            id: "sc-439-recovery",
            lane: 1,
            blockedBy: [],
            unblocks: []
          }
        ]
      },
      governance: {
        outcome: "accept",
        route: "continue",
        source: "policy-default",
        approvalStatus: "approved"
      },
      final: {
        stage: "recovery",
        status: "ready",
        nextAction: "continue-dispatch",
        runStatus: "active",
        laneStates: [{ laneId: "lane-1", state: "active" }],
        actionTrace: ["provision-worktree", "launch-session", "replace-session", "resume-session"],
        workflowStages: ["intake", "dispatch", "dispatch", "recovery", "approval", "recovery"]
      }
    }
  }
];

export const supervisorGoldenTracesFixture = {
  story: {
    id: 439,
    reference: "sc-439",
    title: "Supervisor Scenario Evals + Golden Traces"
  },
  scenarios,
  releaseReadinessProof: scenarios.map((scenario) => ({
    scenario: scenario.name,
    governance: scenario.expectedTrace.governance.outcome,
    finalRunStatus: scenario.expectedTrace.final.runStatus,
    finalLaneStates: scenario.expectedTrace.final.laneStates.map((lane) => `${lane.laneId}:${lane.state}`)
  }))
} as const;
