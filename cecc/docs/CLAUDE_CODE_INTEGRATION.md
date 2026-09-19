# Claude Code integration

## Verified against

Claude Code **2.1.278**. The adapter is written defensively and does not assume
the payload format is stable.

## How it works

`cecc init` registers a hook command in `.claude/settings.json` for:

`SessionStart` · `SessionEnd` · `PreToolUse` · `PostToolUse` · `UserPromptSubmit` · `Stop`

Existing hooks are preserved — the merge is additive and idempotent.
Overwriting another tool's configuration to install monitoring would be exactly
the kind of unannounced change CECC reports on.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "node /path/to/cecc/packages/cli/dist/hook.js" }] }
    ]
  }
}
```

## Why hooks and not CLAUDE.md

CLAUDE.md is advice. An agent may follow it, may summarize it away under
context pressure, or may be argued out of it by text in the repository. A hook
is executed by the harness. Anything CECC needs to guarantee has to run there.

This is why AGENT-028 treats `claude --bare` (which skips hooks) as a critical
finding: it is the one documented way to run the agent with monitoring off.

## Payload handling

The adapter validates with a **permissive** schema: every field optional,
unknown keys preserved. CECC does not control this format, and a strict schema
would mean a routine agent update stops all monitoring — the worst possible
failure mode for a security tool.

Unrecognised hook events and unmapped tools are still recorded, with the reason
noted in `unmapped`. A silent gap in the evidence chain is worse than an
unmapped entry, because nothing explains the gap.

### Mapped tools

| Tool | Produces |
|---|---|
| `Bash` | `command.*`, or `test.run` / `lint.run` / `typecheck.run` / `build.run` / `security.scan` / `git.*` by inferred intent |
| `Write` | `file.created` or `file.modified`, plus a full-content `ContentChange` |
| `Edit` / `MultiEdit` | `file.modified`, plus a `ContentChange` carrying both sides |
| `Read` / `NotebookRead` | `file.read` |
| `Glob` / `Grep` | `command.*` with `intent: search` |
| anything else | recorded generically and listed in `unmapped` |

On `PreToolUse` the content is known before it lands, which is what makes
blocking a dangerous write possible at all.

## Blocking

Only `PreToolUse` can prevent an action. When policy, severity and confidence
all agree, the hook writes:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "…"
  }
}
```

The reason is phrased as an actionable instruction, because it is fed back to
the agent and a block the agent cannot understand just gets retried.

Everything else warns on stderr, which Claude Code surfaces without blocking.

## Safety rules for the hook

The hook is on the agent's critical path. Three rules outrank detection coverage:

1. **Never throw.** An unhandled exception surfaces as a hook failure and
   derails the session. Every path is wrapped; the process always exits 0.
2. **Never hang.** A hard deadline (`CECC_HOOK_TIMEOUT_MS`, default 4000ms)
   releases the action even if analysis is incomplete.
3. **Never block on uncertainty.** Blocking needs an explicit block policy,
   high severity and confidence ≥ 0.85 together.

On timeout CECC **fails open**: the action proceeds and the gap is recorded.
Stated plainly because it is a real trade-off — a monitor that freezes the
workflow gets uninstalled, and an uninstalled monitor detects nothing.

## What CECC does not read

`transcript_path` is recorded as a boolean "a transcript exists" and never
opened. CECC operates only on observable engineering signals: tool activity,
commands, file changes, git state, validation results. Nothing in the product
depends on the model's private reasoning, and no finding infers intent.

## Verifying the integration

```bash
cecc doctor
```

It distinguishes configuration from evidence. A hook entry in `settings.json`
proves the hook is configured; a recorded agent event proves it actually fires.
Only the second means CECC is working. `doctor` also checks that the hook
command points at a file that exists — a configured hook pointing at an
unbuilt path fails silently at runtime, which is the worst kind of broken.

## Supporting another agent

Implement `AgentAdapter`: `detectVersion`, `canHandle`, `normalize`,
`buildBlockResponse`. Translation only — an adapter makes no security decisions
and must not widen the event vocabulary. No rule changes are needed.
