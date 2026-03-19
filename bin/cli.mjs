#!/usr/bin/env node

// opencode-council installer CLI
// Zero dependencies -- Node.js stdlib only
// Cross-platform: macOS, Linux, Windows (stretch)

import { existsSync, cpSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Color helpers -- respect NO_COLOR (https://no-color.org/)
// ---------------------------------------------------------------------------

const NO_COLOR = "NO_COLOR" in process.env;

const colors = {
  green:   (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  yellow:  (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  red:     (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  cyan:    (s) => NO_COLOR ? s : `\x1b[36m${s}\x1b[0m`,
  bold:    (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:     (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

// ---------------------------------------------------------------------------
// Path resolution (anchored to repo root via import.meta.url)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const repoRoot   = resolve(__dirname, "..");

const SRC_PLUGIN_BARREL = join(repoRoot, "plugins", "orchestration-workflows.ts");
const SRC_PLUGIN_DIR    = join(repoRoot, "plugins", "orchestration-workflows");
const SRC_AGENTS_DIR    = join(repoRoot, "agents");

const DEST_BASE        = join(homedir(), ".opencode");
const DEST_PLUGINS_DIR = join(DEST_BASE, "plugins");
const DEST_AGENTS_DIR  = join(DEST_BASE, "agents");

// ---------------------------------------------------------------------------
// CLI argument parsing (minimal -- no dependencies)
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

const FLAG_HELP    = args.includes("--help") || args.includes("-h");
const FLAG_DRY_RUN = args.includes("--dry-run") || args.includes("-n");
const FLAG_FORCE   = args.includes("--force") || args.includes("-f");

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

if (FLAG_HELP) {
  console.log(`
${colors.bold("opencode-council installer")}

${colors.cyan("Usage:")}
  node bin/cli.mjs [options]

${colors.cyan("Options:")}
  --help,    -h   Show this help message
  --dry-run, -n   Preview what would be copied without writing
  --force,   -f   Skip confirmation and overwrite without prompting

${colors.cyan("What it does:")}
  Copies plugin and agent files from this repository into
  ${colors.dim(DEST_BASE)} so OpenCode can load them at startup.

  Source files:
    plugins/orchestration-workflows.ts     ${colors.dim("(barrel)")}
    plugins/orchestration-workflows/       ${colors.dim("(runtime modules)")}
    agents/*.md                            ${colors.dim("(role profiles)")}

  Destination:
    ${colors.dim(DEST_PLUGINS_DIR + "/")}
    ${colors.dim(DEST_AGENTS_DIR + "/")}

${colors.cyan("Environment:")}
  NO_COLOR   Set to disable colored output
`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------

console.log("");
console.log(colors.bold("  opencode-council installer"));
console.log(colors.dim("  ------------------------------------------"));
console.log("");

// ---------------------------------------------------------------------------
// Source validation
// ---------------------------------------------------------------------------

function validateSource(path, label) {
  if (!existsSync(path)) {
    console.error(colors.red(`  Error: ${label} not found at:`));
    console.error(colors.red(`         ${path}`));
    console.error("");
    console.error(colors.yellow("  Make sure you run this from the repository root,"));
    console.error(colors.yellow("  or that the repo checkout is complete."));
    process.exit(1);
  }
}

validateSource(SRC_PLUGIN_BARREL, "Plugin barrel file");
validateSource(SRC_PLUGIN_DIR, "Plugin directory");
validateSource(SRC_AGENTS_DIR, "Agents directory");

console.log(colors.cyan("  Source (repo):"));
console.log(`    ${colors.dim(relative(process.cwd(), SRC_PLUGIN_BARREL))}`);
console.log(`    ${colors.dim(relative(process.cwd(), SRC_PLUGIN_DIR) + "/")}`);
console.log(`    ${colors.dim(relative(process.cwd(), SRC_AGENTS_DIR) + "/")}`);
console.log("");

// ---------------------------------------------------------------------------
// Destination detection
// ---------------------------------------------------------------------------

const existingInstall = existsSync(join(DEST_PLUGINS_DIR, "orchestration-workflows.ts"))
  || existsSync(join(DEST_PLUGINS_DIR, "orchestration-workflows"));

console.log(colors.cyan("  Destination:"));
console.log(`    ${colors.dim(DEST_PLUGINS_DIR + "/")}`);
console.log(`    ${colors.dim(DEST_AGENTS_DIR + "/")}`);

if (existingInstall) {
  console.log("");
  console.log(colors.yellow("  Warning: Existing installation detected. Files will be overwritten."));
}
console.log("");

// ---------------------------------------------------------------------------
// Dry-run guard
// ---------------------------------------------------------------------------

if (FLAG_DRY_RUN) {
  console.log(colors.yellow("  Dry run -- no files will be written."));
  console.log("");
  printPlan();
  console.log(colors.yellow("  Run without --dry-run to apply changes."));
  console.log("");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Confirmation (skip with --force)
// ---------------------------------------------------------------------------

if (!FLAG_FORCE && !FLAG_DRY_RUN) {
  // In non-interactive environments (piped stdin), default to proceeding
  if (!process.stdin.isTTY) {
    // Non-interactive -- proceed silently
  } else {
    const readline = await import("node:readline");
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const answer = await new Promise((resolve) => {
      rl.question(
        colors.cyan("  Proceed with installation? [Y/n] "),
        (ans) => {
          rl.close();
          resolve(ans.trim().toLowerCase());
        }
      );
    });

    if (answer && answer !== "y" && answer !== "yes") {
      console.log("");
      console.log(colors.yellow("  Aborted."));
      console.log("");
      process.exit(0);
    }
  }

  console.log("");
}

// ---------------------------------------------------------------------------
// Copy operations
// ---------------------------------------------------------------------------

let copiedFiles = 0;
let copiedDirs  = 0;

try {
  // Ensure destination directories exist
  mkdirSync(DEST_PLUGINS_DIR, { recursive: true });
  mkdirSync(DEST_AGENTS_DIR, { recursive: true });

  // 1. Copy plugin barrel file
  const destBarrel = join(DEST_PLUGINS_DIR, "orchestration-workflows.ts");
  cpSync(SRC_PLUGIN_BARREL, destBarrel, { force: true });
  copiedFiles++;
  console.log(colors.green(`  Copied  ${colors.dim("plugins/orchestration-workflows.ts")}`));

  // 2. Copy plugin directory (recursive)
  const destPluginDir = join(DEST_PLUGINS_DIR, "orchestration-workflows");
  cpSync(SRC_PLUGIN_DIR, destPluginDir, { recursive: true, force: true });
  copiedDirs++;
  const pluginFileCount = countFiles(SRC_PLUGIN_DIR);
  copiedFiles += pluginFileCount;
  console.log(colors.green(`  Copied  ${colors.dim(`plugins/orchestration-workflows/  (${pluginFileCount} files)`)}`));

  // 3. Copy agent profile files
  const agentFiles = readdirSync(SRC_AGENTS_DIR).filter((f) => f.endsWith(".md"));
  for (const file of agentFiles) {
    cpSync(join(SRC_AGENTS_DIR, file), join(DEST_AGENTS_DIR, file), { force: true });
    copiedFiles++;
  }
  console.log(colors.green(`  Copied  ${colors.dim(`agents/  (${agentFiles.length} profiles)`)}`));

} catch (err) {
  console.error("");
  console.error(colors.red(`  Error during copy: ${err.message}`));
  if (err.path) {
    console.error(colors.red(`  Path: ${err.path}`));
  }
  console.error("");
  console.error(colors.yellow("  Check file permissions and try again."));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("");
console.log(colors.green(colors.bold("  Done!")));
console.log(colors.dim(`  ${copiedFiles} files copied to ${DEST_BASE}`));
console.log("");
console.log(colors.cyan("  Next steps:"));
console.log(`    1. Restart OpenCode`);
console.log(`    2. Try a smoke prompt:`);
console.log(colors.dim(`       @cto @dev @pm Investigate why API latency regressed this week.`));
console.log("");
console.log(colors.dim("  After pulling updates, re-run this installer to refresh."));
console.log("");

process.exit(0);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFiles(dir) {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      count += countFiles(full);
    } else {
      count++;
    }
  }
  return count;
}

function printPlan() {
  console.log(colors.cyan("  Would copy:"));
  console.log(`    ${colors.dim(relative(process.cwd(), SRC_PLUGIN_BARREL))}`);
  console.log(`      -> ${colors.dim(join(DEST_PLUGINS_DIR, "orchestration-workflows.ts"))}`);
  console.log("");
  console.log(`    ${colors.dim(relative(process.cwd(), SRC_PLUGIN_DIR) + "/  (recursive)")}`);
  console.log(`      -> ${colors.dim(join(DEST_PLUGINS_DIR, "orchestration-workflows") + "/")}`);
  console.log("");

  const agentFiles = readdirSync(SRC_AGENTS_DIR).filter((f) => f.endsWith(".md"));
  for (const file of agentFiles) {
    console.log(`    ${colors.dim(join("agents", file))}`);
    console.log(`      -> ${colors.dim(join(DEST_AGENTS_DIR, file))}`);
  }
  console.log("");
}
