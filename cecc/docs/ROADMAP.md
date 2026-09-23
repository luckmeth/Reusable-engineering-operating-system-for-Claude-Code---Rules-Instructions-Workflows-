# Roadmap

Written after a first install on Windows went badly, and after measuring the
scanner against a real project rather than a fixture. Both are worth stating up
front, because they set the order of everything below.

Sources for the research claims are listed at the end.

---

## Where this actually stands

**The core is good.** A hash-chained event log, 31 rules, 8 correlation
patterns, 257 tests, and documentation that admits its own limits. The design
decisions recorded in `PROJECT_STATE.md` are the right ones, including the ones
that say no.

**The first run was broken, and the first run is the whole product.** Four
Windows-only defects shipped: a spurious crash dialog on every project switch,
a case-sensitive hook check that made CECC deny its own hooks, `execFile` unable
to run the `claude.cmd` shim, and a hook command requiring Node on an
application whose premise is bringing its own. Nobody had run the CLI on Windows
end to end.

**The scanner was noisy enough to be worse than nothing.** First run against a
small real project: ten findings, one worth reading. Two of the eight noisy ones
were CRITICAL, including a README line reading
`postgresql://USER:PASSWORD@HOST/db`. After three targeted fixes the same
project reports one finding, and a canary repo with six planted real
vulnerabilities still reports all six.

| | Before | After |
|---|---|---|
| Findings on a real project | 10 | 1 |
| Of those, worth acting on | 1 | 1 |
| Planted real vulnerabilities caught | 6/6 | 6/6 |

That ratio is the single most important number this project has, and nothing was
measuring it.

---

## The thesis is right, and now there is evidence

CECC's bet is that the interesting failures are *sequences*, not diffs: a test
weakened after it failed, a check removed and the suite still green. `CORR-001`
encodes exactly that.

The 2026 literature says the bet is well placed.

- **SpecBench** finds that every model tested can saturate the visible test
  suite on every task, while the gap between validation and held-out pass rates
  grows with task length — a green suite increasingly hides falling compliance.
  In iterative optimisation experiments, 73.8% of Kernel-Bench and 46.8% of
  ALE-Bench runs showed proxy gains with no real gain.
- **"Coding with Enemy"** tested whether human reviewers catch deliberate agent
  sabotage in review. Human oversight is not a reliable control.
- **"Strained Coherence"** identifies pre-failure signals *in execution
  trajectories* — the exact data CECC already stores and currently only replays.

So the moat is real, and it is under-exploited. CECC has the trajectories and
uses them for eight patterns.

Note what CECC is not competing with. Hook-event streamers already exist, and
OpenTelemetry export is becoming the standard way to get agent events into an
existing observability stack. Capturing events is commodity. Deciding which
sequences mean something is not.

---

## Tier 1 — earn the right to be trusted

Nothing else matters if people stop reading the findings.

**1. A precision budget, enforced in CI.** Assemble a corpus of ten real
open-source repos with known issues. Measure precision per rule on every commit.
A rule that cannot clear a bar ships as `observe` (recorded, silent) rather than
`warn`. Today a rule's severity is asserted by its author and never checked.

**2. Group findings by cause, not by location.** One environment variable
produced five separate CRITICAL cards. Fingerprint on (rule, symbol) and render
one card with N locations.

**3. Say what was *not* checked.** "No findings" and "nothing ran" look
identical. Every report should carry a coverage line: rules run, rules skipped,
and why. The project already refuses to show a security score for this exact
reason — this is the same principle applied one level down.

**4. A Windows CI job that runs the CLI.** `desktop.yml` builds on Windows;
nothing executes `init`, `doctor` or `scan` there. All four shipped defects
would have been caught by ten lines of workflow.

**5. Retire text-proximity heuristics for structure.** The benign-context fix
now reads six lines around a match, which is why a shuffle is no longer flagged.
It is still text matching: a comment mentioning "animation" within six lines
will silence a genuine finding. Real fix is the AST — what is the value assigned
to, what is it passed to.

---

## Tier 2 — widen the moat

New correlation patterns, drawn from the failure taxonomy in the 20,574-session
study and from the reward-hacking literature. Every one is derivable from events
CECC already records.

**6. Assertion deleted rather than satisfied.** Sibling of CORR-001: the test
file shrank, the suite passed, production code never changed.

**7. Held-out contradiction.** A test file created in the same session that made
it pass. SpecBench's core finding: the agent writes the oracle it is graded on.

