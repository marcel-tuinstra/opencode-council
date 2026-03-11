const DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(process.env.ORCHESTRATION_WORKFLOWS_DEBUG ?? "");

export const previewText = (text: string, max = 80) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}...`;
};

export const debugLog = (event: string, details?: Record<string, unknown>) => {
  if (!DEBUG_ENABLED) {
    return;
  }

  const payload = details ? ` ${JSON.stringify(details)}` : "";
  console.error(`[orchestration-workflows] ${event}${payload}`);
};
