import { writeFileSync } from 'node:fs';
import {
  Store,
  allRules,
  ceccPaths,
  evaluateGates,
  isProtectedPath,
  loadPolicySet,
  pinStage,
  savePolicySet,
  setRuleMode,
  WORKFLOW_STAGES,
  type PolicyMode,
  type ProjectConfig,
  type WorkflowStage,
} from '@cecc/core';
import { c, heading, kv, relativeTime, SEVERITY_COLOR, table, timeOnly, wrapText } from '../ui.js';
import { printFinding } from './scan.js';

// ------------------------------------------------------------------ findings

export function findingsCommand(
  root: string,
  project: ProjectConfig,
  opts: { layer?: string; severity?: string; all?: boolean; json?: boolean; id?: string; resolve?: string; suppress?: string; reason?: string; days?: number },
): number {
  const store = new Store(ceccPaths(root).db);
  try {
    if (opts.resolve) {
      store.resolveFinding(opts.resolve, opts.reason);
      console.log(c.green(`\n  Finding ${opts.resolve.slice(0, 8)} marked resolved.\n`));
      return 0;
    }

    if (opts.suppress) {
      if (!opts.reason) {
        // A suppression without a reason is indistinguishable from the finding
        // never having been raised, which defeats the audit trail.
        console.error(c.red('\n  --reason is required when suppressing a finding.'));
        console.error(c.gray('  Suppressions are recorded with who, why and until when.\n'));
        return 2;
      }
      const expiresAt = opts.days ? new Date(Date.now() + opts.days * 86_400_000).toISOString() : null;
      store.suppressFinding(opts.suppress, opts.reason, process.env['USER'] ?? 'unknown', expiresAt);
      console.log(c.yellow(`\n  Finding ${opts.suppress.slice(0, 8)} suppressed${expiresAt ? ` until ${expiresAt.slice(0, 10)}` : ' indefinitely'}.\n`));
      return 0;
    }

    // Expired suppressions reopen automatically: silence should not be permanent by default.
    const reopened = store.expireSuppressions(project.id);
    if (reopened > 0) console.log(c.yellow(`  ${reopened} suppression(s) expired and were reopened.\n`));

    const findings = store.listFindings({
      projectId: project.id,
      status: opts.all ? ['open', 'resolved', 'suppressed', 'accepted'] : ['open'],
      layer: opts.layer ? [opts.layer.toUpperCase() as 'APPLICATION' | 'AGENT' | 'CECC'] : undefined,
      minSeverity: opts.severity as 'critical' | undefined,
      limit: 500,
    });

    if (opts.json) {
      console.log(JSON.stringify(findings, null, 2));
      return 0;
    }

    if (opts.id) {
      const finding = findings.find((f) => f.id.startsWith(opts.id!)) ?? store.getFinding(opts.id);
      if (!finding) {
        console.error(c.red(`\n  No finding matching '${opts.id}'.\n`));
        return 1;
      }
      console.log(heading(finding.title));
      printFinding(finding);
      if (finding.relatedEvents.length > 0) {
        console.log(c.gray('    Related events:'));
        for (const id of finding.relatedEvents.slice(0, 8)) {
          const event = store.getEvent(id);
          if (event) console.log(c.gray(`      ${timeOnly(event.timestamp)} ${event.type} ${event.command ?? event.filePaths[0] ?? ''}`));
        }
        console.log('');
      }
      return 0;
    }

    console.log(heading(`Findings — ${project.name}`));
    if (findings.length === 0) {
      console.log(c.green('  No open findings.'));
      console.log(c.gray('  Nothing matched the active rules. That is not the same as "secure".\n'));
      return 0;
    }

    console.log(
      table(
        findings.slice(0, 60).map((f) => [
          c.gray(f.id.slice(0, 8)),
          (SEVERITY_COLOR[f.severity] ?? c.gray)(f.severity.toUpperCase()),
          c.gray(f.ruleId),
          f.layer === 'AGENT' ? c.magenta(f.layer) : f.layer === 'CECC' ? c.cyan(f.layer) : c.gray(f.layer),
          f.title.slice(0, 58),
          c.gray(`${Math.round(f.confidence * 100)}%`),
          c.gray(f.status === 'open' ? relativeTime(f.lastDetectedAt) : f.status),
        ]),
        ['ID', 'SEVERITY', 'RULE', 'LAYER', 'TITLE', 'CONF', 'STATUS'],
      ),
    );
    console.log(c.gray(`\n  ${findings.length} finding(s). Run \`cecc findings --id <id>\` for full evidence.\n`));
    return findings.some((f) => f.severity === 'critical' || f.severity === 'high') ? 1 : 0;
  } finally {
    store.close();
  }
}

