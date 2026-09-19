# Development

## Requirements

Node **22.5+** — CECC uses the built-in `node:sqlite` module, so there are no
native dependencies to compile. `zod` is the only runtime dependency in `core`.

## Setup

```bash
cd cecc
npm install
npm run build          # compiles core and cli to dist/
npm test               # 159 tests
```

## Layout

```
cecc/
├── packages/core/          domain layer — no UI, no process management
│   ├── src/types/          event, finding, workflow, task, policy, project
│   ├── src/analyze/        shell parser, normalized content changes
│   ├── src/storage/        SQLite, migrations, redaction, hash chain
│   ├── src/rules/agent/    the 28 detection rules
│   ├── src/correlate/      multi-event patterns
│   ├── src/workflow/       stage inference and gates
│   ├── src/adapters/       agent adapters (Claude Code is the first)
│   └── test/               159 tests
├── packages/cli/           the cecc command and the hook handler
└── apps/dashboard/         Next.js interface
```

## Running the dashboard

```bash
cd apps/dashboard
npm run build && npm start          # http://localhost:4317
CECC_PROJECT_ROOT=/path/to/project npm start   # point at another project
```

## Adding a rule

1. Add it to the appropriate file in `packages/core/src/rules/agent/`.
2. Register it in that file's exported array — registration is an import side
   effect, so a rule cannot exist without being wired in. A rule that exists but
   never runs is worse than no rule, because it reads as coverage that is not there.
3. Write **two** tests: one that it fires, one that it stays quiet on legitimate
   code. The negative test is not optional — a rule that only ever fires is
   indistinguishable from one that always fires, and noisy rules get switched off.

Rules receive pre-normalized `ContentChange[]` and `ParsedCommand`, so a rule
written once works whether the change came from an Edit tool, a Write tool, or a
git diff.

## Testing conventions

- Each test gets an isolated temp store; shared state hides ordering bugs.
- Assert on rule ids, not counts, so adding an unrelated rule cannot break an
  existing test.
- Credential-shaped fixtures are assembled at runtime (`test/helpers.ts`).
  Committing a literal token blocks the push for this repository and for
  everyone who forks it — this project learned that the first time it tried.

## Manual end-to-end check

```bash
cd /tmp && mkdir demo && cd demo && git init && node /path/to/cecc/packages/cli/dist/index.js init
printf '{"session_id":"s1","cwd":"'$PWD'","hook_event_name":"PostToolUse","tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"},"tool_response":{"exit_code":0}}' \
  | node /path/to/cecc/packages/cli/dist/hook.js
node /path/to/cecc/packages/cli/dist/index.js findings
```

## Known rough edges

- `cecc scan --all` reads every tracked file into memory one at a time; fine for
  typical repositories, unmeasured above ~10k files.
- The dashboard polls every second for live updates. Adequate locally; it would
  need rethinking for a remote deployment.
- Cloud sync is configured but not implemented.
- Task ingestion from docs and TODO scanning is not implemented; tasks can be
  created through the API but nothing populates them automatically yet.
