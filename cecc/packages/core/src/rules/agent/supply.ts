import { findSegments } from '../../analyze/command.js';
import { isConfigFile, isTestFile, matchAdded, searchableText } from '../../analyze/content.js';
import { commandEvidence, lineEvidence, locations, type Rule, type RuleResult } from '../types.js';
import { registerRules } from '../registry.js';

/**
 * Supply chain, deployment configuration, and instruction injection.
 *
 * AGENT-027 is the rule that treats the repository itself as hostile input.
 * That framing is unusual and deliberate: an AI coding agent reads README files,
 * comments and dependency metadata as naturally as it reads code, and text in
 * any of those places can be written by someone who is not the developer.
 */

// ---------------------------------------------------------------- AGENT-022

/** Trivially replaceable packages — a dependency here is rarely worth its supply-chain surface. */
const TRIVIAL_PACKAGES = new Set([
  'is-odd', 'is-even', 'is-number', 'left-pad', 'is-array', 'is-string',
  'pad-left', 'pad-right', 'array-flatten', 'object-assign', 'is-plain-object',
  'lodash.get', 'lodash.set', 'has-value', 'isarray',
]);

/** Packages commonly typosquatted against. */
const TYPOSQUAT_TARGETS: Record<string, string> = {
  'crossenv': 'cross-env', 'cross-env.js': 'cross-env', 'babelcli': 'babel-cli',
  'd3.js': 'd3', 'fabric-js': 'fabric', 'ffmpeg': 'fluent-ffmpeg',
  'mongose': 'mongoose', 'mongoos': 'mongoose', 'expres': 'express',
  'lodahs': 'lodash', 'loadash': 'lodash', 'reactt': 'react',
  'axios-http': 'axios', 'node-fetch-npm': 'node-fetch',
};