// -------------------------------------------------------------------- policy

export function policyCommand(
  root: string,
  project: ProjectConfig,
  opts: { set?: string; mode?: string; reason?: string; json?: boolean },
): number {
  const paths = ceccPaths(root);
  const load = loadPolicySet(paths.policies, project.environment);

  if (opts.set && opts.mode) {
    if (!['observe', 'warn', 'block'].includes(opts.mode)) {
      console.error(c.red(`\n  Mode must be observe, warn or block.\n`));
      return 2;
    }
    const updated = setRuleMode(load.set, opts.set, opts.mode as PolicyMode, opts.reason ?? '', process.env['USER'] ?? 'unknown');
    savePolicySet(paths.policies, updated);

    const store = new Store(paths.db);
    store.audit(project.id, process.env['USER'] ?? 'user', 'policy.changed', { ruleId: opts.set, mode: opts.mode, reason: opts.reason ?? null });
    store.close();

    console.log(c.green(`\n  ${opts.set} → ${opts.mode}${opts.reason ? c.gray(` (${opts.reason})`) : ''}\n`));
    return 0;
  }

  if (opts.json) {
    console.log(JSON.stringify(load.set, null, 2));
    return 0;
  }

  console.log(heading('Policies'));
  console.log(kv('Environment', load.set.environment));
  console.log(kv('Default mode', load.set.defaultMode));
  console.log(kv('Integrity', load.integrityOk ? c.green('checksum valid') : c.red('CHECKSUM MISMATCH — file edited outside CECC')));
  console.log(kv('Protected paths', String(load.set.protectedPaths.length)));

  console.log(heading('Rules'));
  console.log(
    table(
      allRules().map((rule) => {
        const policy = load.set.policies[rule.id];
        const mode = policy?.mode ?? load.set.defaultMode;
        return [
          c.gray(rule.id),
          rule.layer === 'AGENT' ? c.magenta(rule.layer) : rule.layer === 'CECC' ? c.cyan(rule.layer) : c.gray(rule.layer),
          (SEVERITY_COLOR[rule.severity] ?? c.gray)(rule.severity),
          mode === 'block' ? c.red(mode) : mode === 'warn' ? c.yellow(mode) : c.gray(mode),
          rule.name.slice(0, 40),
        ];
      }),
      ['RULE', 'LAYER', 'SEVERITY', 'MODE', 'NAME'],
    ),
  );
  console.log(c.gray('\n  cecc policy set AGENT-002 block --reason "never skip hooks here"\n'));
  return 0;
}

// -------------------------------------------------------------------- rules

