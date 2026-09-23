# Threat model

CECC is itself security-sensitive: it parses untrusted payloads, reads
repository content written by anyone with commit access, and runs inside the
developer's agent loop. This document states what it defends against, what it
does not, and why.

## Assets

- The local event store — evidence about what happened during development.
- The policy file — what CECC enforces.
- The developer's machine, credentials and source, which CECC must not expose.

## Adversaries

**A coding agent taking shortcuts.** Not malicious, but optimizing for a passing
test rather than a correct system. This is the primary case and the one CECC is
built around.

**Repository content written by a third party.** A README, a code comment, a
dependency description or an issue body can carry text aimed at whichever agent
reads it next. Rule AGENT-027 exists because an agent cannot reliably tell a
maintainer's note from an attacker's.

**An attacker who already controls the machine.** Out of scope. CECC runs with
the developer's privileges; anyone at that level can stop it.

## Trust boundaries

```
hook payload  ──[untrusted]──►  adapter (schema-validated, tolerant)
repo content  ──[untrusted]──►  rules (data only, never instructions)
policy file   ──[integrity-checked]──►  enforcement
event store   ──[hash-chained]──►  reporting
renderer      ──[untrusted]──►  terminal socket (keystrokes only, fixed program)
```

## Defences

| Threat | Defence | Verified by |
|---|---|---|
| Malformed or hostile payload crashes the hook | Permissive schema, every path wrapped, hook always exits 0 | `adversarial.test.ts` |
| Credential captured into the event store | Redaction at the storage boundary, recursive through metadata | `storage.test.ts`, `secrets.test.ts` |
| Event log edited to hide a bypass | Per-event content hash plus chain linkage, both recomputed on verify | `storage.test.ts` |
| Event deleted to hide a step | Chain linkage breaks | `storage.test.ts` |
| Policy relaxed to suppress a finding | Checksum over policy content; mismatch reported by `cecc doctor`; AGENT-028 fires | `engines.test.ts` |
| Agent disables hooks or deletes the store | AGENT-028, layer `CECC`, critical | `rules.security.test.ts` |
| Repository text redirects the agent | AGENT-027; repository content is data, never configuration | `adversarial.test.ts` |
| A rule crashes and silently reduces coverage | Per-rule isolation; errors surfaced by `doctor` and `scan` | `adversarial.test.ts` |
| CECC's own evidence becomes a credential store | Findings quote masked values only | `rules.security.test.ts` |
| Another local process attaches to the embedded terminal | Loopback bind, random port, 32-byte token compared in constant time, Origin pinned to the dashboard | `terminal` section below |
| The dashboard page asks the terminal to run an arbitrary command | It cannot name one: the program, its arguments and its cwd are chosen in the main process | `terminal` section below |

## Accepted limitations

These are design decisions, not oversights.

**Tamper-evident, not tamper-proof.** The hash chain detects casual tampering
and corruption. Anything with write access to `.cecc/cecc.db` could rebuild it.
Defending further would need an append-only store outside the developer's
control, which contradicts local-first.

**Fails open on timeout.** If analysis exceeds its deadline the action proceeds
and the gap is recorded. Failing closed would stall the agent on a slow
machine; a monitor that freezes the workflow gets uninstalled, and an
uninstalled monitor detects nothing.

**Observes only what the agent does through its tools.** Work in another
terminal is invisible until `cecc scan` or a git-derived event picks it up.

**Does not read the agent's reasoning.** `transcript_path` is recorded as a flag
that a transcript exists and is never opened. Every conclusion comes from
actions taken, never from inferred intent. This is a deliberate product
boundary, not a technical limit.

**Static analysis, not proof.** Rules are pattern-based. They find classes of
mistake reliably and prove nothing about code they did not match.

**No sandbox around rule execution.** Rules are first-party code in the same
process. A malicious rule would have CECC's privileges, so third-party rules are
not loadable.

**The embedded terminal gives the renderer a path to a running agent.** This is
the one place the desktop window's privileges grew, and it is worth stating
plainly rather than burying.

The dashboard renders finding evidence taken from repository content, which is
untrusted. Before the terminal existed, the worst outcome of a rendering flaw
there was a defaced page: the renderer is sandboxed, has no preload bridge, and
could only talk to a local HTTP server that reads a database. It can now also
reach a WebSocket attached to a live Claude Code session, and Claude Code can
run commands. Script execution in that page therefore reaches further than it
did.

What the boundary still holds:

- **The renderer cannot choose what runs.** It sends keystrokes and a terminal
  size. The executable, its argument list and its working directory are decided
  in the main process from the project the user opened. Exposing a shell would
  have been less code and strictly worse — a page that can write
  `powershell -c …` is a page that can run anything.
- **The session is bounded by the opened project.** Changing project kills it.
  There is no message that asks for a session anywhere else on disk.
- **Reaching the socket from outside needs three things.** A loopback
  connection, the random port, and a 32-byte per-launch token compared in
  constant time, with the Origin header pinned to the dashboard's own.
- **Input is bounded.** Frames over 64KB are dropped rather than forwarded.

What it does not claim: none of this protects against the person typing into
the terminal, and none of it makes an XSS in the dashboard harmless. It makes
an XSS equivalent to sitting at the keyboard of a Claude Code session in that
one project — which is a real escalation from what it was, and the reason this
paragraph exists. Whatever that session then does is recorded by the same
hooks as any other, so it is visible on the other tabs rather than invisible.

## What "secure" would require beyond CECC

A threat model for the application itself, penetration testing, dependency
monitoring over time, and runtime protection. CECC narrows the window in which
a class of mistake survives unnoticed. It does not replace any of those.
