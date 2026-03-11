import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearSessionMemory,
  formatMemoryForPrompt,
  getSessionMemory,
  persistSessionMemory,
  shouldResetSessionMemory
} from "../plugins/orchestration-workflows/memory";

let sandboxDir: string | null = null;

const setupSandbox = async () => {
  sandboxDir = await mkdtemp(join(tmpdir(), "orchestration-memory-"));
  process.env.ORCHESTRATION_WORKFLOWS_MEMORY_DIR = sandboxDir;
  process.env.ORCHESTRATION_WORKFLOWS_MEMORY_FILE = join(sandboxDir, "session-memory.json");
};

afterEach(async () => {
  delete process.env.ORCHESTRATION_WORKFLOWS_MEMORY_DIR;
  delete process.env.ORCHESTRATION_WORKFLOWS_MEMORY_FILE;
  if (sandboxDir) {
    await rm(sandboxDir, { recursive: true, force: true });
    sandboxDir = null;
  }
});

describe("session memory", () => {
  it("persists and retrieves redacted issue board entries", async () => {
    await setupSandbox();
    await persistSessionMemory(
      "s-1",
      "Goal: ship installer this week",
      "Create issue: verify release checklist\nDecision: use token=abc123 and next step: follow up with PM"
    );

    const board = await getSessionMemory("s-1");
    expect(board).not.toBeNull();
    expect(board?.issues.length).toBeGreaterThan(0);
    expect(board?.issues.some((issue) => issue.title.includes("token=[REDACTED]"))).toBe(true);
  });

  it("supports explicit memory reset phrases and clear operation", async () => {
    await setupSandbox();
    await persistSessionMemory("s-2", "create issue: test reset flow", "todo: keep state");
    expect(shouldResetSessionMemory("please reset memory before this run")).toBe(true);

    await clearSessionMemory("s-2");
    const board = await getSessionMemory("s-2");
    expect(board).toBeNull();
  });

  it("applies create/move/resolve/reopen transitions", async () => {
    await setupSandbox();
    await persistSessionMemory("s-3", "create issue: finish docs", "todo: finish docs");
    let board = await getSessionMemory("s-3");
    const issueID = board?.issues[0]?.id;
    expect(issueID).toBeTruthy();

    await persistSessionMemory("s-3", `move ${issueID} to blocked: waiting for review`, "blocked by reviewer");
    board = await getSessionMemory("s-3");
    expect(board?.issues[0]?.status).toBe("blocked");

    await persistSessionMemory("s-3", `resolve ${issueID}`, "completed");
    board = await getSessionMemory("s-3");
    expect(board?.issues[0]?.status).toBe("done");

    await persistSessionMemory("s-3", `reopen ${issueID}`, "reopened for changes");
    board = await getSessionMemory("s-3");
    expect(board?.issues[0]?.status).toBe("backlog");
  });

  it("falls back safely on schema mismatch", async () => {
    await setupSandbox();
    const file = process.env.ORCHESTRATION_WORKFLOWS_MEMORY_FILE as string;
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 999, sessions: { "s-3": { bogus: true } } }, null, 2),
      "utf-8"
    );

    const board = await getSessionMemory("s-3");
    expect(board).toBeNull();

    const prompt = formatMemoryForPrompt({ issues: [] });
    expect(prompt).toBe("");
    const content = await readFile(file, "utf-8");
    expect(content).toContain("999");
  });
});