const AGENT_022: Rule = {
  id: 'AGENT-022',
  name: 'Dependency shortcut',
  category: 'SUPPLY_CHAIN',
  layer: 'AGENT',
  severity: 'medium',
  detection: 'DEPENDENCY',
  description: 'A dependency was added or changed in a way that increases supply-chain risk.',
  why:
    'Every dependency runs with the full privileges of your build and often your runtime. A package added to save twenty ' +
    'lines brings its own transitive tree, its own maintainers and its own install scripts. The cost is not the install ' +
    'size, it is the number of people who can now change what your code does.',
  remediation:
    'Prefer the standard library or something already in the tree. Pin versions in security-sensitive projects, and review install scripts before adding a package.',

  matches(ctx) {
    const touchesManifest = ctx.changes.some((c) => /package\.json$|requirements\.txt$|Gemfile$|go\.mod$|Cargo\.toml$/.test(c.file));
    const installs = ctx.event.command != null && /\b(?:npm|pnpm|yarn|bun|pip|gem|cargo)\b/.test(ctx.event.command);
    return touchesManifest || installs;
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    // --- installs observed on the command line
    if (ctx.parsedCommand) {
      for (const segment of ['npm', 'pnpm', 'yarn', 'bun'].flatMap((p) => findSegments(ctx.parsedCommand!, p))) {
        const isInstall = segment.args.some((a) => ['install', 'add', 'i'].includes(a));
        if (!isInstall) continue;

        const packages = segment.args.filter((a) => !a.startsWith('-') && !['install', 'add', 'i'].includes(a));

        for (const pkg of packages) {
          const bare = pkg.replace(/^@[^/]+\//, '').split('@')[0] ?? pkg;

          if (TYPOSQUAT_TARGETS[bare]) {
            results.push({
              title: `Possible typosquat: '${bare}' resembles '${TYPOSQUAT_TARGETS[bare]}'`,
              severity: 'critical',
              confidence: 0.75,
              verification: 'POTENTIAL',
              affectedFiles: ['package.json'],
              affectedLines: [],
              evidence: [commandEvidence(segment.raw), { kind: 'config', label: 'Likely intended package', detail: TYPOSQUAT_TARGETS[bare] }],
              impact:
                'Typosquatted packages exist to be installed by mistake and commonly run code at install time. If this name was a typo, ' +
                'arbitrary code may already have executed on this machine.',
              recommendation: `Verify the package name. If '${TYPOSQUAT_TARGETS[bare]}' was intended, remove this one and audit what its install scripts did.`,
              command: ctx.event.command,
              discriminator: `typosquat:${bare}`,
            });
          }

          if (TRIVIAL_PACKAGES.has(bare)) {
            results.push({
              title: `Dependency '${bare}' duplicates functionality the language already provides`,
              severity: 'low',
              confidence: 0.85,
              verification: 'VERIFIED',
              affectedFiles: ['package.json'],
              affectedLines: [],
              evidence: [commandEvidence(segment.raw)],
              impact: 'A micro-dependency adds a maintainer and an install hook to your supply chain in exchange for a few lines of code.',
              recommendation: 'Write the handful of lines inline instead.',
              command: ctx.event.command,
              discriminator: `trivial:${bare}`,
            });
          }
        }

        // Install scripts disabled or forced through.
        if (segment.args.includes('--force') || segment.args.includes('--legacy-peer-deps')) {
          results.push({
            title: 'Dependency resolution forced past a reported conflict',
            severity: 'low',
            confidence: 0.8,
            verification: 'VERIFIED',
            affectedFiles: ['package.json'],
            affectedLines: [],
            evidence: [commandEvidence(segment.raw)],
            impact: 'The package manager reported an incompatibility and was told to proceed. The resulting tree may contain versions that were never tested together.',
            recommendation: 'Resolve the version conflict rather than overriding it, or record why the override is safe.',
            command: ctx.event.command,
            discriminator: 'forced-install',
          });
        }
      }
    }

    // --- manifest edits
    for (const change of ctx.changes) {
      if (!/package\.json$/.test(change.file)) continue;

      // An added lifecycle script is how a dependency change becomes code execution.
      const scripts = change.added.filter((l) => /"(?:preinstall|postinstall|prepare|prepublish)"\s*:/.test(l.text));
      if (scripts.length > 0) {
        results.push({
          title: 'Install lifecycle script added',
          severity: 'high',
          confidence: 0.85,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, scripts),
          evidence: scripts.slice(0, 3).map((l) => lineEvidence(change.file, l.line, l.text, 'Lifecycle script')),
          impact: 'Lifecycle scripts run automatically on every install, including in CI and on every collaborator’s machine, with no prompt.',
          recommendation: 'Confirm the script is intended and does only what it claims. Prefer an explicit build step over an implicit install hook.',
          discriminator: 'lifecycle-script',
        });
      }

      // Wildcard or git dependencies bypass version pinning entirely.
      const loose = change.added.filter((l) => /"[^"]+"\s*:\s*"(?:\*|latest|git\+|https?:\/\/|file:)/.test(l.text));
      if (loose.length > 0) {
        results.push({
          title: 'Unpinned or non-registry dependency added',
          severity: ctx.project.environment === 'production' ? 'high' : 'medium',
          confidence: 0.82,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, loose),
          evidence: loose.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, 'Unpinned dependency')),
          impact:
            'A wildcard, `latest`, or git reference resolves to whatever exists at install time. Two installs of the same commit can produce different code, and an upstream compromise propagates immediately.',
          recommendation: 'Pin to an exact version and rely on the lockfile. Vendor the code if a git dependency is genuinely required.',
          discriminator: 'unpinned-dependency',
        });
      }
    }

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-025 / 026

interface ConfigRisk {
  pattern: RegExp;
  label: string;
  impact: string;
  severity: Rule['severity'];
}

