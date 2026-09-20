import { writeFileSync } from 'node:fs';
import { Store, ceccPaths, preflight, syncNow, type ProjectConfig } from '@cecc/core';
import { c, heading, kv } from '../ui.js';

/**
 * `cecc sync` — the only path by which project data can leave the machine.
 *
 * It defaults to a dry run. Someone who types `cecc sync` out of curiosity gets
 * the exact payload printed and nothing transmitted; sending requires
 * `--push` as well as the configuration being enabled. A tool that uploads on
 * an ambiguous command is a tool that uploads by accident.
 */
export async function syncCommand(
  root: string,
  project: ProjectConfig,
  opts: { push?: boolean; json?: boolean; out?: string; allowPrivate?: boolean; limit?: number } = {},
): Promise<number> {
  const store = new Store(ceccPaths(root).db);

  try {
    const dryRun = !opts.push;
    const result = await syncNow({
      project,
      store,
      dryRun,
      ...(opts.allowPrivate === undefined ? {} : { allowPrivateEndpoint: opts.allowPrivate }),
      ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    });

    if (opts.json) {
      console.log(JSON.stringify({ ...result, payload: result.payload }, null, 2));
      return result.sent || dryRun ? 0 : 1;
    }

    const check = preflight(project, { token: process.env['CECC_SYNC_TOKEN'] });

    console.log(heading(dryRun ? 'Cloud sync — dry run' : 'Cloud sync — push'));
    console.log(kv('Enabled', project.cloudSync.enabled ? c.yellow('yes') : c.green('no — nothing leaves this machine')));
    console.log(kv('Endpoint', project.cloudSync.endpoint ?? c.gray('not set')));
    console.log(kv('Evidence', result.payload.includesEvidence ? c.yellow('included') : c.green('excluded — metadata only')));
    console.log(kv('Findings', String(result.payload.findings.length)));
    console.log(kv('Payload size', `${result.bytes} bytes`));
    console.log(kv('Digest', result.digest));
    console.log(kv('Preflight', check.ok ? c.green('ready') : c.yellow(check.refusal ?? 'refused')));
    if (!check.ok) console.log(c.gray(`      ${check.message}`));

    console.log(heading('Deliberately excluded'));
    for (const item of result.payload.excluded) console.log(c.gray(`  · ${item}`));

    if (opts.out) {
      writeFileSync(opts.out, `${JSON.stringify(result.payload, null, 2)}\n`, 'utf8');
      console.log(`\n  ${c.green('Payload written to')} ${opts.out}`);
      console.log(c.gray('  Read it before enabling sync. This is exactly what would be transmitted.\n'));
    } else if (dryRun) {
      console.log(heading('Payload'));
      console.log(JSON.stringify(result.payload, null, 2));
      console.log('');
    }

    if (dryRun) {
      console.log(c.gray('  Dry run — nothing was sent. Add --push to transmit.\n'));
      return 0;
    }

    if (result.sent) {
      console.log(`\n  ${c.green(result.message)} HTTP ${result.status}\n`);
      return 0;
    }

    console.log(`\n  ${c.red('Not sent.')} ${result.message}\n`);
    return 1;
  } finally {
    store.close();
  }
}
