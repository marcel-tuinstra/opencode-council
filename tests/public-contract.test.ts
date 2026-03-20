import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as stableRoot from "../plugins/orchestration-workflows.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const cliPath = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

describe("public contract guardrails", () => {
  it("keeps the package entry points stable for 0.5.x", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name: string;
      exports: Record<string, string>;
      bin: Record<string, string>;
    };

    expect(packageJson.name).toBe("opencode-council");
    expect(packageJson.exports).toEqual({
      ".": "./plugins/orchestration-workflows.ts",
      "./supervisor": "./plugins/orchestration-workflows-supervisor.ts"
    });
    expect(packageJson.bin).toEqual({
      "opencode-council": "./bin/cli.mjs"
    });
  });

  it("keeps the stable root barrel frozen and supervisor-only symbols off it", () => {
    expect(Object.keys(stableRoot).sort()).toEqual([
      "AgentConversations",
      "SUPPORTED_ROLES"
    ]);

    expect("createSupervisorDispatchPlan" in stableRoot).toBe(false);
    expect("createSupervisorExecutionWorkflow" in stableRoot).toBe(false);
    expect("DEFAULT_SUPERVISOR_POLICY_PATH" in stableRoot).toBe(false);
  });

  it("keeps stable CLI command names and intents discoverable in help output", () => {
    const helpOutput = execFileSync(process.execPath, [cliPath, "--help"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    expect(helpOutput).toContain("opencode-council <command> [options]");
    expect(helpOutput).toContain("init        Install plugin + agent files into ~/.opencode");
    expect(helpOutput).toContain("refresh     Reinstall from source");
    expect(helpOutput).toContain("verify      Health-check: compare installed files against source by SHA-256");
    expect(helpOutput).toContain("uninstall   Remove installed plugin + agent files from ~/.opencode");
    expect(helpOutput).toContain("help        Show this help message");
  });
});
