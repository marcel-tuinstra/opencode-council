#!/bin/sh
# opencode-council installer v0.4.0
# Install orchestration-workflows plugin + agent files for OpenCode.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/marcel-tuinstra/opencode-council/v0.4.0/install.sh | bash
#   # — or —
#   curl -fsSL https://raw.githubusercontent.com/marcel-tuinstra/opencode-council/v0.4.0/install.sh -o install.sh
#   bash install.sh
#
# Environment variables:
#   NO_COLOR=1   Disable colored output
#   OPENCODE_DIR Override install directory (default: ~/.opencode)

set -e

# ─── Constants ───────────────────────────────────────────────────────────────

VERSION="0.4.0"
REF="v${VERSION}"
REPO_URL="https://github.com/marcel-tuinstra/opencode-council.git"
RAW_BASE="https://raw.githubusercontent.com/marcel-tuinstra/opencode-council/${REF}"
INSTALL_DIR="${OPENCODE_DIR:-$HOME/.opencode}"

# ─── File manifests ──────────────────────────────────────────────────────────

BARREL_FILE="plugins/orchestration-workflows.ts"

MODULE_DIR="plugins/orchestration-workflows"
MODULE_FILES="
index.ts
ad-hoc-run-history.ts
approval-gates.ts
budget.ts
budget-governance.ts
compact.ts
constants.ts
contracts.ts
data-lifecycle.ts
debug.ts
durable-state-store.ts
governance-policy.ts
guardrail-thresholds.ts
intent.ts
lane-contract.ts
lane-decomposition.ts
lane-lifecycle.ts
lane-plan.ts
lane-worktree-provisioner.ts
mcp.ts
merge-policy.ts
observability-dashboard.ts
output.ts
path-policy.ts
protected-path-policy.ts
reason-codes.ts
recovery-repair-playbooks.ts
review-coordination.ts
review-ready-packet.ts
roles.ts
session-runtime-adapter.ts
session.ts
supervisor-bootstrap.ts
supervisor-config.ts
supervisor-delegation.ts
supervisor-dispatch-planning.ts
supervisor-execution-workflow.ts
supervisor-goal-plan.ts
supervisor-routing.ts
supervisor-scheduler.ts
turn-ownership.ts
types.ts
work-unit.ts
"

AGENTS_DIR="agents"
AGENT_FILES="
be.md
ceo.md
cto.md
dev.md
fe.md
marketing.md
pm.md
po.md
research.md
ux.md
"

# ─── Color helpers ───────────────────────────────────────────────────────────

setup_colors() {
  if [ -n "${NO_COLOR:-}" ] || [ ! -t 1 ]; then
    RED=""
    GREEN=""
    YELLOW=""
    BLUE=""
    BOLD=""
    DIM=""
    RESET=""
  else
    RED="\033[0;31m"
    GREEN="\033[0;32m"
    YELLOW="\033[0;33m"
    BLUE="\033[0;34m"
    BOLD="\033[1m"
    DIM="\033[2m"
    RESET="\033[0m"
  fi
}

# ─── Output helpers ──────────────────────────────────────────────────────────

info()    { printf "%b\n" "${BLUE}${1}${RESET}"; }
success() { printf "%b\n" "${GREEN}${1}${RESET}"; }
warn()    { printf "%b\n" "${YELLOW}${1}${RESET}"; }
error()   { printf "%b\n" "${RED}${1}${RESET}" >&2; }
dim()     { printf "%b"   "${DIM}${1}${RESET}"; }

# Print a padded status line: label on the left, status on the right.
# Usage: status_line "label text" "status"
status_line() {
  _label="$1"
  _status="$2"
  # Pad label to 50 chars for alignment
  printf "  %-50s %b\n" "$_label" "${GREEN}${_status}${RESET}"
}

die() {
  error "Error: $1"
  exit 1
}

# ─── Pipe detection ──────────────────────────────────────────────────────────

is_piped() {
  [ ! -t 0 ]
}

# ─── Prerequisite checks ────────────────────────────────────────────────────

HAS_CURL=0
HAS_GIT=0
DOWNLOAD_METHOD=""

check_prerequisites() {
  if command -v curl >/dev/null 2>&1; then
    HAS_CURL=1
  fi
  if command -v git >/dev/null 2>&1; then
    HAS_GIT=1
  fi

  if [ "$HAS_CURL" -eq 0 ] && [ "$HAS_GIT" -eq 0 ]; then
    die "Neither 'curl' nor 'git' found. Please install one and try again."
  fi

  # Prefer curl (lighter, no temp dir needed)
  if [ "$HAS_CURL" -eq 1 ]; then
    DOWNLOAD_METHOD="curl"
  else
    DOWNLOAD_METHOD="git"
  fi
}