export function rulesCommand(opts: { id?: string; json?: boolean }): number {
  const rules = allRules();
  if (opts.json) {
    console.log(JSON.stringify(rules.map((r) => ({ ...r, matches: undefined, evaluate: undefined })), null, 2));
    return 0;
  }
  if (opts.id) {
    const rule = rules.find((r) => r.id.toUpperCase() === opts.id!.toUpperCase());
    if (!rule) {
      console.error(c.red(`\n  No rule '${opts.id}'.\n`));
      return 1;
    }
    console.log(heading(`${rule.id} — ${rule.name}`));
    console.log(kv('Layer', rule.layer));
    console.log(kv('Category', rule.category));
    console.log(kv('Severity', (SEVERITY_COLOR[rule.severity] ?? c.gray)(rule.severity)));
    console.log(kv('Detection', rule.detection));
    console.log(c.gray('\n  What it detects:'));
    console.log(wrapText(rule.description, 78, '    '));
    console.log(c.gray('\n  Why it matters:'));
    console.log(wrapText(rule.why, 78, '    '));
    console.log(c.gray('\n  Remediation:'));
    console.log(wrapText(rule.remediation, 78, '    '));
    console.log('');
    return 0;
  }

  console.log(heading(`Detection rules (${rules.length})`));
  for (const layer of ['AGENT', 'APPLICATION', 'CECC'] as const) {
    const group = rules.filter((r) => r.layer === layer);
    if (group.length === 0) continue;
    console.log(`\n  ${c.bold(layer)} ${c.gray(`(${group.length})`)}`);
    for (const rule of group) {
      console.log(`    ${c.gray(rule.id.padEnd(11))} ${(SEVERITY_COLOR[rule.severity] ?? c.gray)(rule.severity.padEnd(9))} ${rule.name}`);
    }
  }
  console.log(c.gray('\n  cecc rules --id AGENT-003   for full detail\n'));
  return 0;
}

// ------------------------------------------------------------------ workflow

export function workflowCommand(root: string, project: ProjectConfig, opts: { pin?: string; unpin?: boolean }): number {
  const store = new Store(ceccPaths(root).db);
  try {
    const session = store.getCurrentSession(project.id);
    if (!session) {
      console.log(c.gray('\n  No session recorded yet.\n'));
      return 0;
    }
    let run = store.getWorkflowRunBySession(session.id);
    if (!run) {
      console.log(c.gray('\n  No workflow run for the current session.\n'));
      return 0;
    }

    if (opts.unpin) {
      run = pinStage(run, null);
      store.saveWorkflowRun(run);
      console.log(c.green('\n  Stage unpinned — inference resumed.\n'));
      return 0;
    }

    if (opts.pin) {
      const stage = opts.pin.toUpperCase() as WorkflowStage;
      if (!WORKFLOW_STAGES.includes(stage)) {
        console.error(c.red(`\n  Unknown stage '${opts.pin}'. One of: ${WORKFLOW_STAGES.join(', ')}\n`));
        return 2;
      }
      run = pinStage(run, stage);
      store.saveWorkflowRun(run);
      store.audit(project.id, 'user', 'workflow.pinned', { stage });
      console.log(c.green(`\n  Stage pinned to ${stage}. Inference is suspended until \`cecc workflow --unpin\`.\n`));
      return 0;
    }

    console.log(heading('Workflow'));
    console.log(kv('Current stage', c.bold(c.cyan(run.currentStage))));
    if (run.pinnedStage) console.log(kv('Pinned', c.yellow(`${run.pinnedStage} — set by a human`)));
    console.log(kv('Started', relativeTime(run.startedAt)));
    console.log('');

    for (const record of run.stages) {
      const icon =
        record.state === 'complete' ? c.green('✔') : record.state === 'active' ? c.cyan('▶') : record.state === 'blocked' ? c.red('✖') : c.gray('·');
      const duration = record.durationMs ? c.gray(` ${Math.round(record.durationMs / 1000)}s`) : '';
      const evidence = record.evidenceEventIds.length > 0 ? c.gray(` · ${record.evidenceEventIds.length} evidence events`) : '';
      const label = record.state === 'active' ? c.bold(record.stage) : record.state === 'pending' ? c.gray(record.stage) : record.stage;
      console.log(`  ${icon} ${label.padEnd(28)}${duration}${evidence}${record.inferred ? '' : c.yellow(' (set by human)')}`);
    }
    console.log('');
    return 0;
  } finally {
    store.close();
  }
}

// ------------------------------------------------------------------- session

