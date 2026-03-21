import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as pluginEntry from "../plugins/orchestration-workflows.js";
import * as packageRoot from "../index.js";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const cliPath = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

describe("public contract guardrails", () => {
  it("keeps the package entry points stable for 0.6.x", () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name: string;
      exports: Record<string, string>;
      bin: Record<string, string>;
    };

    expect(packageJson.name).toBe("opencode-council");
    expect(packageJson.exports).toEqual({
      ".": "./index.ts",
      "./supervisor": "./plugins/orchestration-workflows-supervisor.ts"
    });
    expect(packageJson.bin).toEqual({
      "opencode-council": "bin/cli.mjs"
    });
  });

  it("plugin entry exports only the plugin factory function", () => {
    const exports = Object.keys(pluginEntry);
    expect(exports).toEqual(["AgentConversations"]);
    expect(typeof pluginEntry.AgentConversations).toBe("function");
  });

  it("package root exports the stable barrel and supervisor-only symbols stay off it", () => {
    expect(Object.keys(packageRoot).sort()).toEqual([
      "AgentConversations",
      "SUPPORTED_ROLES"
    ]);

    expect("createSupervisorDispatchPlan" in packageRoot).toBe(false);
    expect("createSupervisorExecutionWorkflow" in packageRoot).toBe(false);
    expect("DEFAULT_SUPERVISOR_POLICY_PATH" in packageRoot).toBe(false);
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
