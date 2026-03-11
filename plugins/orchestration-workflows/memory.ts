import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { debugLog } from "./debug";

const MEMORY_SCHEMA_VERSION = 1;
const DEFAULT_STORAGE_DIR = join(homedir(), ".local", "state", "opencode-orchestration-workflows");
const DEFAULT_STORAGE_FILE = join(DEFAULT_STORAGE_DIR, "session-memory.json");
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

type SessionMemory = {
  goals: string[];
  decisions: string[];
  constraints: string[];
  unresolvedTasks: string[];
};

type StoredSessionMemory = {
  schemaVersion: number;
  sessionID: string;
  updatedAt: string;
  expiresAt: string;
  memory: SessionMemory;
};

type MemoryStore = {
  schemaVersion: number;
  sessions: Record<string, StoredSessionMemory>;
};

const RESET_MEMORY_REGEX = /\b(reset memory|clear memory|forget context|memory reset)\b/i;
const SENSITIVE_PATTERNS = [
  /(api[_\s-]*key\s*[:=]\s*)([^\s,;]+)/gi,
  /(token\s*[:=]\s*)([^\s,;]+)/gi,
  /(secret\s*[:=]\s*)([^\s,;]+)/gi,
  /(password\s*[:=]\s*)([^\s,;]+)/gi,
  /(bearer\s+)([A-Za-z0-9._-]+)/gi
];

const readNumber = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getTtlMs = () => {
  return readNumber(process.env.ORCHESTRATION_WORKFLOWS_MEMORY_TTL_MS, DEFAULT_TTL_MS);
};

const getStorageFile = () => {
  return process.env.ORCHESTRATION_WORKFLOWS_MEMORY_FILE ?? DEFAULT_STORAGE_FILE;
};

const getStorageDir = () => {
  return process.env.ORCHESTRATION_WORKFLOWS_MEMORY_DIR ?? DEFAULT_STORAGE_DIR;
};

const redactSensitive = (line: string): string => {
  let next = line;
  for (const pattern of SENSITIVE_PATTERNS) {
    next = next.replace(pattern, "$1[REDACTED]");
  }
  return next;
};

const unique = (items: string[]) => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
};

const extractMemory = (prompt: string, response: string): SessionMemory => {
  const combined = `${prompt}\n${response}`;
  const lines = combined.split("\n").map((line) => redactSensitive(line.trim())).filter(Boolean);

  const goals = lines.filter((line) => /\b(goal|objective|outcome|deliver)\b/i.test(line)).slice(0, 4);
  const decisions = lines.filter((line) => /\b(decision|recommend|choose|selected|conclude)\b/i.test(line)).slice(0, 4);
  const constraints = lines.filter((line) => /\b(constraint|limit|budget|risk|dependency|blocker)\b/i.test(line)).slice(0, 4);
  const unresolvedTasks = lines.filter((line) => /\b(next step|todo|follow up|open action|pending|unresolved)\b/i.test(line)).slice(0, 6);

  return {
    goals: unique(goals),
    decisions: unique(decisions),
    constraints: unique(constraints),
    unresolvedTasks: unique(unresolvedTasks)
  };
};

const readStore = async (): Promise<MemoryStore> => {
  try {
    const file = getStorageFile();
    const content = await readFile(file, "utf-8");
    const parsed = JSON.parse(content) as MemoryStore;
    if (parsed.schemaVersion !== MEMORY_SCHEMA_VERSION || !parsed.sessions) {
      debugLog("memory.schema_mismatch", {
        file,
        expected: MEMORY_SCHEMA_VERSION,
        got: parsed.schemaVersion ?? null
      });
      return { schemaVersion: MEMORY_SCHEMA_VERSION, sessions: {} };
    }
    return parsed;
  } catch {
    return { schemaVersion: MEMORY_SCHEMA_VERSION, sessions: {} };
  }
};

const writeStore = async (store: MemoryStore): Promise<void> => {
  await mkdir(getStorageDir(), { recursive: true });
  await writeFile(getStorageFile(), JSON.stringify(store, null, 2), "utf-8");
};

const pruneExpired = (store: MemoryStore): MemoryStore => {
  const now = Date.now();
  const nextSessions: Record<string, StoredSessionMemory> = {};
  for (const [sessionID, session] of Object.entries(store.sessions)) {
    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt < now) {
      continue;
    }
    nextSessions[sessionID] = session;
  }

  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    sessions: nextSessions
  };
};

export const shouldResetSessionMemory = (text: string): boolean => {
  return RESET_MEMORY_REGEX.test(text);
};

export const getSessionMemory = async (sessionID: string): Promise<SessionMemory | null> => {
  const store = pruneExpired(await readStore());
  const session = store.sessions[sessionID];
  if (!session) {
    return null;
  }

  if (session.schemaVersion !== MEMORY_SCHEMA_VERSION) {
    debugLog("memory.session_schema_mismatch", {
      sessionID,
      expected: MEMORY_SCHEMA_VERSION,
      got: session.schemaVersion
    });
    return null;
  }

  debugLog("memory.retrieved", {
    sessionID,
    updatedAt: session.updatedAt
  });
  return session.memory;
};

export const clearSessionMemory = async (sessionID: string): Promise<void> => {
  const store = pruneExpired(await readStore());
  if (store.sessions[sessionID]) {
    delete store.sessions[sessionID];
    await writeStore(store);
  }
  debugLog("memory.cleared", { sessionID });
};

export const persistSessionMemory = async (
  sessionID: string,
  prompt: string,
  response: string
): Promise<SessionMemory> => {
  const memory = extractMemory(prompt, response);
  const store = pruneExpired(await readStore());
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getTtlMs());

  store.sessions[sessionID] = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    sessionID,
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    memory
  };

  await writeStore(store);
  debugLog("memory.persisted", {
    sessionID,
    goals: memory.goals.length,
    decisions: memory.decisions.length,
    constraints: memory.constraints.length,
    unresolvedTasks: memory.unresolvedTasks.length
  });

  return memory;
};

export const formatMemoryForPrompt = (memory: SessionMemory): string => {
  const sections = [
    memory.goals.length > 0 ? `Goals: ${memory.goals.join(" | ")}` : "",
    memory.decisions.length > 0 ? `Decisions: ${memory.decisions.join(" | ")}` : "",
    memory.constraints.length > 0 ? `Constraints: ${memory.constraints.join(" | ")}` : "",
    memory.unresolvedTasks.length > 0 ? `Open Actions: ${memory.unresolvedTasks.join(" | ")}` : ""
  ].filter(Boolean);

  if (sections.length === 0) {
    return "";
  }

  return `\n\n[Session Memory]\n${sections.join("\n")}`;
};
