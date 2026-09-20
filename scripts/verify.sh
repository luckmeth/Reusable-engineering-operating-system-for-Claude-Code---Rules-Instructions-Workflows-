#!/usr/bin/env bash
#
# Fast pre-commit / pre-deploy checks that do not need a running app.
# Catches the mistakes that are cheapest to find with grep and most expensive
# to find in production.
#
#   ./scripts/verify.sh [project-directory]

set -uo pipefail

DIR="${1:-.}"
cd "$DIR" || exit 1

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BOLD=$'\033[1m'; OFF=$'\033[0m'
FAIL=0; WARN=0

fail() { echo "  ${RED}FAIL${OFF}  $1"; FAIL=$((FAIL+1)); }
warn() { echo "  ${YELLOW}WARN${OFF}  $1"; WARN=$((WARN+1)); }
pass() { echo "  ${GREEN}OK${OFF}    $1"; }

# Search only source, not dependencies or build output.
src_grep() {
  grep -rInE "$1" \
    --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
    --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist \
    --exclude-dir=.git --exclude-dir=coverage --exclude-dir=build \
    . 2>/dev/null
}

# Paths excluded from the pattern-shape checks, listed one substring per line
# in .verifyignore.
#
# The checks below look for the *shape* of a mistake, and a security test or a
# detection rule has to write that shape down in order to test for it. Without
# a way to say so, this script reports a suite that proves a control works as
# though the control were missing — and a checker that cries wolf on its own
# tests is one people stop running.
#
# It deliberately does not apply to the literal-credential scan further down. A
# real key committed to a test file is a real key.
VERIFY_IGNORE="${VERIFY_IGNORE:-.verifyignore}"