export function sessionCommand(root: string, project: ProjectConfig, opts: { id?: string; list?: boolean; filter?: string; limit?: number }): number {
  const store = new Store(ceccPaths(root).db);
  try {
    if (opts.list || !opts.id) {
      const sessions = store.listSessions(project.id, 20);
      if (sessions.length === 0) {
        console.log(c.gray('\n  No sessions recorded.\n'));
        return 0;
      }
      console.log(heading('Sessions'));
      console.log(
        table(
          sessions.map((s) => {
            const events = store.queryEvents({ projectId: project.id, sessionId: s.id, limit: 2000 });
            const failures = events.filter((e) => e.status === 'failed').length;
            const findings = store.listFindings({ projectId: project.id, sessionId: s.id, status: ['open'] });
            return [
              c.gray(s.id.slice(0, 8)),
              s.agentId ?? c.gray('—'),
              c.gray(relativeTime(s.startedAt)),
              s.endedAt ? c.gray('ended') : c.green('active'),
              String(events.length),
              failures > 0 ? c.red(String(failures)) : c.gray('0'),
              findings.length > 0 ? c.yellow(String(findings.length)) : c.gray('0'),
            ];
          }),
          ['ID', 'AGENT', 'STARTED', 'STATE', 'EVENTS', 'FAILED', 'FINDINGS'],
        ),
      );
      console.log(c.gray('\n  cecc session --id <id>   to replay a session\n'));
      return 0;
    }

    const sessions = store.listSessions(project.id, 100);
    const session = sessions.find((s) => s.id.startsWith(opts.id!));
    if (!session) {
      console.error(c.red(`\n  No session matching '${opts.id}'.\n`));
      return 1;
    }

    let events = store.queryEvents({ projectId: project.id, sessionId: session.id, limit: opts.limit ?? 500 }).reverse();
    if (opts.filter) {
      const needle = opts.filter.toLowerCase();
      events = events.filter(
        (e) =>
          e.type.includes(needle) ||
          e.source.includes(needle) ||
          (e.command ?? '').toLowerCase().includes(needle) ||
          e.filePaths.some((p) => p.toLowerCase().includes(needle)) ||
          (needle === 'error' && e.status === 'failed'),
      );
    }

    console.log(heading(`Session replay — ${session.id.slice(0, 8)}`));
    console.log(kv('Agent', `${session.agentId ?? 'unknown'}${session.agentVersion ? ` v${session.agentVersion}` : ''}`));
    console.log(kv('Started', session.startedAt));
    console.log(kv('Ended', session.endedAt ?? c.green('still active')));
    if (session.permissionMode) console.log(kv('Permission mode', session.permissionMode));
    console.log(kv('Events', `${events.length}${opts.filter ? c.gray(` (filtered by '${opts.filter}')`) : ''}`));

    console.log(heading('Timeline'));
    for (const event of events) {
      const icon =
        event.status === 'failed' ? c.red('✖') : event.status === 'blocked' ? c.bgRed('!') : event.status === 'warning' ? c.yellow('!') : c.gray('·');
      const actor = event.source === 'agent' ? c.magenta('agent') : event.source === 'user' ? c.cyan('user ') : c.gray(event.source.padEnd(5).slice(0, 5));
      const detail = (event.command ?? event.filePaths.join(', ') ?? event.tool ?? '').slice(0, 62);
      console.log(`  ${c.gray(timeOnly(event.timestamp))} ${icon} ${actor} ${c.gray(event.type.padEnd(19))} ${detail}`);

      const ruleIds = event.findingRuleIds;
      if (ruleIds.length > 0) {
        console.log(`  ${' '.repeat(10)}${c.red('└─')} ${c.red(`findings: ${ruleIds.join(', ')}`)}`);
      }
    }
    console.log('');
    return 0;
  } finally {
    store.close();
  }
}

// -------------------------------------------------------------------- report

