import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { debugLog } from "./debug";

const MEMORY_SCHEMA_VERSION = 2;
const DEFAULT_STORAGE_DIR = join(homedir(), ".local", "state", "opencode-orchestration-workflows");
const DEFAULT_STORAGE_FILE = join(DEFAULT_STORAGE_DIR, "session-memory.json");
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export type IssueStatus = "backlog" | "in_progress" | "blocked" | "done";

export type IssueCard = {
  id: string;
  title: string;
  status: IssueStatus;
  blockedReason?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type SessionIssueBoard = {
  issues: IssueCard[];
};

type StoredSessionMemory = {
  schemaVersion: number;
  sessionID: string;
  updatedAt: string;
  expiresAt: string;
  board: SessionIssueBoard;
};

type MemoryStore = {
  schemaVersion: number;
  sessions: Record<string, StoredSessionMemory>;
};

const RESET_MEMORY_REGEX = /\b(reset memory|clear memory|forget context|memory reset|clear issues|reset issues)\b/i;
const SENSITIVE_PATTERNS = [
  /(api[_\s-]*key\s*[:=]\s*)([^\s,;]+)/gi,
  /(token\s*[:=]\s*)([^\s,;]+)/gi,
  /(secret\s*[:=]\s*)([^\s,;]+)/gi,
  /(password\s*[:=]\s*)([^\s,;]+)/gi,
  /(bearer\s+)([A-Za-z0-9._-]+)/gi
];

const STATUS_LABELS: Array<{ key: IssueStatus; label: string }> = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "blocked", label: "Blocked" },
  { key: "done", label: "Done" }
];

