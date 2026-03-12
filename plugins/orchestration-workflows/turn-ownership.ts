import type { Role } from "./types";

export type LaneTurnRole = Role | "TESTER" | "REVIEWER" | (string & {});

export type LaneTurnTransferScope = "implementation" | "test" | "review" | "release-readiness" | "docs";

export type LaneTurnOwnership = {
  laneId: string;
  activeRole: LaneTurnRole;
  writeAuthorityRole: LaneTurnRole;
  handoffHistory: LaneTurnHandoffContract[];
};

export type LaneTurnHandoffInput = {
  laneId: string;
  currentOwner: LaneTurnRole;
  nextOwner: LaneTurnRole;
  transferScope: LaneTurnTransferScope;
  transferTrigger: string;
  deltaSummary: string;
  risks: readonly string[];
  nextRequiredEvidence: readonly string[];
  evidenceAttached: readonly string[];
  openQuestions?: string[];
};

export type LaneTurnHandoffContract = LaneTurnHandoffInput & {
  openQuestions: readonly string[];
};

const assertNonEmptyValue = (value: string, field: string): string => {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Lane turn handoff requires a non-empty ${field}.`);
  }

  return normalized;
};

const normalizeEvidenceList = (values: readonly string[], field: string): string[] => {
  const normalized = values
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);

  if (normalized.length === 0) {
    throw new Error(`Lane turn handoff requires at least one ${field}.`);
  }

  return normalized;
};

export const assertLaneTurnOwner = (role: LaneTurnRole, ownership: LaneTurnOwnership): void => {
  if (ownership.activeRole !== role || ownership.writeAuthorityRole !== role) {
    throw new Error(
      `Role ${role} does not hold the active lane turn for ${ownership.laneId}; current owner is ${ownership.activeRole}.`
    );
  }
};

export const canRoleWriteToLane = (role: LaneTurnRole, ownership: LaneTurnOwnership): boolean => (
  ownership.activeRole === role && ownership.writeAuthorityRole === role
);

export const createLaneTurnHandoffContract = (input: LaneTurnHandoffInput): LaneTurnHandoffContract => ({
  laneId: assertNonEmptyValue(input.laneId, "lane id"),
  currentOwner: input.currentOwner,
  nextOwner: input.nextOwner,
  transferScope: input.transferScope,
  transferTrigger: assertNonEmptyValue(input.transferTrigger, "transfer trigger"),
  deltaSummary: assertNonEmptyValue(input.deltaSummary, "delta summary"),
  risks: normalizeEvidenceList(input.risks, "risk entry"),
  nextRequiredEvidence: normalizeEvidenceList(input.nextRequiredEvidence, "next required evidence entry"),
  evidenceAttached: normalizeEvidenceList(input.evidenceAttached, "attached evidence entry"),
  openQuestions: (input.openQuestions ?? []).map((value) => value.trim()).filter((value) => value.length > 0)
});

export const transferLaneTurn = (
  ownership: LaneTurnOwnership,
  handoffInput: LaneTurnHandoffInput
): LaneTurnOwnership => {
  const handoff = createLaneTurnHandoffContract(handoffInput);

  if (handoff.laneId !== ownership.laneId) {
    throw new Error(`Lane turn handoff lane mismatch: ${handoff.laneId} != ${ownership.laneId}`);
  }

  assertLaneTurnOwner(handoff.currentOwner, ownership);

  return {
    laneId: ownership.laneId,
    activeRole: handoff.nextOwner,
    writeAuthorityRole: handoff.nextOwner,
    handoffHistory: [...ownership.handoffHistory, handoff]
  };
};
