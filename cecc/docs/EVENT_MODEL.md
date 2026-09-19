# Event model

## The event

```ts
interface CeccEvent {
  id: string;              // uuid
  seq: number;             // monotonic, assigned by the store
  timestamp: string;       // ISO-8601
  projectId: string;
  sessionId: string;
  workflowRunId: string | null;
  agentId: string | null;  // 'claude-code'; null for CECC's own events
  source: EventSource;     // agent | user | git | test | build | security | filesystem | system | cecc
  type: EventType;
  severity: Severity;      // info | low | medium | high | critical
  status: EventStatus;     // started | success | failed | blocked | warning
  command: string | null;  // redacted before storage
  tool: string | null;
  filePaths: string[];
  metadata: Record<string, unknown>;  // redacted recursively
  evidence: Evidence[];
  durationMs: number | null;
  parentEventId: string | null;
  contentHash: string | null;
  findingRuleIds: string[];           // CECC's annotation, not an observation
}
```

### Why `seq` exists

Wall-clock timestamps from concurrent hook processes are not reliably ordered,
and order is evidence: "the test was edited after it failed" is a claim about
sequence. `seq` is a SQLite autoincrement assigned at insert, so it reflects
write order regardless of clock skew.

### Why `findingRuleIds` is separate from `metadata`

Correlation patterns match on which rules fired. That annotation is written
after the event is stored, so keeping it in `metadata` would mean a legitimate
CECC update invalidated the integrity hash. It lives in its own column, excluded
from the hash, while every observed field stays immutable and covered.

## Integrity

Each event carries:

- `contentHash` — SHA-256 over a canonical serialization of the observed fields.
- `prevHash` / `chainHash` — links to the previous event in the same project.

`verifyEventChain` recomputes both. Recomputing the content hash is what makes
this useful: verifying only the linkage would prove that events were not removed
or reordered, while leaving an edit to a recorded command undetectable — which
is the most likely thing anyone would want to tamper with.

**This is tamper-evident, not tamper-proof.** Anything with write access to the
database file could recompute the whole chain. It detects casual tampering and
accidental corruption. It does not defend against an attacker who already owns
the machine, and CECC does not claim otherwise.

## Normalized content changes

Rules never see raw adapter payloads. File changes arrive as:

```ts
interface ContentChange {
  file: string;
  added: ChangedLine[];      // lines present after
  removed: ChangedLine[];    // lines present before and now gone
  fullContent?: string;
  isNewFile: boolean;
  isDeletion: boolean;
  origin: 'tool' | 'diff' | 'filesystem';
}
```

The `removed` side is what makes "a security control was deleted" detectable at
all. Most scanners read the file as it stands and ask whether the code is
insecure; that misses the case where an authorization check existed yesterday
and does not today. Because every producer — Edit tool, Write tool, git diff,
filesystem scan — fills the same shape, a rule written once works against all
of them.

`trulyRemoved()` compares normalized text, so moving or reindenting a check does
not read as deleting it.

## Event types

Lifecycle: `session.started` `session.ended` `prompt.submitted` `agent.stopped`
`agent.notification` `context.compacted`

Tools: `tool.started` `tool.completed` `tool.failed` `tool.blocked`

Files: `file.read` `file.created` `file.modified` `file.deleted`

Commands: `command.started` `command.completed` `command.failed`

Git: `git.status` `git.commit` `git.branch` `git.push`

Validation: `test.run` `lint.run` `typecheck.run` `build.run`

Analysis: `security.scan` `dependency.scan` `finding.opened` `finding.resolved`

Workflow: `workflow.stage.entered` `workflow.stage.completed`
`workflow.gate.evaluated` `task.updated`

CECC's own: `cecc.initialized` `cecc.policy.changed` `cecc.enforcement`
`cecc.integrity`

Adapters map onto this vocabulary. They do not extend it.

## Redaction

Every string entering the store passes through `redact()`. Applied at the
storage boundary rather than at call sites, because there are many producers of
evidence and one missed call site is a leak.

Secrets are masked as `[REDACTED:<length>ch:…<last4>]` — enough to correlate two
sightings of the same credential and to identify it in a provider dashboard for
rotation, without storing the value.
