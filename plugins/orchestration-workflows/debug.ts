const DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(process.env.ORCHESTRATION_WORKFLOWS_DEBUG ?? "");

export type DiagnosticsCorrelation = {
  sessionId?: string;
  runId?: string;
  laneId?: string;
};

export type DiagnosticsEnvelope = {
  kind: "orchestration-diagnostic";
  event: string;
  occurredAt: string;
  correlation?: DiagnosticsCorrelation;
  reasonCode?: string;
  remediation?: readonly string[];
  details?: Record<string, unknown>;
};

export const previewText = (text: string, max = 80) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
};

const normalizeCorrelation = (details?: Record<string, unknown>): DiagnosticsCorrelation | undefined => {
  if (!details) {
    return undefined;
  }

  const sessionValue = details.sessionId ?? details.sessionID;
  const correlation: DiagnosticsCorrelation = {};

  if (typeof sessionValue === "string" && sessionValue.trim()) {
    correlation.sessionId = sessionValue.trim();
  }

  if (typeof details.runId === "string" && details.runId.trim()) {
    correlation.runId = details.runId.trim();
  }

  if (typeof details.laneId === "string" && details.laneId.trim()) {
    correlation.laneId = details.laneId.trim();
  }

  return Object.keys(correlation).length > 0 ? correlation : undefined;
};

const normalizeRemediation = (value: unknown): readonly string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const remediation = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return remediation.length > 0 ? remediation : undefined;
};

export const buildDiagnosticsEnvelope = (
  event: string,
  details?: Record<string, unknown>
): DiagnosticsEnvelope => {
  const correlation = normalizeCorrelation(details);
  const detailPayload = details ? { ...details } : undefined;

  if (detailPayload) {
    delete detailPayload.sessionId;
    delete detailPayload.sessionID;
    delete detailPayload.runId;
    delete detailPayload.laneId;
    delete detailPayload.reasonCode;
    delete detailPayload.remediation;
  }

  const reasonCode = typeof details?.reasonCode === "string" && details.reasonCode.trim()
    ? details.reasonCode.trim()
    : undefined;
  const remediation = normalizeRemediation(details?.remediation);

  return {
    kind: "orchestration-diagnostic",
    event,
    occurredAt: new Date().toISOString(),
    correlation,
    reasonCode,
    remediation,
    details: detailPayload && Object.keys(detailPayload).length > 0 ? detailPayload : undefined
  };
};

export const debugLog = (event: string, details?: Record<string, unknown>) => {
  if (!DEBUG_ENABLED) {
    return;
  }

  console.error(`[orchestration-workflows] ${JSON.stringify(buildDiagnosticsEnvelope(event, details))}`);
};