const INFERRED_PATTERNS: Array<{ status: IssueStatus; regex: RegExp }> = [
  { status: "blocked", regex: /\b(blocked by|blocked|waiting for|cannot continue|can't continue|dependency)\b/i },
  { status: "done", regex: /\b(done|completed|fixed|resolved|shipped)\b/i },
  { status: "in_progress", regex: /\b(in progress|working on|currently doing|i will implement|starting now)\b/i },
  { status: "backlog", regex: /\b(todo|next step|follow up|open action|need to|should)\b/i }
];

const EXPLICIT_CREATE_REGEX = /\b(?:create|add|track)\s+(?:an?\s+)?(?:issue|task)\s*[:\-]?\s*(.+)$/i;
const MOVE_REGEX = /\bmove\s+(#?issue-?\d+|#\d+)\s+to\s+(backlog|in[ -]?progress|blocked|done)\b(?:\s*[:\-]\s*(.+))?/i;
const RESOLVE_REGEX = /\b(?:resolve|close|complete)\s+(#?issue-?\d+|#\d+)\b/i;
const REOPEN_REGEX = /\breopen\s+(#?issue-?\d+|#\d+)\b/i;

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

const normalizeStatus = (raw: string): IssueStatus => {
  const normalized = raw.toLowerCase().replace(/\s+/g, "_").replace(/-+/g, "_");
  if (normalized === "in_progress") {
    return "in_progress";
  }
  if (normalized === "blocked") {
    return "blocked";
  }
  if (normalized === "done") {
    return "done";
  }
  return "backlog";
};

const normalizeTitle = (value: string): string => {
  return value.toLowerCase().replace(/[`"']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
};

const parseIssueReference = (raw: string): string | null => {
  const normalized = raw.toUpperCase().trim();
  if (/^#\d+$/.test(normalized)) {
    const numeric = normalized.slice(1).padStart(4, "0");
    return `ISSUE-${numeric}`;
  }

  const compact = normalized.replace(/[^A-Z0-9]/g, "");
  if (/^ISSUE\d+$/.test(compact)) {
    return `ISSUE-${compact.replace("ISSUE", "").padStart(4, "0")}`;
  }

  return null;
};

const nextIssueID = (issues: IssueCard[]): string => {
  let max = 0;
  for (const issue of issues) {
    const match = issue.id.match(/ISSUE-(\d{4,})$/);
    if (!match) {
      continue;
    }
    const current = Number(match[1]);
    if (Number.isFinite(current) && current > max) {
      max = current;
    }
  }
  return `ISSUE-${String(max + 1).padStart(4, "0")}`;
};

const createEmptyBoard = (): SessionIssueBoard => ({ issues: [] });

const dedupeIssue = (board: SessionIssueBoard, title: string): IssueCard | null => {
  const normalized = normalizeTitle(title);
  if (!normalized) {
    return null;
  }

  for (const issue of board.issues) {
    if (normalizeTitle(issue.title) === normalized) {
      return issue;
    }
  }
  return null;
};

const upsertIssue = (board: SessionIssueBoard, title: string, status: IssueStatus, now: string): IssueCard | null => {
  const cleaned = title.trim().replace(/^[:\-\s]+/, "");
  if (!cleaned || cleaned.length < 3) {
    return null;
  }

  const existing = dedupeIssue(board, cleaned);
  if (existing) {
    if (existing.status === "done" && status !== "done") {
      return existing;
    }
    existing.status = status;
    existing.updatedAt = now;
    if (status === "done") {
      existing.resolvedAt = now;
    }
    return existing;
  }

  const issue: IssueCard = {
    id: nextIssueID(board.issues),
    title: cleaned,
    status,
    createdAt: now,
    updatedAt: now
  };
  if (status === "done") {
    issue.resolvedAt = now;
  }
  board.issues.push(issue);
  return issue;
};

const applyTransition = (
  board: SessionIssueBoard,
  issueID: string,
  status: IssueStatus,
  now: string,
  reason?: string
): boolean => {
  const issue = board.issues.find((entry) => entry.id === issueID);
  if (!issue) {
    return false;
  }

  issue.status = status;
  issue.updatedAt = now;
  if (status === "blocked") {
    issue.blockedReason = reason?.trim() || issue.blockedReason;
  } else {
    delete issue.blockedReason;
  }

  if (status === "done") {
    issue.resolvedAt = now;
  } else {
    delete issue.resolvedAt;
  }
  return true;
};

const applyExplicitCommands = (board: SessionIssueBoard, prompt: string, now: string): void => {
  const lines = prompt.split("\n").map((line) => redactSensitive(line.trim())).filter(Boolean);

  for (const line of lines) {
    const create = line.match(EXPLICIT_CREATE_REGEX);
    if (create) {
      upsertIssue(board, create[1], "backlog", now);
      continue;
    }

    const move = line.match(MOVE_REGEX);
    if (move) {
      const issueID = parseIssueReference(move[1]);
      if (!issueID) {
        continue;
      }
      applyTransition(board, issueID, normalizeStatus(move[2]), now, move[3]);
      continue;
    }

    const resolve = line.match(RESOLVE_REGEX);
    if (resolve) {
      const issueID = parseIssueReference(resolve[1]);
      if (issueID) {
        applyTransition(board, issueID, "done", now);
      }
      continue;
    }

    const reopen = line.match(REOPEN_REGEX);
    if (reopen) {
      const issueID = parseIssueReference(reopen[1]);
      if (issueID) {
        applyTransition(board, issueID, "backlog", now);
      }
    }
  }
};

const inferIssues = (board: SessionIssueBoard, prompt: string, response: string, now: string): void => {
  const combined = `${prompt}\n${response}`;
  const lines = combined.split("\n").map((line) => redactSensitive(line.trim())).filter(Boolean);
  let added = 0;

  for (const line of lines) {
    for (const pattern of INFERRED_PATTERNS) {
      if (!pattern.regex.test(line)) {
        continue;
      }
      const issue = upsertIssue(board, line, pattern.status, now);
      if (issue) {
        added += 1;
      }
      break;
    }
    if (added >= 12) {
      break;
    }
  }
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

export const getSessionMemory = async (sessionID: string): Promise<SessionIssueBoard | null> => {
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

  return {
    issues: [...session.board.issues].sort((a, b) => a.id.localeCompare(b.id))
  };
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
): Promise<SessionIssueBoard> => {
  const store = pruneExpired(await readStore());
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const expiresAt = new Date(nowDate.getTime() + getTtlMs()).toISOString();

  const board = store.sessions[sessionID]?.board ?? createEmptyBoard();
  applyExplicitCommands(board, prompt, now);
  inferIssues(board, prompt, response, now);

  board.issues.sort((a, b) => a.id.localeCompare(b.id));
  store.sessions[sessionID] = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    sessionID,
    updatedAt: now,
    expiresAt,
    board
  };

  await writeStore(store);
  debugLog("memory.persisted", {
    sessionID,
    totalIssues: board.issues.length,
    backlog: board.issues.filter((issue) => issue.status === "backlog").length,
    inProgress: board.issues.filter((issue) => issue.status === "in_progress").length,
    blocked: board.issues.filter((issue) => issue.status === "blocked").length,
    done: board.issues.filter((issue) => issue.status === "done").length
  });

  return board;
};

export const formatMemoryForPrompt = (board: SessionIssueBoard): string => {
  if (board.issues.length === 0) {
    return "";
  }

  const lines: string[] = ["", "", "[Session Issues]"];
  for (const column of STATUS_LABELS) {
    const issues = board.issues.filter((issue) => issue.status === column.key);
    if (issues.length === 0) {
      continue;
    }

    lines.push(`${column.label}:`);
    for (const issue of issues) {
      const blocked = issue.blockedReason ? ` (reason: ${issue.blockedReason})` : "";
      lines.push(`- ${issue.id} ${issue.title}${blocked}`);
    }
  }

  return lines.join("\n");
};
