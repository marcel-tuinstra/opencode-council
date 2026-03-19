#!/usr/bin/env node

// opencode-council installer CLI
// Zero dependencies -- Node.js stdlib only
// Cross-platform: macOS, Linux, Windows (stretch)

import {
  existsSync,
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

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
const DEST_PLUGIN_SUB  = join(DEST_PLUGINS_DIR, "orchestration-workflows");

// ---------------------------------------------------------------------------
// Package version (read from package.json)
// ---------------------------------------------------------------------------

const pkgJsonPath = join(repoRoot, "package.json");
const PKG_VERSION = existsSync(pkgJsonPath)
  ? JSON.parse(readFileSync(pkgJsonPath, "utf-8")).version
  : "unknown";

// ---------------------------------------------------------------------------
// Known agent manifest -- files we own (used by verify & refresh prune)
// ---------------------------------------------------------------------------

const KNOWN_AGENTS = [
  "be.md", "ceo.md", "cto.md", "dev.md", "fe.md",
  "marketing.md", "pm.md", "po.md", "research.md", "ux.md",
];

// ---------------------------------------------------------------------------
// CLI argument parsing (minimal -- no dependencies)
// ---------------------------------------------------------------------------

const rawArgs = process.argv.slice(2);

// Separate flags from positional arguments
const flags = rawArgs.filter((a) => a.startsWith("-"));
const positionalArgs = rawArgs.filter((a) => !a.startsWith("-"));

const FLAG_HELP    = flags.includes("--help") || flags.includes("-h");
const FLAG_DRY_RUN = flags.includes("--dry-run") || flags.includes("-n");
const FLAG_FORCE   = flags.includes("--force") || flags.includes("-f");
const FLAG_BACKUP  = flags.includes("--backup") || flags.includes("-b");

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp() {
  console.log(`
${colors.bold("opencode-council")} ${colors.dim(`v${PKG_VERSION}`)}

${colors.cyan("Usage:")}
  npx opencode-council <command> [options]

${colors.cyan("Commands:")}
  init        Install plugin + agent files into ~/.opencode
  refresh     Reinstall from source (prunes stale files, overwrites all)
  verify      Health-check: compare installed files against source by SHA-256
  uninstall   Remove installed plugin + agent files from ~/.opencode
  help        Show this help message

${colors.cyan("Options:")}
  --help,    -h   Show this help message
  --dry-run, -n   Preview what would happen without writing
  --force,   -f   Skip confirmation prompts
  --backup,  -b   Back up existing files before overwriting (refresh/init)
  --version, -v   Print version and exit

${colors.cyan("What it does:")}
  Copies plugin and agent files from this package into
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
}

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

/** Collect all file paths under `dir` recursively (relative to `dir`). */
function collectFiles(dir, prefix = "") {
  const result = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel  = prefix ? join(prefix, entry) : entry;
    if (statSync(full).isDirectory()) {
      result.push(...collectFiles(full, rel));
    } else {
      result.push(rel);
    }
  }
  return result;
}

function sha256(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
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

/** Build the full manifest of source -> dest file pairs. */
function buildManifest() {
  const manifest = [];

  // 1. Barrel file
  manifest.push({
    src:  SRC_PLUGIN_BARREL,
    dest: join(DEST_PLUGINS_DIR, "orchestration-workflows.ts"),
    label: "plugins/orchestration-workflows.ts",
  });

  // 2. Plugin directory files
  for (const relFile of collectFiles(SRC_PLUGIN_DIR)) {
    manifest.push({
      src:  join(SRC_PLUGIN_DIR, relFile),
      dest: join(DEST_PLUGIN_SUB, relFile),
      label: join("plugins/orchestration-workflows", relFile),
    });
  }

  // 3. Agent files
  const agentFiles = readdirSync(SRC_AGENTS_DIR).filter((f) => f.endsWith(".md"));
  for (const file of agentFiles) {
    manifest.push({
      src:  join(SRC_AGENTS_DIR, file),
      dest: join(DEST_AGENTS_DIR, file),
      label: join("agents", file),
    });
  }

  return manifest;
}

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

function validateSources() {
  validateSource(SRC_PLUGIN_BARREL, "Plugin barrel file");
  validateSource(SRC_PLUGIN_DIR, "Plugin directory");
  validateSource(SRC_AGENTS_DIR, "Agents directory");
}

function printBanner() {
  console.log("");
  console.log(colors.bold("  opencode-council") + " " + colors.dim(`v${PKG_VERSION}`));
  console.log(colors.dim("  ------------------------------------------"));
  console.log("");
}

function printSources() {
  console.log(colors.cyan("  Source (repo):"));
  console.log(`    ${colors.dim(relative(process.cwd(), SRC_PLUGIN_BARREL))}`);
  console.log(`    ${colors.dim(relative(process.cwd(), SRC_PLUGIN_DIR) + "/")}`);
  console.log(`    ${colors.dim(relative(process.cwd(), SRC_AGENTS_DIR) + "/")}`);
  console.log("");
}

function printDestinations() {
  console.log(colors.cyan("  Destination:"));
  console.log(`    ${colors.dim(DEST_PLUGINS_DIR + "/")}`);
  console.log(`    ${colors.dim(DEST_AGENTS_DIR + "/")}`);
  console.log("");
}

/** Ask the user a yes/no question. Returns true if confirmed. */
async function confirm(message) {
  if (!process.stdin.isTTY) {
    // Non-interactive -- proceed silently
    return true;
  }

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((res) => {
    rl.question(message, (ans) => {
      rl.close();
      res(ans.trim().toLowerCase());
    });
  });

  return !answer || answer === "y" || answer === "yes";
}

/** Create .bak copies of every destination file that exists. */
function backupExisting(manifest) {
  let backed = 0;
  for (const { dest } of manifest) {
    if (existsSync(dest)) {
      const bakPath = dest + ".bak";
      cpSync(dest, bakPath, { force: true });
      backed++;
    }
  }
  return backed;
}

/**
 * Delete the plugin subdir to prune stale files.
 * The barrel file is overwritten in place (no prune needed for a single file).
 */
function prunePluginDir(dryRun) {
  if (existsSync(DEST_PLUGIN_SUB)) {
    if (dryRun) {
      console.log(colors.yellow(`  Would delete ${colors.dim(DEST_PLUGIN_SUB + "/")} (prune stale files)`));
    } else {
      rmSync(DEST_PLUGIN_SUB, { recursive: true, force: true });
      console.log(colors.yellow(`  Pruned  ${colors.dim(DEST_PLUGIN_SUB + "/")}`));
    }
  }
}

// ---------------------------------------------------------------------------
// Command: version
// ---------------------------------------------------------------------------

function cmdVersion() {
  console.log(`opencode-council v${PKG_VERSION}`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Command: help
// ---------------------------------------------------------------------------

function cmdHelp() {
  printHelp();
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Command: verify
// ---------------------------------------------------------------------------

function cmdVerify() {
  printBanner();
  validateSources();
  printSources();
  printDestinations();

  const manifest = buildManifest();
  let ok = 0;
  let missing = 0;
  let mismatch = 0;

  console.log(colors.cyan(`  Verifying ${manifest.length} files...\n`));

  for (const { src, dest, label } of manifest) {
    if (!existsSync(dest)) {
      console.log(colors.red(`  MISSING  ${colors.dim(label)}`));
      missing++;
      continue;
    }

    const srcHash  = sha256(src);
    const destHash = sha256(dest);

    if (srcHash !== destHash) {
      console.log(colors.yellow(`  CHANGED  ${colors.dim(label)}`));
      mismatch++;
    } else {
      ok++;
    }
  }

  console.log("");
  console.log(colors.dim("  ------------------------------------------"));
  console.log(`  Total: ${manifest.length}   ` +
    colors.green(`OK: ${ok}`) + "   " +
    (mismatch > 0 ? colors.yellow(`Changed: ${mismatch}`) : `Changed: ${mismatch}`) + "   " +
    (missing > 0 ? colors.red(`Missing: ${missing}`) : `Missing: ${missing}`));
  console.log("");

  if (missing === 0 && mismatch === 0) {
    console.log(colors.green(colors.bold("  All files match. Installation is healthy.")));
  } else {
    console.log(colors.yellow("  Run `npx opencode-council refresh` to repair."));
  }
  console.log("");

  process.exit(missing > 0 || mismatch > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Command: uninstall
// ---------------------------------------------------------------------------

async function cmdUninstall() {
  printBanner();

  console.log(colors.cyan("  This will remove:"));
  console.log(`    ${colors.dim(join(DEST_PLUGINS_DIR, "orchestration-workflows.ts"))}`);
  console.log(`    ${colors.dim(DEST_PLUGIN_SUB + "/")}`);
  for (const agent of KNOWN_AGENTS) {
    console.log(`    ${colors.dim(join(DEST_AGENTS_DIR, agent))}`);
  }
  console.log("");

  if (FLAG_DRY_RUN) {
    console.log(colors.yellow("  Dry run -- no files will be removed."));
    console.log("");
    process.exit(0);
  }

  // Confirmation (skip with --force or non-TTY)
  if (!FLAG_FORCE) {
    const yes = await confirm(colors.cyan("  Proceed with uninstall? [Y/n] "));
    if (!yes) {
      console.log("");
      console.log(colors.yellow("  Aborted."));
      console.log("");
      process.exit(0);
    }
    console.log("");
  }

  const t0 = Date.now();
  let removed = 0;

  // Remove barrel file
  const barrelDest = join(DEST_PLUGINS_DIR, "orchestration-workflows.ts");
  if (existsSync(barrelDest)) {
    rmSync(barrelDest, { force: true });
    removed++;
    console.log(colors.green(`  Removed ${colors.dim("plugins/orchestration-workflows.ts")}`));
  }

  // Remove plugin subdir
  if (existsSync(DEST_PLUGIN_SUB)) {
    const count = countFiles(DEST_PLUGIN_SUB);
    rmSync(DEST_PLUGIN_SUB, { recursive: true, force: true });
    removed += count;
    console.log(colors.green(`  Removed ${colors.dim("plugins/orchestration-workflows/  (" + count + " files)")}`));
  }

  // Remove our known agents only
  let agentCount = 0;
  for (const agent of KNOWN_AGENTS) {
    const dest = join(DEST_AGENTS_DIR, agent);
    if (existsSync(dest)) {
      rmSync(dest, { force: true });
      removed++;
      agentCount++;
    }
  }
  if (agentCount > 0) {
    console.log(colors.green(`  Removed ${colors.dim("agents/  (" + agentCount + " profiles)")}`));
  }

  const elapsed = Date.now() - t0;
  console.log("");
  console.log(colors.green(colors.bold("  Uninstalled.")));
  console.log(colors.dim(`  ${removed} files removed in ${elapsed}ms`));
  console.log("");

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Command: init / refresh  (shared install flow)
// ---------------------------------------------------------------------------

async function cmdInstall({ prune }) {
  const label = prune ? "refresh" : "init";
  const t0 = Date.now();

  printBanner();
  validateSources();
  printSources();

  const existingInstall = existsSync(join(DEST_PLUGINS_DIR, "orchestration-workflows.ts"))
    || existsSync(DEST_PLUGIN_SUB);

  printDestinations();

  if (existingInstall && !prune) {
    console.log(colors.yellow("  Warning: Existing installation detected. Files will be overwritten."));
    console.log("");
  }

  // Dry-run: show plan and exit
  if (FLAG_DRY_RUN) {
    console.log(colors.yellow("  Dry run -- no files will be written."));
    console.log("");
    if (prune) {
      prunePluginDir(true);
      console.log("");
    }
    printPlan();
    console.log(colors.yellow("  Run without --dry-run to apply changes."));
    console.log("");
    process.exit(0);
  }

  // Confirmation (skip with --force)
  if (!FLAG_FORCE) {
    const msg = prune
      ? colors.cyan("  Refresh will overwrite all installed files. Proceed? [Y/n] ")
      : colors.cyan("  Proceed with installation? [Y/n] ");

    const yes = await confirm(msg);
    if (!yes) {
      console.log("");
      console.log(colors.yellow("  Aborted."));
      console.log("");
      process.exit(0);
    }
    console.log("");
  }

  // --backup: back up existing files before touching anything
  const manifest = buildManifest();
  if (FLAG_BACKUP) {
    const backed = backupExisting(manifest);
    if (backed > 0) {
      console.log(colors.dim(`  Backed up ${backed} existing files (.bak)`));
      console.log("");
    }
  }

  // Prune stale files (refresh & init both get a clean plugin dir)
  prunePluginDir(false);

  // Copy
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
    cpSync(SRC_PLUGIN_DIR, DEST_PLUGIN_SUB, { recursive: true, force: true });
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

  // Summary
  const elapsed = Date.now() - t0;
  console.log("");
  console.log(colors.green(colors.bold("  Done!")));
  console.log(colors.dim(`  ${copiedFiles} files copied to ${DEST_BASE} in ${elapsed}ms`));
  console.log("");
  console.log(colors.cyan("  Next steps:"));
  console.log(`    1. Restart OpenCode`);
  console.log(`    2. Try a smoke prompt:`);
  console.log(colors.dim(`       @cto @dev @pm Investigate why API latency regressed this week.`));
  console.log("");

  if (prune) {
    console.log(colors.dim("  Stale files have been pruned. Installation is up to date."));
  } else {
    console.log(colors.dim("  After pulling updates, run `npx opencode-council refresh` to sync."));
  }
  console.log("");

  process.exit(0);
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

const command = positionalArgs[0] || null;

// Handle --version / -v anywhere in args (even without a command)
if (flags.includes("--version") || flags.includes("-v")) {
  cmdVersion();
}

// Handle --help / -h anywhere in args
if (FLAG_HELP) {
  cmdHelp();
}

switch (command) {
  case "init":
    await cmdInstall({ prune: true });
    break;

  case "refresh":
    await cmdInstall({ prune: true });
    break;

  case "verify":
    cmdVerify();
    break;

  case "uninstall":
    await cmdUninstall();
    break;

  case "help":
    cmdHelp();
    break;

  case null:
    // Bare `npx opencode-council` with no command -- show help
    printHelp();
    process.exit(0);
    break;

  default:
    console.error(colors.red(`  Unknown command: "${command}"`));
    console.error("");
    printHelp();
    process.exit(1);
}
