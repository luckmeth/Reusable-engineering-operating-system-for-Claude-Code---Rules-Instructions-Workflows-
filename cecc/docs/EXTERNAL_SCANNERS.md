# External Scanners

CECC's own 28 rules watch what the agent does. They say nothing about a CVE
published against a dependency three levels down, or a taint path a
purpose-built static analyser would find. Those tools exist and are better at
it, so CECC runs them and normalizes their output instead of reimplementing
them badly.

```bash
cecc scan --external                      # runs everything that can run offline
cecc scan --external --online             # allows outbound requests
cecc scan --external --scanner semgrep    # one scanner
cecc scan --external --json               # machine-readable, includes coverage
```

## The scanners

| Scanner | Rule id | Needs network | Reads |
|---|---|---|---|
| npm audit | `SCAN-NPM-AUDIT` | yes — the registry advisory feed | every `package-lock.json` at or below the root |
| OSV.dev | `SCAN-OSV` | yes — `api.osv.dev` | the same lockfiles, queried by exact version |
| Semgrep | `SCAN-SEMGREP` | only for `--config auto` | source, using a committed config if one exists |

npm audit and OSV overlap deliberately. npm matches by semver range against its
own feed; OSV matches the exact resolved version against a broader database.
They disagree usefully. Both are filed under separate rule ids so the source of
every claim stays visible, and both can be muted independently with
`cecc policy --set SCAN-OSV --mode observe`.

## Coverage is reported, never assumed

The contract that matters is the honest one. A scanner that is not installed,
has nothing to read, or was not allowed onto the network produces a **recorded
coverage gap** — never an empty result that reads as "clean".

```
  · npm audit    needs-network
      npm audit queries the registry advisory database. Re-run with --online to allow it.
  · Semgrep      unavailable
      Semgrep is not installed. `pipx install semgrep` enables this scanner.
  Coverage   0 of 3 external scanners ran — 3 did not, so coverage is incomplete.

  No external scanner ran.
  Nothing was checked. This is not a clean result.
```

Each run writes a `security.external-scan` event carrying its outcome, note,
tool version and duration, so the gap is in the timeline rather than only on
someone's screen at the time.

Outcomes:

| Outcome | Means |
|---|---|
| `ran` | Completed. Its findings are authoritative for its scope. |
| `unavailable` | The tool is not installed here. |
| `not-applicable` | Installed, but the project has nothing it can read. |
| `needs-network` | Would need outbound requests and was not allowed them. |
| `failed` | Started and failed. The error is recorded. |

A scanner that throws is contained: the run is marked `failed` with the message,
and the others still run. One broken integration must not take down a scan, and
must not be silently counted as a pass.

## Network access is opt-in

`--online` is required before any scanner opens a socket. This is not caution
theatre: querying a vulnerability database discloses the project's dependency
inventory to a third party. CECC states exactly what would be sent before it
sends anything.

```
· OSV.dev  needs-network
    OSV would send 478 package name/version pairs to api.osv.dev.
    Re-run with --online to allow it.
```

Semgrep's `--config auto` also downloads a rule pack and uploads scan metrics,
which is why CECC prefers a committed `.semgrep.yml` and only falls back to
`auto` with `--online`. It passes `--metrics=off` either way.

CECC never installs a scanner. If Semgrep is absent, the run says so and tells
you the install command — it does not put software on your machine as a side
effect of a scan.

## How findings are graded

- **Severity** maps down, never up. An unrecognised severity word becomes `low`
  rather than inflating the picture.
- **Verification** is `LIKELY` for dependency advisories (the advisory is a
  published fact; whether your code reaches the vulnerable path is not) and
  `POTENTIAL` for Semgrep (a pattern match is a hypothesis). Nothing from an
  external scanner is ever `VERIFIED`.
- **Dev-only dependencies** are graded one band lower, with the reason attached.
  They do not reach production — but they do run on developer machines and in
  CI, which hold credentials, so they are not dismissed either.
- **Semgrep categories** that CECC cannot map land on `QUALITY`, not on a
  security category. Filing an unknown check as a security finding inflates the
  security picture, which is exactly what the three-layer split exists to avoid.
- **Fingerprints** use the scanner's own stable identifier (a GHSA id, a Semgrep
  check id plus location), so re-running bumps `occurrences` rather than
  creating duplicates, and a suppression survives the next run.

## Evidence is the thing itself

Semgrep substitutes the placeholder `requires login` for matched text in
unauthenticated scans. CECC discards that and reads the line from disk instead.
Evidence that is not the code would be worse than no evidence.

## Known limits

- Only npm lockfiles are parsed. pnpm and yarn use different formats, and a
  half-correct parser would under-report — which for a security scanner is worse
  than saying plainly that it is unsupported.
- The lockfile walk is bounded to depth 2 and 8 lockfiles.
- OSV queries at most 900 packages per run and fetches details for the first 60
  advisories. Both caps are reported in the run note when they bite.
- Behind an HTTPS proxy, Node's global `fetch` ignores `HTTPS_PROXY` unless
  `NODE_USE_ENV_PROXY=1` is set. npm audit reads npm's own proxy config and is
  unaffected.