const CONFIG_RISKS: ConfigRisk[] = [
  {
    pattern: /ignoreBuildErrors\s*:\s*true|ignoreDuringBuilds\s*:\s*true/,
    label: 'Build-time error checking disabled',
    impact: 'Type and lint errors no longer fail the build, so broken code deploys successfully and the failure surfaces in production instead.',
    severity: 'high',
  },
  {
    pattern: /NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/,
    label: 'TLS verification disabled process-wide',
    impact: 'Every outbound TLS connection from the process accepts any certificate, removing protection against interception for all of them at once.',
    severity: 'critical',
  },
  {
    pattern: /Cache-Control['"]?\s*[,:]\s*['"][^'"]*public[^'"]*['"]/i,
    label: 'Response marked publicly cacheable',
    impact: 'If the response is user-specific, shared caches and CDNs may serve one user’s data to another. This is a data breach caused entirely by configuration.',
    severity: 'high',
  },
  {
    pattern: /['"]?debug['"]?\s*[:=]\s*true|DEBUG\s*=\s*(?:true|1|\*)/,
    label: 'Debug mode enabled',
    impact: 'Debug output commonly includes stack traces, query text and configuration values, handing an attacker a map of the system.',
    severity: 'medium',
  },
  {
    pattern: /allowedHosts\s*:\s*(?:\[\s*['"]\*|['"]all)|host\s*:\s*['"]0\.0\.0\.0/,
    label: 'Service bound to all interfaces or all hosts allowed',
    impact: 'A service intended for local access becomes reachable from the network.',
    severity: 'medium',
  },
  {
    pattern: /ssl\s*:\s*false|sslmode=disable|rejectUnauthorized\s*:\s*false/,
    label: 'Database TLS disabled',
    impact: 'Database traffic, including credentials and query results, travels unencrypted.',
    severity: 'high',
  },
];

const AGENT_026: Rule = {
  id: 'AGENT-026',
  name: 'Configuration security regression',
  category: 'CONFIGURATION',
  layer: 'APPLICATION',
  severity: 'high',
  detection: 'CONFIG_ANALYSIS',
  description: 'A configuration change reduces a security property.',
  why:
    'Configuration changes are reviewed less carefully than code and take effect everywhere at once. Turning off build-time ' +
    'error checking or TLS verification is a one-line edit with a project-wide blast radius, and it never shows up in a test.',
  remediation: 'Revert the setting and address what it was working around. Where an exception is genuinely needed, scope it as narrowly as possible and record why.',

  matches(ctx) {
    return ctx.changes.some((c) => isConfigFile(c.file) || /\.(?:json|ya?ml|toml|env|conf)$/.test(c.file) || /config/i.test(c.file));
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (isTestFile(change.file) || change.isDeletion) continue;

      for (const risk of CONFIG_RISKS) {
        const lines = matchAdded(change, risk.pattern);
        if (lines.length === 0) continue;

        results.push({
          title: `${risk.label} — ${change.file}`,
          severity: ctx.project.environment === 'production' && risk.severity !== 'critical' ? 'critical' : risk.severity,
          confidence: 0.85,
          verification: 'VERIFIED',
          affectedFiles: [change.file],
          affectedLines: locations(change.file, lines),
          evidence: lines.slice(0, 4).map((l) => lineEvidence(change.file, l.line, l.text, risk.label)),
          impact:
            risk.impact +
            (ctx.project.environment === 'production' ? ' This project is configured as a production environment.' : ''),
          recommendation: this.remediation,
          discriminator: risk.label,
        });
      }
    }

    return results;
  },
};

const AGENT_025: Rule = {
  id: 'AGENT-025',
  name: 'Production shortcut',
  category: 'CI_CD',
  layer: 'AGENT',
  severity: 'high',
  detection: 'RULE_BASED',
  description: 'A production deployment or migration ran without the evidence that should precede it.',
  why:
    'Deployment is the point where a mistake stops being local. Shipping without a passing test run means nobody knows ' +
    'whether the change works, and running a migration without a tested rollback means a bad one cannot be undone.',
  remediation: 'Run the validation suite, verify the migration against a fresh database, and know the rollback path before deploying.',

  matches(ctx) {
    return ctx.event.command != null && /deploy|vercel|--prod|db\s+push|migrate\s+deploy|fly\s+deploy/.test(ctx.event.command);
  },

  evaluate(ctx): RuleResult[] {
    if (!ctx.parsedCommand) return [];
    const results: RuleResult[] = [];

    const isProdDeploy = ctx.parsedCommand.segments.some(
      (s) =>
        (s.program === 'vercel' && s.args.includes('--prod')) ||
        (/deploy/.test(s.args.join(' ')) && /--prod|production/.test(s.args.join(' '))) ||
        (s.program === 'supabase' && s.args.includes('push') && /--project-ref|--linked/.test(s.args.join(' '))),
    );
    if (!isProdDeploy) return results;

    // Look back over this session for evidence that validation actually ran.
    const recent = ctx.store.recentSessionEvents(ctx.event.sessionId, 300);
    const testsRan = recent.filter((e) => e.type === 'test.run');
    const testsPassed = testsRan.filter((e) => e.status === 'success');
    const testsFailed = testsRan.filter((e) => e.status === 'failed');

    const missing: string[] = [];
    if (testsRan.length === 0) missing.push('no test run observed in this session');
    if (testsFailed.length > 0 && testsFailed.length >= testsPassed.length) missing.push('the most recent test run failed');
    if (!recent.some((e) => e.type === 'typecheck.run' || e.type === 'build.run')) missing.push('no typecheck or build observed');

    if (missing.length === 0) return results;

    results.push({
      title: 'Production deployment without observed validation',
      severity: testsFailed.length > 0 ? 'critical' : 'high',
      confidence: 0.8,
      // CECC can only speak to what it saw. Validation may have run elsewhere.
      verification: 'POTENTIAL',
      affectedFiles: [],
      affectedLines: [],
      evidence: [
        commandEvidence(ctx.parsedCommand.raw, 'Deployment command'),
        { kind: 'correlation', label: 'Missing evidence', detail: missing.join('; ') },
        { kind: 'correlation', label: 'Observed in session', detail: `${testsPassed.length} passing / ${testsFailed.length} failing test runs` },
      ],
      impact:
        'A production deploy proceeded without CECC observing the checks that would establish the change is sound. ' +
        (testsFailed.length > 0
          ? 'The most recent observed test run failed, so there is positive evidence of a problem rather than merely an absence of evidence.'
          : 'CECC observes this session only — validation may have run elsewhere, so confirm before treating this as a failure.'),
      recommendation: this.remediation,
      command: ctx.event.command,
      relatedEvents: [...testsFailed.slice(0, 5).map((e) => e.id)],
      discriminator: 'unvalidated-deploy',
    });

    return results;
  },
};

// ---------------------------------------------------------------- AGENT-027

/**
 * Instruction-injection patterns.
 *
 * Structured as (imperative directed at an assistant) + (action that would harm
 * the developer). Requiring both halves is what keeps this from firing on
 * ordinary prose — documentation says "ignore" and "disable" constantly, just
 * not aimed at an agent and not paired with exfiltration.
 */
// Up to four intervening words rather than a fixed adjective list: real
// injections say "ignore all previous security instructions", and enumerating
// every possible adjective is a losing game.
const INJECTION_IMPERATIVE =
  /\b(?:ignore|disregard|forget|override|bypass|skip)\s+(?:\w+\s+){0,4}(?:instructions?|rules?|prompts?|guidelines?|directives?|constraints?|policies|policy|restrictions?|system\s+prompt)\b/i;

const AGENT_DIRECTED =
  /\b(?:you\s+(?:are|must|should|will|need\s+to)|as\s+an?\s+AI|assistant|claude|chatgpt|gpt|copilot|cursor|llm|language\s+model|agent)\b/i;

const HARMFUL_ACTION: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:exfiltrat|upload|send|post|transmit|leak|email)\b[\s\S]{0,60}?(?:\.env\b|\b(?:secret|credential|api[ _-]?key|token|source\s+code|password|database)\b)/i, label: 'exfiltrate secrets or source' },
  { pattern: /\b(?:cat|read|print|reveal|show|display|output)\b[\s\S]{0,40}?(?:\.env\b|\b(?:secret|credential|private[_\s]key|password|token)\b)/i, label: 'reveal credentials' },
  { pattern: /\b(?:run|execute|eval|curl|wget)\b[^.\n]{0,60}(?:\|\s*(?:bash|sh)|https?:\/\/)/i, label: 'execute remote code' },
  { pattern: /\b(?:disable|remove|delete|skip|turn\s+off)\b[^.\n]{0,40}\b(?:test|security|scan|hook|check|validation|lint|cecc|monitor)\b/i, label: 'disable safety mechanisms' },
  { pattern: /\b(?:grant|escalate|elevate|give)\b[^.\n]{0,40}\b(?:permission|access|privilege|admin|root|sudo)\b/i, label: 'escalate privileges' },
  { pattern: /\bdo\s+not\s+(?:tell|report|mention|log|inform|alert)\b/i, label: 'conceal activity from the developer' },
];

