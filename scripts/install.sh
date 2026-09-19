#!/usr/bin/env bash
#
# Install the Claude Code Engineering System into a project.
#
#   ./scripts/install.sh /path/to/project [--force] [--with-supabase] [--with-tests]
#
# Copies CLAUDE.md, .claude/ (rules, commands, agents, settings) and the docs/
# templates. Existing files are skipped unless --force is passed.

set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET=""
FORCE=0
WITH_SUPABASE=0
WITH_TESTS=0

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

usage() {
  cat <<'USAGE'
Usage: install.sh <target-directory> [options]

Options:
  --force           Overwrite existing files (a backup is written alongside)
  --with-supabase   Also copy supabase/ reference migrations, seed and config
  --with-tests      Also copy tests/ security test patterns
  -h, --help        Show this help

Installs:
  CLAUDE.md                 engineering constitution (always in context)
  .claude/rules/            12 rule files, loaded per task
  .claude/commands/         8 slash commands
  .claude/agents/           security-reviewer, db-reviewer
  .claude/settings.json     permission defaults
  docs/                     ARCHITECTURE, DATABASE, SECURITY, API, DEPLOYMENT,
                            DECISIONS, PROJECT_STATE, TASKS templates
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)         FORCE=1 ;;
    --with-supabase) WITH_SUPABASE=1 ;;
    --with-tests)    WITH_TESTS=1 ;;
    -h|--help)       usage; exit 0 ;;
    -*)              echo "${RED}Unknown option: $1${OFF}"; usage; exit 1 ;;
    *)               TARGET="$1" ;;
  esac
  shift
done

[[ -n "$TARGET" ]] || { echo "${RED}Error: target directory required${OFF}"; usage; exit 1; }
[[ -d "$TARGET" ]] || { echo "${RED}Error: '$TARGET' is not a directory${OFF}"; exit 1; }

TARGET="$(cd "$TARGET" && pwd)"
[[ "$TARGET" != "$SRC" ]] || { echo "${RED}Error: target is the system repo itself${OFF}"; exit 1; }

COPIED=0; SKIPPED=0; BACKED_UP=0

copy_file() {
  local rel="$1" from="$SRC/$1" to="$TARGET/$1"
  [[ -f "$from" ]] || return 0
  mkdir -p "$(dirname "$to")"

  if [[ -e "$to" ]]; then
    if [[ $FORCE -eq 1 ]]; then
      cp "$to" "$to.bak.$(date +%Y%m%d%H%M%S)"
      cp "$from" "$to"
      echo "  ${YELLOW}overwrote${OFF} $rel ${YELLOW}(backup written)${OFF}"
      COPIED=$((COPIED+1)); BACKED_UP=$((BACKED_UP+1))
    else
      echo "  ${YELLOW}skipped${OFF}   $rel (exists)"
      SKIPPED=$((SKIPPED+1))
    fi
  else
    cp "$from" "$to"
    echo "  ${GREEN}installed${OFF} $rel"
    COPIED=$((COPIED+1))
  fi
}

copy_tree() {
  local dir="$1"
  [[ -d "$SRC/$dir" ]] || return 0
  while IFS= read -r f; do
    copy_file "${f#"$SRC/"}"
  done < <(find "$SRC/$dir" -type f ! -name '.gitkeep' | sort)
}

echo
echo "${BOLD}Claude Code Engineering System${OFF}"
echo "  source: $SRC"
echo "  target: $TARGET"
[[ $FORCE -eq 1 ]] && echo "  ${YELLOW}--force: existing files will be overwritten (backups kept)${OFF}"
echo

echo "${BOLD}Constitution${OFF}"
copy_file "CLAUDE.md"

echo "${BOLD}Rules${OFF}"
copy_tree ".claude/rules"

echo "${BOLD}Commands${OFF}"
copy_tree ".claude/commands"

echo "${BOLD}Agents${OFF}"
copy_tree ".claude/agents"

echo "${BOLD}Settings${OFF}"
copy_file ".claude/settings.json"

echo "${BOLD}Docs${OFF}"
copy_tree "docs"

if [[ $WITH_SUPABASE -eq 1 ]]; then
  echo "${BOLD}Supabase reference${OFF}"
  copy_tree "supabase"
fi

if [[ $WITH_TESTS -eq 1 ]]; then
  echo "${BOLD}Test patterns${OFF}"
  copy_tree "tests"
fi

if [[ ! -f "$TARGET/.env.example" ]]; then
  copy_file ".env.example"
fi

echo
echo "${BOLD}Done.${OFF} $COPIED installed, $SKIPPED skipped, $BACKED_UP backed up."
echo
echo "${BOLD}Next:${OFF}"
echo "  1. Edit CLAUDE.md — replace the default stack with this project's actual stack"
echo "  2. Fill docs/ARCHITECTURE.md, docs/SECURITY.md, docs/DATABASE.md with real content"
echo "  3. Delete rule files that do not apply (they cost tokens every session)"
echo "  4. Run: claude  →  /init-project  (new project)  or  /audit  (existing)"
echo

if ! grep -qs '^\.env$' "$TARGET/.gitignore" 2>/dev/null; then
  echo "${RED}Warning:${OFF} .env is not gitignored in the target. Add it before committing."
fi
