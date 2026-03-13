import { debugLog } from "./debug";
import { getSupervisorPolicy } from "./supervisor-config";
import type { Intent } from "./types";

type CompactionSlot = "goals" | "constraints" | "blockers" | "openActions";

type CompactionResult = {
  text: string;
  compacted: boolean;
  summary: string | null;
  fallbackReason: string | null;
};

const SLOT_PATTERNS: Record<CompactionSlot, RegExp> = {
  goals: /\b(goal|objective|outcome|deliver)\b/i,
  constraints: /\b(constraint|limit|budget|risk|dependency)\b/i,
  blockers: /\b(blocker|blocked|issue|incident|problem)\b/i,
  openActions: /\b(next step|todo|follow up|open action|pending|unresolved)\b/i
};

const estimateTokens = (text: string): number => {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return Math.ceil(normalized.length / 4);
};

const trimLine = (line: string): string => {
  const normalized = line.replace(/\s+/g, " ").trim();
  if (normalized.length <= 180) {
    return normalized;
  }
  return `${normalized.slice(0, 177)}...`;
};

const extractSlots = (text: string) => {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const slots: Record<CompactionSlot, string[]> = {
    goals: [],
    constraints: [],
    blockers: [],
    openActions: []
  };

  for (const line of lines) {
    for (const [slot, regex] of Object.entries(SLOT_PATTERNS) as Array<[CompactionSlot, RegExp]>) {
      if (regex.test(line)) {
        slots[slot].push(trimLine(line));
      }
    }
  }

  return slots;
};

const unique = (values: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    output.push(value);
  }
  return output;
};

const buildCompactedText = (text: string, intent: Intent, targetTokens: number): string => {
  const slots = extractSlots(text);
  const sections = [
    slots.goals.length > 0 ? `Goals: ${unique(slots.goals).slice(0, 3).join(" | ")}` : "",
    slots.constraints.length > 0 ? `Constraints: ${unique(slots.constraints).slice(0, 3).join(" | ")}` : "",
    slots.blockers.length > 0 ? `Blockers: ${unique(slots.blockers).slice(0, 3).join(" | ")}` : "",
    slots.openActions.length > 0 ? `Open Actions: ${unique(slots.openActions).slice(0, 4).join(" | ")}` : ""
  ].filter(Boolean);

  const fallbackLines = text.split("\n").map((line) => trimLine(line)).filter(Boolean).slice(0, 8);
  const header = `[Compacted Context:${intent}]`;
  let compacted = sections.length > 0
    ? `${header}\n${sections.join("\n")}`
    : `${header}\n${fallbackLines.join("\n")}`;

  while (estimateTokens(compacted) > targetTokens && compacted.length > 40) {
    compacted = `${compacted.slice(0, Math.max(40, compacted.length - 40)).trimEnd()}...`;
  }

  return compacted;
};

const hasCriticalSlotLoss = (source: string, compacted: string): boolean => {
  for (const regex of Object.values(SLOT_PATTERNS)) {
    const sourceHas = regex.test(source);
    const compactedHas = regex.test(compacted);
    if (sourceHas && !compactedHas) {
      return true;
    }
  }
  return false;
};

export const compactWorkflowContext = (text: string, intent: Intent): CompactionResult => {
  const compactionProfiles = getSupervisorPolicy().compaction;
  const profile = compactionProfiles[intent] ?? compactionProfiles.mixed;
  const sourceTokens = estimateTokens(text);
  if (sourceTokens < profile.triggerTokens) {
    return {
      text,
      compacted: false,
      summary: null,
      fallbackReason: null
    };
  }

  const compacted = buildCompactedText(text, intent, profile.targetTokens);
  const compactedTokens = estimateTokens(compacted);
  const reduction = sourceTokens - compactedTokens;
  const reductionRatio = sourceTokens > 0 ? reduction / sourceTokens : 0;

  if (compactedTokens >= sourceTokens || reductionRatio < 0.12) {
    debugLog("compaction.fallback", {
      intent,
      sourceTokens,
      compactedTokens,
      reason: "insufficient_reduction"
    });
    return {
      text,
      compacted: false,
      summary: null,
      fallbackReason: "fallback: reduction guardrail not met"
    };
  }

  if (hasCriticalSlotLoss(text, compacted)) {
    debugLog("compaction.fallback", {
      intent,
      sourceTokens,
      compactedTokens,
      reason: "critical_slot_loss"
    });
    return {
      text,
      compacted: false,
      summary: null,
      fallbackReason: "fallback: critical slots could not be preserved"
    };
  }

  const summary = `Compaction applied (${intent}): ${sourceTokens} -> ${compactedTokens} tokens; preserved goals/constraints/blockers/open actions.`;
  debugLog("compaction.applied", {
    intent,
    sourceTokens,
    compactedTokens,
    reduction,
    reductionRatio: Number(reductionRatio.toFixed(3))
  });

  return {
    text: compacted,
    compacted: true,
    summary,
    fallbackReason: null
  };
};

export const appendCompactionNotice = (text: string, notice: string | null): string => {
  if (!notice) {
    return text;
  }
  return `${text}\n\n[Compaction] ${notice}`;
};
