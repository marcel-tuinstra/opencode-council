export type WorkUnitSourceKind =
  | "shortcut-story"
  | "shortcut-epic"
  | "shortcut-objective"
  | "ad-hoc";

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

export type ShortcutWorkUnitInput = WorkUnitDraft & {
  source: {
    kind: "shortcut-story" | "shortcut-epic" | "shortcut-objective";
    id: number;
    title: string;
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

export type WorkUnitInput = ShortcutWorkUnitInput | AdHocWorkUnitInput;

const dedupe = <T>(items: T[]): T[] => Array.from(new Set(items));

const buildShortcutReference = (
  kind: ShortcutWorkUnitInput["source"]["kind"],
  id: number
): string => {
  if (kind === "shortcut-story") {
    return `sc-${id}`;
  }

  return `${kind}:${id}`;
};

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
        : buildShortcutReference(input.source.kind, input.source.id),
      url: input.source.url,
      metadata: input.source.kind === "ad-hoc"
        ? { ...(input.source.metadata ?? {}) }
        : { shortcutId: input.source.id, ...(input.source.metadata ?? {}) }
    }
  };
};