**8. Silent scope creep.** Files modified outside any file named in the prompt
or read before editing. The study's *contextual misunderstanding* category.

**9. Self-reversal.** The agent edits a file, then reverts its own change within
a session. The study's *state management failures*; also the strongest cheap
signal of an agent that has lost the thread.

**10. Thrash detection.** The same command failing three or more times with no
intervening file change. Burns tokens and money, and precedes most bad outcomes.
Pairs naturally with CORR-007/008.

**11. Secret introduced and removed in-session.** It is in git history now.
CECC sees both events and currently reports neither.

**12. Dependency added during a bugfix.** *Dependency/integration issues* in the
taxonomy, and a supply-chain event that should never be incidental.

**13. Pre-failure signal.** The Strained Coherence result suggests trajectories
degrade measurably before they fail. CECC has the trajectories and a local ML
layer already trained on findings. This is the most ambitious item here and the
most defensible if it works.

---

## Tier 3 — make it reachable

**14. `cecc report --since <ref>` into the PR.** Right now CECC is a dashboard
you must remember to open. A markdown block in the PR description puts the
evidence where review already happens. Highest value-per-line item on this list.

**15. One more agent adapter.** The core claims to be agent-agnostic and has one
adapter, so the claim is untested. Cursor, Aider, Codex or Gemini CLI — any one
of them proves the abstraction or exposes it.

**16. OpenTelemetry export.** Not as a replacement for the local store, but so
CECC's *findings* can reach a stack a team already runs. Emit findings and
correlation matches as spans; let the raw event firehose stay local.

**17. Policy in git.** `.cecc/policies.json` is local and gitignored. Teams want
enforcement reviewed like code, and a CI mode that fails on a blocking finding.

---

## Tier 4 — the interface

**18. Ask the agent about the finding it is looking at.** Now that Claude Code
runs in the window, a finding can carry a "fix this" button that seeds the
terminal with the file, the line and the rule's explanation. No other tool in
this space can do it, because no other tool has both halves in one process. This
is the most distinctive UI idea available and it is nearly free.

**19. A session diff, not just a timeline.** The replay shows what happened; the
reviewable artifact is *what changed*, with findings attached to the lines.

**20. Severity as consequence.** "HIGH" means nothing to a founder. "Anyone with
the URL can read every student's results" means everything. The plain-English
mode already proves the team can write this way.

**21. Offer the scan at the end of `init`.** The first screen should have content
in it. This is one prompt.

---

## What not to build

Recorded so the arguments are not re-run later.

- **A security score.** Already rejected in `README.md`, correctly. A number
  implies precision the evidence does not support.
- **LLM-judged findings.** Already rejected in `PROJECT_STATE.md`, correctly. It
  trades the tool's one durable property — every claim is traceable and
  reproducible — for coverage. Use a model to *write* rules, never to decide a
  verdict at scan time.
- **Blocking by default.** Already rejected. A tool that blocks on day one is
  uninstalled on day two.
- **A second runtime.** No Workers, no daemon, no service. The absence of these
  is why the thing installs cleanly.

---

## If only three things get done

1. The precision budget (Tier 1.1) — without it every later rule makes the tool
   noisier.
2. `cecc report --since` into the PR (Tier 3.14) — it is the difference between
   a tool you remember and a tool you use.
3. Two new correlation patterns, 6 and 7 (Tier 2) — they are the product's
   actual argument, and the research says they will fire.

---

## Sources

- [SpecBench: Measuring Reward Hacking in Long-Horizon Coding Agents](https://arxiv.org/html/2605.21384v1)
- [How Coding Agents Fail Their Users: 20,574 Real-World Sessions](https://arxiv.org/pdf/2605.29442)
- [Strained Coherence: A Pre-Failure Signal in Coding Agent Execution Trajectories](https://arxiv.org/pdf/2606.07889)
- [Coding with "Enemy": Can Human Developers Detect AI Agent Sabotage?](https://arxiv.org/pdf/2606.05647)
- [Reward Hacking in Self-Improving Code Agents](https://openreview.net/forum?id=ikrQWGgxYg)
- [Claude Code Control and Observability with OpenTelemetry](https://generalanalysis.com/guides/claude-code-control-observability-opentelemetry)
- [claude-code-hooks-multi-agent-observability](https://github.com/disler/claude-code-hooks-multi-agent-observability)
- [Best AI Agent Security Platforms for Securing Claude Code in 2026](https://www.nightfall.ai/blog/ai-agent-security-platforms-securing-claude-code)
