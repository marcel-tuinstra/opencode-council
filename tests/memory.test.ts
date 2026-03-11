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
  it("persists and retrieves redacted memory", async () => {
    await setupSandbox();
    await persistSessionMemory(
      "s-1",
      "Goal: ship installer this week",
      "Decision: use token=abc123 and next step: follow up with PM"
    );

    const memory = await getSessionMemory("s-1");
    expect(memory).not.toBeNull();
    expect(memory?.decisions.join(" ")).toContain("token=[REDACTED]");
    expect(memory?.unresolvedTasks.length).toBeGreaterThan(0);
  });

  it("supports explicit memory reset phrases and clear operation", async () => {
    await setupSandbox();
    await persistSessionMemory("s-2", "goal: test", "decision: keep state");
    expect(shouldResetSessionMemory("please reset memory before this run")).toBe(true);

    await clearSessionMemory("s-2");
    const memory = await getSessionMemory("s-2");
    expect(memory).toBeNull();
  });

  it("falls back safely on schema mismatch", async () => {
    await setupSandbox();
    const file = process.env.ORCHESTRATION_WORKFLOWS_MEMORY_FILE as string;
    await writeFile(
      file,
      JSON.stringify({ schemaVersion: 999, sessions: { "s-3": { bogus: true } } }, null, 2),
      "utf-8"
    );

    const memory = await getSessionMemory("s-3");
    expect(memory).toBeNull();

    const prompt = formatMemoryForPrompt({ goals: [], decisions: [], constraints: [], unresolvedTasks: [] });
    expect(prompt).toBe("");
    const content = await readFile(file, "utf-8");
    expect(content).toContain("999");
  });
});