# ─── Existing install detection ──────────────────────────────────────────────

check_existing_install() {
  if [ -f "${INSTALL_DIR}/${BARREL_FILE}" ]; then
    if is_piped; then
      warn "Existing install detected — refreshing."
      return 0
    fi
    printf "%b" "${YELLOW}Existing install detected at ${INSTALL_DIR}.${RESET}\n"
    printf "Refresh files? [Y/n] "
    read -r _answer </dev/tty 2>/dev/null || _answer="y"
    case "$_answer" in
      [nN]|[nN][oO])
        info "Aborted."
        exit 0
        ;;
    esac
  fi
}

# ─── Directory setup ─────────────────────────────────────────────────────────

create_directories() {
  mkdir -p "${INSTALL_DIR}/${MODULE_DIR}"
  mkdir -p "${INSTALL_DIR}/${AGENTS_DIR}"
}

# ─── Prune stale files ───────────────────────────────────────────────────────
# Remove .ts files from the module directory that are not in MODULE_FILES.
# Agent files are left alone — other plugins may own their own agent .md files.

prune_stale_module_files() {
  _prune_dir="${INSTALL_DIR}/${MODULE_DIR}"
  _pruned=0

  # Nothing to prune if directory doesn't exist yet
  [ -d "$_prune_dir" ] || return 0

  for _existing in "$_prune_dir"/*.ts; do
    # Guard against the literal glob when no files match
    [ -e "$_existing" ] || continue

    _base="$(basename "$_existing")"
    _keep=0
    for _m in ${MODULE_FILES}; do
      if [ "$_base" = "$_m" ]; then
        _keep=1
        break
      fi
    done

    if [ "$_keep" -eq 0 ]; then
      rm -f "$_existing"
      _pruned=$(( _pruned + 1 ))
    fi
  done

  if [ "$_pruned" -gt 0 ]; then
    status_line "Pruned stale files from ${MODULE_DIR}/" "${YELLOW}${_pruned} removed${RESET}"
  fi
}

# ─── curl download method ───────────────────────────────────────────────────

download_with_curl() {
  _fail=0

  # 1. Barrel export file
  printf "  %-50s " "${BARREL_FILE}"
  if curl -fsSL "${RAW_BASE}/${BARREL_FILE}" -o "${INSTALL_DIR}/${BARREL_FILE}" 2>/dev/null; then
    printf "%b\n" "${GREEN}done${RESET}"
  else
    printf "%b\n" "${RED}FAIL${RESET}"
    _fail=$(( _fail + 1 ))
  fi

  # 2. Module directory files
  _mod_ok=0
  _mod_total=0
  for _f in ${MODULE_FILES}; do
    _mod_total=$(( _mod_total + 1 ))
    if curl -fsSL "${RAW_BASE}/${MODULE_DIR}/${_f}" -o "${INSTALL_DIR}/${MODULE_DIR}/${_f}" 2>/dev/null; then
      _mod_ok=$(( _mod_ok + 1 ))
    else
      _fail=$(( _fail + 1 ))
    fi
  done
  if [ "$_mod_ok" -eq "$_mod_total" ]; then
    status_line "${MODULE_DIR}/ (${_mod_total} files)" "done"
  else
    _mod_bad=$(( _mod_total - _mod_ok ))
    status_line "${MODULE_DIR}/ (${_mod_ok}/${_mod_total} files)" "${RED}${_mod_bad} failed${RESET}"
  fi

  # 3. Agent files
  _ag_ok=0
  _ag_total=0
  for _f in ${AGENT_FILES}; do
    _ag_total=$(( _ag_total + 1 ))
    if curl -fsSL "${RAW_BASE}/${AGENTS_DIR}/${_f}" -o "${INSTALL_DIR}/${AGENTS_DIR}/${_f}" 2>/dev/null; then
      _ag_ok=$(( _ag_ok + 1 ))
    else
      _fail=$(( _fail + 1 ))
    fi
  done
  if [ "$_ag_ok" -eq "$_ag_total" ]; then
    status_line "${AGENTS_DIR}/ (${_ag_total} files)" "done"
  else
    _ag_bad=$(( _ag_total - _ag_ok ))
    status_line "${AGENTS_DIR}/ (${_ag_ok}/${_ag_total} files)" "${RED}${_ag_bad} failed${RESET}"
  fi

  if [ "$_fail" -gt 0 ]; then
    die "${_fail} file(s) failed to download. Check your network and try again."
  fi

  prune_stale_module_files
}

# ─── git download method (fallback) ─────────────────────────────────────────

download_with_git() {
  TMPDIR_GIT="$(mktemp -d 2>/dev/null || mktemp -d -t 'opencode-council')"
  trap 'rm -rf "$TMPDIR_GIT"' EXIT INT TERM

  printf "  %-50s " "Cloning repository (shallow)..."
  if git clone --depth 1 --branch "$REF" --quiet "$REPO_URL" "$TMPDIR_GIT" 2>/dev/null; then
    printf "%b\n" "${GREEN}done${RESET}"
  else
    die "Git clone failed. Check your network and try again."
  fi

  # 1. Barrel export file
  printf "  %-50s " "${BARREL_FILE}"
  if [ -f "${TMPDIR_GIT}/${BARREL_FILE}" ]; then
    cp "${TMPDIR_GIT}/${BARREL_FILE}" "${INSTALL_DIR}/${BARREL_FILE}"
    printf "%b\n" "${GREEN}done${RESET}"
  else
    printf "%b\n" "${RED}FAIL${RESET}"
    die "Barrel file not found in cloned repo."
  fi

  # 2. Module directory files
  _mod_ok=0
  _mod_total=0
  for _f in ${MODULE_FILES}; do
    _mod_total=$(( _mod_total + 1 ))
    if [ -f "${TMPDIR_GIT}/${MODULE_DIR}/${_f}" ]; then
      cp "${TMPDIR_GIT}/${MODULE_DIR}/${_f}" "${INSTALL_DIR}/${MODULE_DIR}/${_f}"
      _mod_ok=$(( _mod_ok + 1 ))
    fi
  done
  if [ "$_mod_ok" -eq "$_mod_total" ]; then
    status_line "${MODULE_DIR}/ (${_mod_total} files)" "done"
  else
    _mod_bad=$(( _mod_total - _mod_ok ))
    status_line "${MODULE_DIR}/ (${_mod_ok}/${_mod_total} files)" "${YELLOW}${_mod_bad} missing${RESET}"
  fi

  # 3. Agent files
  _ag_ok=0
  _ag_total=0
  for _f in ${AGENT_FILES}; do
    _ag_total=$(( _ag_total + 1 ))
    if [ -f "${TMPDIR_GIT}/${AGENTS_DIR}/${_f}" ]; then
      cp "${TMPDIR_GIT}/${AGENTS_DIR}/${_f}" "${INSTALL_DIR}/${AGENTS_DIR}/${_f}"
      _ag_ok=$(( _ag_ok + 1 ))
    fi
  done
  if [ "$_ag_ok" -eq "$_ag_total" ]; then
    status_line "${AGENTS_DIR}/ (${_ag_total} files)" "done"
  else
    _ag_bad=$(( _ag_total - _ag_ok ))
    status_line "${AGENTS_DIR}/ (${_ag_ok}/${_ag_total} files)" "${YELLOW}${_ag_bad} missing${RESET}"
  fi

  prune_stale_module_files

  # Cleanup happens via trap
}

# ─── Success message ─────────────────────────────────────────────────────────

print_success() {
  # Count: 1 barrel + 43 modules + 10 agents = 54
  _total=54

  echo ""
  success "${BOLD}Done!${RESET}${GREEN} ${_total} files installed to ${INSTALL_DIR}/${RESET}"
  echo ""
  info "Restart OpenCode and try:"
  printf "  %b\n" "${DIM}@cto @dev @pm Investigate why API latency regressed this week.${RESET}"
  echo ""
  dim "To update later, run this script again or use:\n"
  printf "  %b\n" "${DIM}npx opencode-council refresh${RESET}"
  echo ""
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  setup_colors

  echo ""
  printf "%b\n" "${BOLD}opencode-council installer v${VERSION}${RESET}"
  echo ""

  check_prerequisites
  check_existing_install
  create_directories

  info "Downloading from GitHub..."
  echo ""

  if [ "$DOWNLOAD_METHOD" = "curl" ]; then
    download_with_curl
  else
    download_with_git
  fi

  print_success
}

main "$@"
