export const supervisorAlphaEndToEndFixture = {
  epic: {
    id: 323,
    reference: "epic-323",
    title: "OpenCode Orchestration Workflows",
    url: "https://app.shortcut.com/tuinstradev/epic/323"
  },
  story: {
    id: 402,
    reference: "sc-402",
    title: "Supervisor Alpha End-to-End Validation",
    url: "https://app.shortcut.com/tuinstradev/story/402"
  },
  runId: "run-epic-323-alpha-validation",
  objective: "Validate one real supervisor Alpha run across epic 323 with planning, worktrees, sessions, approval gates, review prep, and recovery evidence.",
  lanes: [
    {
      id: "lane-delivery",
      branch: "supervisor/epic-323/delivery-foundation",
      owner: "developer-a",
      workUnitId: "epic-323-delivery-foundation"
    },
    {
      id: "lane-review",
      branch: "supervisor/epic-323/review-prep",
      owner: "developer-b",
      workUnitId: "epic-323-review-prep"
    },
    {
      id: "lane-retro",
      branch: "supervisor/epic-323/kpi-retro",
      owner: "operator-c",
      workUnitId: "epic-323-kpi-retro"
    }
  ],
  workUnits: [
    {
      id: "epic-323-delivery-foundation",
      dependsOn: [],
      signals: {
        fileOverlap: "medium",
        coupling: "medium",
        blastRadius: "adjacent",
        unknownCount: 1,
        testIsolation: "partial"
      },
      draft: {
        objective: "Prepare the real epic delivery lane and durable supervisor state for validation.",
        constraints: [
          "base branch must be epic/supervisor-alpha",
          "one focused branch per lane",
          "manual merge approval remains required"
        ],
        acceptanceCriteria: [
          "Lane planning and durable state stay reconstructable from audit data",
          "Worktree and session bindings stay lane-local"
        ],
        riskTags: ["workflow", "runtime", "testing"],
        source: {
          kind: "tracker" as const,
          tracker: "shortcut" as const,
          entityType: "story",
          id: 402,
          title: "Supervisor Alpha End-to-End Validation",
          reference: "sc-402",
          url: "https://app.shortcut.com/tuinstradev/story/402",
          metadata: {
            epicId: 323,
            pilotLane: "delivery"
          }
        }
      }
    },
    {
      id: "epic-323-review-prep",
      dependsOn: ["epic-323-delivery-foundation"],
      signals: {
        fileOverlap: "low",
        coupling: "medium",
        blastRadius: "contained",
        unknownCount: 1,
        testIsolation: "isolated"
      },
      draft: {
        objective: "Package review-ready evidence, approval state, and tracker links for the pilot lane.",
        dependencies: [
          {
            description: "Wait for the delivery lane to complete its active execution path.",
            reference: "epic-323-delivery-foundation"
          }
        ],
        acceptanceCriteria: [
          "One approval gate is recorded before merge",
          "PR prep stays linked to the originating run and Shortcut story"
        ],
        riskTags: ["workflow", "review"],
        source: {
          kind: "ad-hoc" as const,
          title: "Review preparation lane",
          reference: "pilot:review-prep",
          metadata: {
            epicId: 323,
            pilotLane: "review"
          }
        }
      }
    },
    {
      id: "epic-323-kpi-retro",
      dependsOn: ["epic-323-review-prep"],
      signals: {
        fileOverlap: "low",
        coupling: "low",
        blastRadius: "contained",
        unknownCount: 0,
        testIsolation: "isolated"
      },
      draft: {
        objective: "Capture KPI results and retrospective follow-ups after the pilot run is review ready.",
        dependencies: [
          {
            description: "Wait for review prep and approval evidence.",
            reference: "epic-323-review-prep"
          }
        ],
        acceptanceCriteria: [
          "KPI counts are derived from the durable run state",
          "Retrospective gaps stay concrete and reviewable"
        ],
        riskTags: ["testing", "operations"],
        source: {
          kind: "ad-hoc" as const,
          title: "KPI and retrospective lane",
          reference: "pilot:kpi-retro",
          metadata: {
            epicId: 323,
            pilotLane: "retro"
          }
        }
      }
    }
  ],
  kpiExpectations: {
    laneCount: 3,
    activeWorktreeCount: 3,
    sessionCount: 3,
    approvalCount: 1,
    recoveryEventCount: 1,
    reviewArtifactCount: 4
  },
  retrospectiveGaps: [
    "The pilot still assembles the end-to-end run in a validation harness instead of a shipped runtime command.",
    "Recovery evidence proves session replacement, but stale worktree rebuilds still rely on operator-led repair steps.",
    "KPI reporting is reconstructable from durable state, yet it is not emitted as a first-class artifact outside the test harness."
  ],
  beforeUserImpact: "No user-facing prompting, messaging, or behavior change. Alpha components existed separately, but there was no single end-to-end validation artifact proving they could run together across lanes, approval, review prep, and recovery.",
  afterUserImpact: "No user-facing prompting, messaging, or behavior change. Alpha now includes a concrete end-to-end validation harness, pilot fixture, and documentation trail for one real epic run on the existing supervisor contracts."
} as const;