filter_ignored() {
  if [[ ! -f "$VERIFY_IGNORE" ]]; then cat; return; fi
  awk -v ignorefile="$VERIFY_IGNORE" '
    BEGIN {
      n = 0
      while ((getline line < ignorefile) > 0) {
        sub(/#.*/, "", line)
        gsub(/^[ \t]+|[ \t]+$/, "", line)
        if (line != "") pats[++n] = line
      }
    }
    {
      path = $0
      sub(/:.*/, "", path)
      for (i = 1; i <= n; i++) if (index(path, pats[i])) next
      print
    }
  '
}

# Prints the first few hits of a pattern-shape search, minus ignored paths.
shape_hits() {
  src_grep "$1" | filter_ignored
}

echo
echo "${BOLD}Engineering System Verification${OFF}  ($(pwd))"
if [[ -f "$VERIFY_IGNORE" ]]; then
  # Never let an exclusion be silent — a reader has to be able to see what was
  # skipped without opening the script.
  echo "  pattern-shape checks skip paths listed in ${VERIFY_IGNORE}: $(grep -cvE '^\s*(#|$)' "$VERIFY_IGNORE") entr$( [[ $(grep -cvE '^\s*(#|$)' "$VERIFY_IGNORE") -eq 1 ]] && echo y || echo ies)"
fi
echo

# ---------------------------------------------------------------------------
echo "${BOLD}Secrets${OFF}"

if [[ -f .gitignore ]] && grep -qE '^\.env$|^\.env\*' .gitignore; then
  pass ".env is gitignored"
else
  fail ".env is not gitignored"
fi

if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  fail ".env is TRACKED IN GIT — rotate every key in it, then remove from history"
else
  pass ".env is not tracked"
fi

# A service-role key or secret reachable from client code is a full data breach.
hits=$(shape_hits 'NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD)')
if [[ -n "$hits" ]]; then
  fail "secret exposed through a NEXT_PUBLIC_* variable:"
  echo "$hits" | head -5 | sed 's/^/        /'
else
  pass "no secret behind a NEXT_PUBLIC_ prefix"
fi

# Long base64-ish literals assigned to key-shaped names.
if src_grep '(api[_-]?key|secret|token|password)\s*[:=]\s*["'"'"'][A-Za-z0-9+/_-]{24,}' >/dev/null; then
  warn "possible hardcoded credential:"
  src_grep '(api[_-]?key|secret|token|password)\s*[:=]\s*["'"'"'][A-Za-z0-9+/_-]{24,}' | head -5 | sed 's/^/        /'
else
  pass "no obvious hardcoded credentials"
fi

if [[ -f .env.example ]]; then
  if grep -qE '=[A-Za-z0-9+/_-]{20,}' .env.example; then
    fail ".env.example contains what look like real values — it must hold names only"
  else
    pass ".env.example holds names only"
  fi
else
  warn ".env.example is missing"
fi

# ---------------------------------------------------------------------------
echo
echo "${BOLD}Database${OFF}"

if [[ -d supabase/migrations ]]; then
  # Every created table should have RLS enabled somewhere in the migrations.
  tables=$(grep -rhoiE 'create table (if not exists )?(public\.)?[a-z_]+' supabase/migrations 2>/dev/null \
           | sed -E 's/.*[. ]([a-z_]+)$/\1/' | sort -u)
  missing=""
  for t in $tables; do
    grep -rqiE "alter[[:space:]]+table[[:space:]]+(public\.)?$t[[:space:]]+enable[[:space:]]+row[[:space:]]+level[[:space:]]+security" supabase/migrations \
      || missing="$missing $t"
  done
  if [[ -n "$missing" ]]; then
    fail "tables created without RLS enabled:$missing"
  else
    pass "every created table enables RLS"
  fi

  # `using` without `with check` on UPDATE lets a row be moved out of its tenant.
  if grep -rlziE 'for update[^;]*using[^;]*;' supabase/migrations 2>/dev/null \
       | xargs -r grep -LziE 'for update[^;]*with check' | grep -q .; then
    warn "an UPDATE policy may be missing 'with check' — review supabase/migrations"
  else
    pass "UPDATE policies pair 'using' with 'with check'"
  fi
else
  warn "no supabase/migrations directory"
fi

# ---------------------------------------------------------------------------
echo
echo "${BOLD}Code patterns${OFF}"

hits=$(shape_hits 'catch\s*\([^)]*\)\s*\{\s*\}')
if [[ -n "$hits" ]]; then
  warn "empty catch block (swallowed error):"
  echo "$hits" | head -3 | sed 's/^/        /'
else
  pass "no empty catch blocks"
fi

hits=$(shape_hits 'dangerouslySetInnerHTML')
if [[ -n "$hits" ]]; then
  warn "dangerouslySetInnerHTML present — verify the content is not user-supplied:"
  echo "$hits" | head -3 | sed 's/^/        /'
else
  pass "no dangerouslySetInnerHTML"
fi

# tenant_id taken from a request body is a direct cross-tenant escalation.
hits=$(shape_hits '(body|req\.body|params|query)\.(tenant_?[Ii]d|organization_?[Ii]d)')
if [[ -n "$hits" ]]; then
  fail "tenant id read from a request — it must come from the session:"
  echo "$hits" | head -5 | sed 's/^/        /'
else
  pass "no tenant id read from request input"
fi

if [[ -f tsconfig.json ]]; then
  if grep -qE '"strict"\s*:\s*true' tsconfig.json; then
    pass "TypeScript strict mode on"
  else
    warn "TypeScript strict mode is not enabled"
  fi
fi

# ---------------------------------------------------------------------------
echo
echo "${BOLD}System files${OFF}"
for f in CLAUDE.md .claude/rules/00-core.md docs/PROJECT_STATE.md; do
  [[ -f "$f" ]] && pass "$f" || warn "$f missing"
done

# ---------------------------------------------------------------------------
echo
if [[ $FAIL -gt 0 ]]; then
  echo "${RED}${BOLD}$FAIL failure(s), $WARN warning(s).${OFF}"
  echo "These are grep heuristics, not a security audit. Run /security-audit for the real review."
  exit 1
fi
echo "${GREEN}${BOLD}No failures. $WARN warning(s).${OFF}"
echo "Heuristic checks only — run /security-audit before shipping security-sensitive changes."
