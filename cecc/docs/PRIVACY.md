# Privacy

## Default posture

Nothing leaves the machine. There is no telemetry, no analytics, no phone-home,
and no network call of any kind unless cloud sync is explicitly enabled — which
it is not by default, and which this build does not yet implement.

All state lives in `.cecc/` inside the project:

```
.cecc/
├── cecc.db        events, findings, sessions, audit log
├── config.json    project configuration
└── policies.json  enforcement policy with integrity checksum
```

`cecc init` adds `.cecc/` to `.gitignore`. Deleting the directory removes CECC
entirely.

## What is recorded

- Tool names and their inputs (commands, file paths, edit content)
- Shell commands and truncated output
- File paths read, created, modified, deleted
- Git status, branch, commits
- Test, lint, typecheck and build results
- Findings, with evidence excerpts
- Workflow transitions and enforcement decisions
- The developer's own prompt text, truncated and redacted

## What is never recorded

- **The agent's private reasoning.** `transcript_path` is noted as present and
  never opened. Every conclusion derives from observable actions.
- **Unredacted credentials.** Every string passes `redact()` before storage.
  Secrets become `[REDACTED:<len>ch:…<last4>]` — enough to correlate sightings
  and identify a key for rotation, not enough to use.
- **Whole file contents.** Only the changed regions, capped.
- **Full command output.** Capped at 8 KB per event with truncation marked.

## Redaction details

Applied at the storage boundary, not at call sites, because there are many
producers of evidence and one missed call site is a leak. It recurses through
nested metadata. Findings about credentials quote the masked form only, so
CECC's database never becomes a second, less-protected copy of a secret.

Covered: AWS keys, GitHub tokens, Slack tokens, Stripe keys, OpenAI and
Anthropic keys, Google API keys, npm tokens, Resend keys, private key blocks,
JWTs (with Supabase `service_role` identified specifically), connection-string
passwords, and credential-shaped assignments.

Placeholders — `your-api-key-here`, `process.env.X`, `xxxx…` — are recognised
and ignored, so evidence stays readable.

## Retention

`retentionDays` in `config.json`, default 90. `pruneOldEvents` deletes events
past the window; findings are kept, since they are the durable record.

## Cloud sync

Not implemented in this build. The configuration shape exists and defaults to
disabled. When it is built, these constraints hold:

- Opt-in per project, never a default.
- Source code is never uploaded. Evidence excerpts only if
  `includeSourceExcerpts` is separately enabled.
- Redaction runs before transmission, as it already does before storage.
- The endpoint is explicit; there is no default destination.

## Verifying for yourself

```bash
cecc doctor          # reports cloud sync state
sqlite3 .cecc/cecc.db "select command from events limit 20"
```

The database is a plain SQLite file. Everything CECC knows can be inspected
with standard tools.