/** Files an agent reads as guidance, where injected text carries the most weight. */
const AGENT_READABLE = /README|CONTRIBUTING|\.md$|\.mdx$|\.txt$|CLAUDE\.md$|\.cursorrules$|AGENTS?\.md$|\.github[/\\]|package\.json$|\.ya?ml$/i;

const AGENT_027: Rule = {
  id: 'AGENT-027',
  name: 'Prompt injection in repository content',
  category: 'PROMPT_INJECTION',
  layer: 'AGENT',
  severity: 'critical',
  detection: 'STATIC_ANALYSIS',
  description: 'Repository content contains text that appears to target an AI coding agent.',
  why:
    'An AI agent reads README files, comments, issue text and dependency metadata as readily as it reads code, and it ' +
    'cannot reliably tell a maintainer’s note from an attacker’s. Text in any of those places is untrusted input. A ' +
    'pull request that adds a paragraph to a README can be an attempt to reprogram the next agent that reads it.',
  remediation:
    'Remove the text and establish who added it. Treat repository content as data, never as instructions: no file in a repository should be able to change an agent’s security rules.',

  matches(ctx) {
    return ctx.changes.some((c) => !c.isDeletion);
  },

  evaluate(ctx): RuleResult[] {
    const results: RuleResult[] = [];

    for (const change of ctx.changes) {
      if (change.isDeletion) continue;

      const suspicious = change.added.filter((line) => {
        const text = line.text;
        if (text.trim().length < 15) return false;

        const overrides = INJECTION_IMPERATIVE.test(text);
        const directed = AGENT_DIRECTED.test(text);
        const harmful = HARMFUL_ACTION.some((h) => h.pattern.test(text));

        // Two of the three signals must be present. Documentation legitimately
        // says "ignore", legitimately mentions assistants, and legitimately
        // discusses uploading things — but rarely two of those in one sentence,
        // and almost never all three.
        return [overrides, directed, harmful].filter(Boolean).length >= 2;
      });

      if (suspicious.length === 0) continue;

      const actions = [...new Set(suspicious.flatMap((l) => HARMFUL_ACTION.filter((h) => h.pattern.test(l.text)).map((h) => h.label)))];
      const inGuidanceFile = AGENT_READABLE.test(change.file);
      const hasOverride = suspicious.some((l) => INJECTION_IMPERATIVE.test(l.text));

      // Confidence rises with the number of independent signals present.
      let confidence = 0.55;
      if (hasOverride) confidence += 0.15;
      if (actions.length > 0) confidence += 0.15;
      if (inGuidanceFile) confidence += 0.1;

      results.push({
        title: `Possible agent-directed instruction in ${change.file}`,
        severity: actions.length > 0 ? 'critical' : 'high',
        confidence: Math.min(confidence, 0.95),
        verification: actions.length > 0 && hasOverride ? 'LIKELY' : 'POTENTIAL',
        affectedFiles: [change.file],
        affectedLines: locations(change.file, suspicious),
        evidence: [
          ...suspicious.slice(0, 5).map((l) => lineEvidence(change.file, l.line, l.text, 'Agent-directed text')),
          ...(actions.length > 0 ? [{ kind: 'correlation' as const, label: 'Requested actions', detail: actions.join(', ') }] : []),
          ...(inGuidanceFile
            ? [{ kind: 'file' as const, label: 'File class', detail: 'This file type is routinely read by coding agents as guidance', file: change.file }]
            : []),
        ],
        impact:
          'Text in this file attempts to direct an AI agent’s behaviour' +
          (actions.length > 0 ? `, specifically to ${actions.join(' and ')}. ` : '. ') +
          (inGuidanceFile
            ? 'It sits in a file that agents read as instructions, so it is likely to be acted on rather than merely seen.'
            : 'Even in a code comment, an agent reading the file for context may treat it as direction.'),
        recommendation: this.remediation,
        discriminator: 'agent-directed-text',
      });
    }

    return results;
  },
};

export const SUPPLY_RULES = [AGENT_022, AGENT_025, AGENT_026, AGENT_027];
registerRules(SUPPLY_RULES);
export { AGENT_022, AGENT_025, AGENT_026, AGENT_027 };

/** Re-exported for the CLI's standalone content scanner. */
export { searchableText };
