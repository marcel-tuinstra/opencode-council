import type { SupervisorReasonCode } from "./reason-codes";

export type SupervisorGuardrailArea = "approval-gates" | "budget-governance" | "routing";

export type SupervisorThresholdObservedValue = string | number | boolean;

export type SupervisorThresholdEvidenceValue = SupervisorThresholdObservedValue | readonly SupervisorThresholdObservedValue[];

export type SupervisorThresholdEvidence = Readonly<Record<string, SupervisorThresholdEvidenceValue>>;

export type SupervisorThresholdEvent = {
  eventId: string;
  guardrail: SupervisorGuardrailArea;
  thresholdKey: string;
  status: "within-threshold" | "triggered";
  thresholdValue: SupervisorThresholdObservedValue;
  observedValue: SupervisorThresholdObservedValue;
  reasonCode?: SupervisorReasonCode;
  summary: string;
  evidence: SupervisorThresholdEvidence;
};

const normalizeThresholdEventSegment = (value: SupervisorThresholdObservedValue): string => String(value)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "") || "value";

export const createSupervisorThresholdEventId = (...parts: readonly SupervisorThresholdObservedValue[]): string => parts
  .map(normalizeThresholdEventSegment)
  .join(":");
