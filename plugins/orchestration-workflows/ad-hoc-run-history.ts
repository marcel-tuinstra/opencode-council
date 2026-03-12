import type { EvidenceLink, WorkUnit } from "./work-unit";

export type AdHocRunArtifactKind =
  | "pull-request"
  | "merge-packet"
  | "postmortem"
  | "document"
  | "other";

export type AdHocRunArtifactLink = {
  label: string;
  href: string;
  kind: AdHocRunArtifactKind;
};

export type AdHocRunHistoryRecord = {
  runId: string;
  workUnitId: string;
  objective: string;
  repo: string;
  branch: string;
  commitSet: readonly string[];
  operator: string;
  createdAt: string;
  evidenceLinks: readonly EvidenceLink[];
  relatedArtifacts: readonly AdHocRunArtifactLink[];
};

export type AdHocRunHistoryInput = {
  runId?: string;
  workUnitId: string;
  workUnit: WorkUnit;
  repo: string;
  branch: string;
  commitSet: string[];
  operator: string;
  createdAt: string;
  relatedArtifacts?: AdHocRunArtifactLink[];
};

const freezeRecord = <T extends Record<string, unknown>>(value: T): Readonly<T> => Object.freeze({ ...value });

const dedupeStrings = (items: string[]): string[] => Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));

const dedupeEvidenceLinks = (items: EvidenceLink[]): EvidenceLink[] => {
  const seen = new Set<string>();

  return items.reduce<EvidenceLink[]>((links, item) => {
    const normalized: EvidenceLink = {
      label: item.label.trim(),
      href: item.href.trim(),
      kind: item.kind
    };
    const key = `${normalized.kind ?? "other"}:${normalized.href}:${normalized.label}`;
    if (!normalized.label || !normalized.href || seen.has(key)) {
      return links;
    }

    seen.add(key);
    links.push(freezeRecord(normalized));
    return links;
  }, []);
};

const dedupeArtifacts = (items: AdHocRunArtifactLink[]): AdHocRunArtifactLink[] => {
  const seen = new Set<string>();

  return items.reduce<AdHocRunArtifactLink[]>((artifacts, item) => {
    const normalized: AdHocRunArtifactLink = {
      label: item.label.trim(),
      href: item.href.trim(),
      kind: item.kind
    };
    const key = `${normalized.kind}:${normalized.href}:${normalized.label}`;
    if (!normalized.label || !normalized.href || seen.has(key)) {
      return artifacts;
    }

    seen.add(key);
    artifacts.push(freezeRecord(normalized));
    return artifacts;
  }, []);
};

const buildRunId = (workUnitId: string, createdAt: string): string => `adhoc:${workUnitId}:${createdAt}`;

export const createAdHocRunHistoryRecord = (
  input: AdHocRunHistoryInput
): AdHocRunHistoryRecord => {
  const workUnitId = input.workUnitId.trim();
  const createdAt = input.createdAt.trim();

  return freezeRecord({
    runId: input.runId?.trim() || buildRunId(workUnitId, createdAt),
    workUnitId,
    objective: input.workUnit.objective,
    repo: input.repo.trim(),
    branch: input.branch.trim(),
    commitSet: Object.freeze(dedupeStrings(input.commitSet)),
    operator: input.operator.trim(),
    createdAt,
    evidenceLinks: Object.freeze(dedupeEvidenceLinks([...input.workUnit.evidenceLinks])),
    relatedArtifacts: Object.freeze(dedupeArtifacts([...(input.relatedArtifacts ?? [])]))
  });
};

export const linkAdHocRunArtifact = (
  record: AdHocRunHistoryRecord,
  artifact: AdHocRunArtifactLink
): AdHocRunHistoryRecord => createAdHocRunHistoryRecord({
  runId: record.runId,
  workUnitId: record.workUnitId,
  workUnit: {
    objective: record.objective,
    constraints: [],
    acceptanceCriteria: [],
    dependencies: [],
    riskTags: [],
    evidenceLinks: [...record.evidenceLinks],
    source: {
      kind: "ad-hoc",
      title: record.objective,
      metadata: {}
    }
  },
  repo: record.repo,
  branch: record.branch,
  commitSet: [...record.commitSet],
  operator: record.operator,
  createdAt: record.createdAt,
  relatedArtifacts: [...record.relatedArtifacts, artifact]
});
