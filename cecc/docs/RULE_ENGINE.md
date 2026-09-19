# Rule engine

## Three security layers

CECC keeps three different problems apart, because they have different
audiences and different remedies.

| Layer | Question | Example |
|---|---|---|
| `APPLICATION` | Is the software being built vulnerable? | Authorization check removed from an endpoint |
| `AGENT` | Did the coding agent take a dangerous shortcut? | Committed with `--no-verify` |
| `CECC` | Is something attacking the monitor itself? | Policy relaxed mid-task by the agent |

Collapsing these into one list would bury the second and third categories, which
is where CECC's distinctive value is.

## Rule interface

```ts
interface Rule {
  id: string;            // stable — policies and suppressions key on it
  name: string;
  category: FindingCategory;
  layer: SecurityLayer;
  severity: Severity;
  detection: DetectionMethod;
  description: string;
  why: string;           // surfaced in the UI, not just in docs
  remediation: string;
  matches(ctx): boolean; // cheap pre-filter, runs on every event
  evaluate(ctx): RuleResult[];
}
```

Rules receive pre-normalized input: `ContentChange[]` for file changes and
`ParsedCommand` for shell commands. No rule parses a raw adapter payload, which
keeps each one short enough to audit.

## Isolation

Every rule runs inside its own try/catch. This executes in a Claude Code hook,
and an exception escaping would fail the hook and stall the agent. A rule that
throws is a bug in CECC; CECC breaking the developer's session is a worse
outcome than one missed detection, so the error is recorded and the run
continues. `cecc doctor` and `cecc scan` both report rule errors as coverage
gaps rather than swallowing them.

## The 28 agent rules

| Rule | Layer | What it catches |
|---|---|---|
| AGENT-001 | AGENT | Permission checks skipped or unrestricted mode |
| AGENT-002 | AGENT | `--no-verify`, `\|\| true`, skipped CI gates |
| AGENT-003 | AGENT | Tests disabled, deleted, or assertions weakened |
| AGENT-004 | AGENT | Swallowed errors, `@ts-ignore`, `eslint-disable`, strict off |
| AGENT-005 | APPLICATION | A security control that existed is now gone |
| AGENT-006 | APPLICATION | Hardcoded credential |
| AGENT-007 | APPLICATION | Privileged credential reachable from the browser |
| AGENT-008 | APPLICATION | RLS missing, policy gaps, unpinned `search_path` |
| AGENT-009 | APPLICATION | Tenant/role/price taken from the request |
| AGENT-010 | APPLICATION | Validation removed or absent |
| AGENT-011 | APPLICATION | Command injection |
| AGENT-012 | APPLICATION | SQL injection |
| AGENT-013 | APPLICATION | XSS |
| AGENT-014 | APPLICATION | SSRF |
| AGENT-015 | APPLICATION | Unsafe file upload |
| AGENT-016 | APPLICATION | Path traversal |
| AGENT-017 | APPLICATION | Weak or misused cryptography |
| AGENT-018 | APPLICATION | Authentication weakened |
| AGENT-019 | APPLICATION | CORS widened or origin reflected |
| AGENT-020 | APPLICATION | Webhook verification, replay window, idempotency |
| AGENT-021 | APPLICATION | Sensitive data logged |
| AGENT-022 | AGENT | Typosquats, install scripts, unpinned dependencies |
| AGENT-023 | AGENT | `curl \| bash`, `chmod 777`, broad `rm -rf` |
| AGENT-024 | AGENT | Force push, hard reset, history rewrite |
| AGENT-025 | AGENT | Production deploy without observed validation |
| AGENT-026 | APPLICATION | Configuration security regression |
| AGENT-027 | AGENT | Instructions aimed at an AI agent in repository content |
| AGENT-028 | CECC | Attempts to disable, weaken or erase CECC |

`cecc rules --id AGENT-003` prints the full rationale for any rule.

## False-positive control

Noisy security tooling gets switched off, taking the true positives with it.
Mechanisms in place:

- **Negative tests.** Every rule has at least one test asserting it stays quiet
  on legitimate code. A rule that only ever fires is indistinguishable from one
  that always fires.
- **Context gates.** `Math.random` is flagged for a reset token and not for
  retry jitter. MD5 is flagged for a security decision and not for an ETag.
- **Stack scoping.** RLS rules do not run on projects without Postgres.
  Irrelevant findings are how a tool teaches people to ignore it.
- **Removal, not presence.** `trulyRemoved` ignores lines that came back in any
  form, so refactors do not read as deletions.
- **Graded confidence.** A sink with request-derived input is `LIKELY` at full
  severity; the same sink with an untraceable interpolation is `POTENTIAL` at
  reduced severity, reported rather than dropped.
- **Fingerprint dedup.** Re-detection increments `occurrences`; it does not
  create a second finding.
- **Expiring suppressions.** A suppression records who, why, and optionally
  until when, and reopens on expiry.

## Correlation patterns

Single-event rules ask "is this change dangerous?". Correlation asks a question
no single event can answer: "does this sequence tell a story that each step
hides?"

| Pattern | Sequence |
|---|---|
| CORR-001 | Security code changed → test failed → test weakened → suite passes |
| CORR-002 | Validation removed → request data reaches a database write |
| CORR-003 | Authorization changed → checkpoint reached with no test written or run |
| CORR-004 | Security control removed → committed with hooks skipped |
| CORR-005 | Identical command failed repeatedly with no file changes between |
| CORR-006 | Credential introduced → committed |

CORR-001 is the flagship. Each step is individually defensible: code changed, a
test failed, a test was updated, the suite went green. Only the sequence shows
that a failing security check was answered by changing the check. It is
invisible to any tool that looks at one diff at a time, and it is exactly how a
regression reaches production with a green dashboard.

Correlation findings are always `LIKELY`, never `VERIFIED`: CECC observed the
sequence, but whether it constitutes a defect needs human judgement. CORR-001
stays silent when production code also changed between the failure and the pass,
because that is ordinary iteration.

## Verification states

| State | Means |
|---|---|
| `VERIFIED` | Observed directly — a command ran, output was captured |
| `LIKELY` | Strong deterministic signal, small chance of a benign explanation |
| `POTENTIAL` | Pattern matched; requires human judgement |
| `INFORMATIONAL` | Worth knowing, not necessarily a problem |
| `NOT_TESTED` | The check exists but never executed here |
| `BLOCKED` | Could not be evaluated; reason recorded |
| `UNKNOWN` | — |

Every finding and every gate carries one. The distinction that matters most:
`NOT_TESTED` is not `VERIFIED`, and "no findings" is not "secure".
