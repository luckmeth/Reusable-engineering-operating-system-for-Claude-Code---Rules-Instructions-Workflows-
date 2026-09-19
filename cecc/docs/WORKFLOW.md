# Workflow and gates

## Stages

```
DISCOVER → UNDERSTAND → INSPECT → PLAN → IMPLEMENT → TEST
         → SECURITY_REVIEW → CODE_REVIEW → READY → DEPLOY → VERIFY
```

## Inference

The stage is inferred from recorded evidence, never from an agent announcing
progress. "Done" in a transcript is a claim; a passing test run is evidence.

Each event contributes weight to candidate stages; the highest total wins.
Weights are tuned so an unambiguous signal outranks an ambiguous one — running a
security scanner happens in one stage, reading files happens in all of them.

| Evidence | Stage | Weight |
|---|---|---|
| Security scan executed | SECURITY_REVIEW | 7 |
| Deployment command | DEPLOY | 7 |
| Test suite executed | TEST | 6 |
| Work committed | CODE_REVIEW | 5 |
| Branch pushed | READY | 5 |
| Source files changed | IMPLEMENT | 4 |
| Documentation written | PLAN | 3 |
| Project docs read | UNDERSTAND | 2 |
| Files read | INSPECT | 1 |

A documentation-only write counts as PLAN rather than IMPLEMENT, because writing
a plan is not writing the feature.

### Never moves backwards

Inference only advances. Reading a file during implementation would otherwise
drag the indicator back to INSPECT and make it flicker. Going back is a decision
a human makes explicitly.

### Human override

```bash
cecc workflow --pin SECURITY_REVIEW   # suspends inference
cecc workflow --unpin                 # resumes it
```

Pinned stages are marked "set by human" in the UI. Inference is never
irreversible — being confidently wrong about where someone is in their own work
is worse than being unsure.

## Gates

A task is not READY because an agent said so. Every gate is computed from
recorded evidence, and a gate with no evidence returns `pending`, not `pass`.

| Gate | Blocking | Passes when |
|---|---|---|
| `security.findings` | yes | No open critical or high findings |
| `agent.shortcuts` | yes | No open high-severity agent shortcuts |
| `tests.run` | yes | A test run was observed and the latest passed |
| `validation.typecheck` | yes | Typecheck observed and passing |
| `validation.lint` | yes | Lint observed and passing |
| `validation.build` | no | Build observed and succeeding |
| `security.reviewed` | yes | A security scan was recorded |
| `protected.reviewed` | yes | No unacknowledged protected-path changes |
| `git.clean` | no | Nothing uncommitted |
| `tasks.complete` | yes | All tasks DONE **with recorded evidence** |

### Pending blocks as firmly as failure

This is the point of the design. "The test suite was never run" and "the test
suite passed" are different states, and a gate that treats an unrun check as a
pass would manufacture exactly the false confidence the product exists to
prevent.

The `tasks.complete` gate goes further: a task marked DONE with no evidence
event ids **fails**. Implementation existing is not the same as it working.

### Agent shortcuts are their own gate

Separate from application security, because a shortcut is a different problem
with a different remedy. An agent that skipped the hooks is not a vulnerability
in the product — it is a hole in the process that produced the product, and
collapsing them would hide it.
