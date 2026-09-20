# Privacy

## Default posture

Nothing leaves the machine. There is no telemetry, no analytics, no phone-home,
and no network call of any kind unless you ask for one. Two things can make an
outbound request, and both are off until asked: external scanners, which need
`--online` (see `EXTERNAL_SCANNERS.md`), and cloud sync, which is disabled by
default in every new project.

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

Opt-in, per project, off in every new project. `cecc sync` **defaults to a dry
run**: typing it out of curiosity prints the exact payload and transmits
nothing. Sending requires `--push` *and* the configuration being enabled.

```bash
cecc sync                        # build the payload, print it, send nothing
cecc sync --out payload.json     # write it to a file and read it properly
cecc sync --push                 # transmit, if preflight passes
```

A dry run performs the whole preflight and builds the real payload, so what it
shows is the bytes that would actually be sent rather than an approximation.

### What the payload carries

By default: judgements and counts. Rule id, severity, layer, category,
verification state, confidence, occurrence counts and timestamps; event and
finding totals; the integrity-chain result; the workflow stage. The project name
is **hashed**, not sent.

Never, under any setting: file contents, diffs, the agent's prompts or
reasoning, environment variables, or secrets — which are redacted at storage and
redacted again on the way out, so a field added to a finding later cannot leak
through a path nobody rechecked.

Only with `includeSourceExcerpts` set to `true`: finding titles, file paths,
commands and evidence text. Everything the payload leaves out is listed *in* the
payload, under `excluded`, so the omission is visible to whoever receives it.

### Preflight

Every refusal is a separate case with its own message, because "sync failed"
teaches nobody anything:

| Refusal | Meaning |
|---|---|
| `disabled` | `cloudSync.enabled` is false. This is the default. |
| `no-endpoint` | Enabled with no endpoint, or an unparseable one. |
| `insecure-endpoint` | The endpoint is `http`. Findings would cross the network in clear text. |
| `private-endpoint` | It points at loopback or a private range. Allowed with `--allow-private`. |
| `no-token` | `CECC_SYNC_TOKEN` is not set. |

The token is read from the environment and never from `config.json` or the
database. A credential in `.cecc/` is a credential in a directory people copy
between machines.

### Afterwards

A push writes a `sync.pushed` audit entry with the endpoint, HTTP status,
payload digest and byte count — and not the payload. It is derived data; keeping
a copy would double what is at rest for no benefit. A failure writes
`sync.failed` with the error.

## Verifying for yourself

```bash
cecc doctor                      # reports cloud sync state
cecc sync                        # prints exactly what sync would transmit
sqlite3 .cecc/cecc.db "select command from events limit 20"
```

The database is a plain SQLite file. Everything CECC knows can be inspected
with standard tools.