export function reportCommand(root: string, project: ProjectConfig, opts: { out?: string; json?: boolean }): number {
  const store = new Store(ceccPaths(root).db);
  const policies = loadPolicySet(ceccPaths(root).policies, project.environment).set;
  try {
    const session = store.getCurrentSession(project.id);
    const events = session ? store.recentSessionEvents(session.id, 1000) : [];
    const findings = store.listFindings({ projectId: project.id, status: ['open'], limit: 500 });
    const tests = store.listTestResults(project.id, 50);
    const tasks = store.listTasks(project.id);
    const chain = store.verifyEventChain(project.id);
    const run = session ? store.getWorkflowRunBySession(session.id) : null;
    const protectedTouched = events.flatMap((e) => e.filePaths).filter((f) => isProtectedPath(policies, f));

    const readiness = evaluateGates({ events, findings, tests, tasks, run, uncommittedFiles: [], protectedTouched: [...new Set(protectedTouched)] });

    if (opts.json) {
      const payload = { project: project.name, generatedAt: new Date().toISOString(), readiness, findings, tests, chain };
      const text = JSON.stringify(payload, null, 2);
      if (opts.out) writeFileSync(opts.out, text, 'utf8');
      else console.log(text);
      return 0;
    }

    const lines: string[] = [];
    lines.push(`# CECC Report — ${project.name}`, '', `_Generated ${new Date().toISOString()}_`, '');
    lines.push(`- Environment: **${project.environment}**`);
    lines.push(`- Workflow stage: **${run?.currentStage ?? 'unknown'}**`);
    lines.push(`- Events recorded: ${store.countEvents(project.id)}`);
    lines.push(`- Event chain integrity: ${chain.ok ? `verified across ${chain.checked} events` : `**BROKEN at seq ${chain.brokenAtSeq}**`}`);
    lines.push('');

    lines.push('## Readiness', '', `**${readiness.ready ? 'READY' : 'NOT READY'}**`, '');
    lines.push('| Gate | State | Detail |', '|---|---|---|');
    for (const gate of readiness.gates) {
      lines.push(`| ${gate.label} | ${gate.state.toUpperCase()} | ${gate.detail.replace(/\|/g, '\\|')} |`);
    }
    lines.push('');

    for (const layer of ['APPLICATION', 'AGENT', 'CECC'] as const) {
      const group = findings.filter((f) => f.layer === layer);
      lines.push(`## ${layer} findings (${group.length})`, '');
      if (group.length === 0) {
        lines.push('_No findings matched the active rules. This is not the same as verified secure._', '');
        continue;
      }
      for (const finding of group) {
        lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`, '');
        lines.push(`- **Rule:** ${finding.ruleId}`);
        lines.push(`- **Verification:** ${finding.verification} · confidence ${Math.round(finding.confidence * 100)}% · ${finding.detection}`);
        if (finding.affectedFiles.length) lines.push(`- **Files:** ${finding.affectedFiles.join(', ')}`);
        if (finding.command) lines.push(`- **Command:** \`${finding.command}\``);
        lines.push('', `**Impact.** ${finding.impact}`, '', `**Fix.** ${finding.recommendation}`, '');
        if (finding.evidence.length) {
          lines.push('**Evidence**', '');
          for (const ev of finding.evidence.slice(0, 6)) {
            lines.push(`- _${ev.label}_${ev.file ? ` (${ev.file}${ev.line ? `:${ev.line}` : ''})` : ''}: \`${ev.detail.split('\n')[0]?.slice(0, 160) ?? ''}\``);
          }
          lines.push('');
        }
      }
    }

    lines.push('## Limitations', '');
    lines.push('- CECC reports only what it observed. Work done outside a monitored session is absent from this report.');
    lines.push('- Findings marked POTENTIAL are pattern matches requiring human judgement, not confirmed defects.');
    lines.push('- The event chain is tamper-evident, not tamper-proof: anything with write access to the database could rebuild it.');
    lines.push('- No finding here should be read as "this project is secure". Absence of findings means no active rule matched.');
    lines.push('');

    const text = lines.join('\n');
    if (opts.out) {
      writeFileSync(opts.out, text, 'utf8');
      console.log(c.green(`\n  Report written to ${opts.out}\n`));
    } else {
      console.log(text);
    }
    return 0;
  } finally {
    store.close();
  }
}
