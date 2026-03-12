export type WorkUnitSourceKind = "tracker" | "ad-hoc";

export type WorkUnitTrackerKind =
  | "shortcut"
  | "jira"
  | "github"
  | "linear"
  | "custom";

export type EvidenceLink = {
  label: string;
  href: string;
  kind?: "pull-request" | "commit" | "document" | "ticket" | "runbook" | "other";
};

export type WorkUnitDependency = {
  description: string;
  kind?: "story" | "epic" | "objective" | "document" | "person" | "external";
  reference?: string;
};

export type WorkUnitSource = {
  kind: WorkUnitSourceKind;
  title: string;
  reference?: string;
  url?: string;
  metadata: Record<string, unknown>;
  tracker?: WorkUnitTrackerKind;
  trackerEntityType?: string;
};

export type WorkUnit = {
  objective: string;
  constraints: string[];
  acceptanceCriteria: string[];
  dependencies: WorkUnitDependency[];
  riskTags: string[];
  evidenceLinks: EvidenceLink[];
  source: WorkUnitSource;
};

type WorkUnitDraft = {
  objective?: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
  dependencies?: WorkUnitDependency[];
  riskTags?: string[];
  evidenceLinks?: EvidenceLink[];
};

export type TrackerWorkUnitInput = WorkUnitDraft & {
  source: {
    kind: "tracker";
    tracker: WorkUnitTrackerKind;
    entityType: string;
    id: string | number;
    title: string;
    reference?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
};

export type AdHocWorkUnitInput = WorkUnitDraft & {
  objective: string;
  source: {
    kind: "ad-hoc";
    title: string;
    reference?: string;
    url?: string;
    metadata?: Record<string, unknown>;
  };
};

export type WorkUnitInput = TrackerWorkUnitInput | AdHocWorkUnitInput;

const dedupe = <T>(items: T[]): T[] => Array.from(new Set(items));

const buildTrackerReference = (
  tracker: TrackerWorkUnitInput["source"]["tracker"],
  entityType: string,
  id: string | number
): string => `${tracker}:${entityType}:${id}`;

export const normalizeWorkUnit = (input: WorkUnitInput): WorkUnit => {
  const objective = input.objective?.trim() || input.source.title.trim();

  return {
    objective,
    constraints: dedupe(input.constraints ?? []),
    acceptanceCriteria: dedupe(input.acceptanceCriteria ?? []),
    dependencies: input.dependencies ?? [],
    riskTags: dedupe(input.riskTags ?? []),
    evidenceLinks: input.evidenceLinks ?? [],
      source: {
        kind: input.source.kind,
        title: input.source.title,
        reference: input.source.kind === "ad-hoc"
          ? input.source.reference
          : (input.source.reference ?? buildTrackerReference(input.source.tracker, input.source.entityType, input.source.id)),
        url: input.source.url,
        metadata: input.source.kind === "ad-hoc"
          ? { ...(input.source.metadata ?? {}) }
          : {
              tracker: input.source.tracker,
              trackerEntityType: input.source.entityType,
              trackerId: input.source.id,
              ...(input.source.metadata ?? {})
            },
        tracker: input.source.kind === "tracker" ? input.source.tracker : undefined,
        trackerEntityType: input.source.kind === "tracker" ? input.source.entityType : undefined
      }
    };
  };
