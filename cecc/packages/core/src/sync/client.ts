import { buildSyncPayload, payloadDigest, type SyncPayload } from './payload.js';
import type { Store } from '../storage/store.js';
import type { ProjectConfig } from '../types/project.js';

export * from './payload.js';

/** Why a sync was refused. Each maps to a specific thing the user can change. */
export type SyncRefusal =
  | 'disabled'
  | 'no-endpoint'
  | 'insecure-endpoint'
  | 'private-endpoint'
  | 'no-token';

export interface SyncPreflight {
  ok: boolean;
  refusal: SyncRefusal | null;
  message: string;
  endpoint: string | null;
  includeEvidence: boolean;
}

/** Hosts a sync endpoint must not be, unless the operator explicitly allows it. */
const PRIVATE_HOST =
  /^(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0|10(?:\.\d+){3}|192\.168(?:\.\d+){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d+){2}|169\.254(?:\.\d+){2}|\[?::1\]?)$/i;

/**
 * Checks everything that must hold before anything leaves the machine.
 *
 * Every refusal is a separate case with its own message. "Sync failed" teaches
 * nobody anything; "the endpoint is http, so the payload would cross the
 * network in clear text" tells someone exactly what to fix.
 *
 * The token is read from the environment and never from the config file or the
 * database. A credential in `.cecc/config.json` is a credential in a directory
 * people copy between machines.
 */
export function preflight(project: ProjectConfig, opts: { allowPrivateEndpoint?: boolean; token?: string | undefined } = {}): SyncPreflight {
  const sync = project.cloudSync;
  const includeEvidence = sync.includeSourceExcerpts === true;
  const base: Omit<SyncPreflight, 'ok' | 'refusal' | 'message'> = {
    endpoint: sync.endpoint,
    includeEvidence,
  };

  if (!sync.enabled) {
    return {
      ...base,
      ok: false,
      refusal: 'disabled',
      message: 'Cloud sync is disabled. Nothing is sent. Set cloudSync.enabled to true in .cecc/config.json to change that.',
    };
  }

  if (!sync.endpoint) {
    return { ...base, ok: false, refusal: 'no-endpoint', message: 'Cloud sync is enabled but cloudSync.endpoint is not set.' };
  }

  let url: URL;
  try {
    url = new URL(sync.endpoint);
  } catch {
    return { ...base, ok: false, refusal: 'no-endpoint', message: `cloudSync.endpoint is not a valid URL: ${sync.endpoint}` };
  }

  if (url.protocol !== 'https:') {
    return {
      ...base,
      ok: false,
      refusal: 'insecure-endpoint',
      message: `cloudSync.endpoint uses ${url.protocol.replace(':', '')}. Findings would cross the network in clear text — use https.`,
    };
  }

  if (PRIVATE_HOST.test(url.hostname) && !opts.allowPrivateEndpoint) {
    return {
      ...base,
      ok: false,
      refusal: 'private-endpoint',
      message: `cloudSync.endpoint points at ${url.hostname}, a private or loopback address. Pass --allow-private if that is deliberate.`,
    };
  }

  if (!opts.token) {
    return {
      ...base,
      ok: false,
      refusal: 'no-token',
      message: 'CECC_SYNC_TOKEN is not set. The token is read from the environment so it never lands in config or the database.',
    };
  }

  return {
    ...base,
    ok: true,
    refusal: null,
    message: `Ready to send to ${url.origin}${url.pathname}${includeEvidence ? ' (evidence included)' : ' (metadata only)'}.`,
  };
}

export interface SyncResult {
  sent: boolean;
  status: number | null;
  digest: string;
  bytes: number;
  message: string;
  payload: SyncPayload;
}

export interface SyncOptions {
  project: ProjectConfig;
  store: Store;
  /** Build the payload and report it without sending. */
  dryRun?: boolean;
  allowPrivateEndpoint?: boolean;
  token?: string | undefined;
  timeoutMs?: number;
  limit?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Builds the payload and, unless this is a dry run, pushes it.
 *
 * A dry run performs the whole preflight and constructs the real payload, so
 * `--dry-run` shows the bytes that would actually be sent rather than an
 * approximation of them. An approximation would defeat the purpose.
 */
export async function syncNow(opts: SyncOptions): Promise<SyncResult> {
  const { project, store } = opts;
  const token = opts.token ?? process.env['CECC_SYNC_TOKEN'];
  const check = preflight(project, {
    ...(opts.allowPrivateEndpoint === undefined ? {} : { allowPrivateEndpoint: opts.allowPrivateEndpoint }),
    token,
  });

  // A dry run is allowed even when sync is switched off — seeing what would be
  // sent is exactly how someone decides whether to switch it on.
  const payload = buildSyncPayload({
    project,
    store,
    includeEvidence: check.includeEvidence,
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
  });
  const body = JSON.stringify(payload);
  const digest = payloadDigest(payload);

  if (opts.dryRun) {
    return {
      sent: false,
      status: null,
      digest,
      bytes: Buffer.byteLength(body),
      message: check.ok ? `Dry run. ${check.message}` : `Dry run. Would be refused: ${check.message}`,
      payload,
    };
  }

  if (!check.ok || !check.endpoint || !token) {
    return { sent: false, status: null, digest, bytes: Buffer.byteLength(body), message: check.message, payload };
  }

  const http = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

  try {
    const res = await http(check.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-cecc-schema': payload.schema,
        'x-cecc-digest': digest,
      },
      body,
      signal: controller.signal,
    });

    // The audit trail records that a push happened and what its digest was.
    // The payload itself is not stored: it is derived, and keeping a copy would
    // double the amount of data at rest for no benefit.
    store.audit(project.id, 'user', 'sync.pushed', {
      endpoint: check.endpoint,
      status: res.status,
      digest,
      bytes: Buffer.byteLength(body),
      includedEvidence: check.includeEvidence,
      findings: payload.findings.length,
    });

    return {
      sent: res.ok,
      status: res.status,
      digest,
      bytes: Buffer.byteLength(body),
      message: res.ok ? `Sent ${payload.findings.length} finding(s).` : `Endpoint returned ${res.status} ${res.statusText}.`,
      payload,
    };
  } catch (err) {
    store.audit(project.id, 'user', 'sync.failed', {
      endpoint: check.endpoint,
      digest,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      sent: false,
      status: null,
      digest,
      bytes: Buffer.byteLength(body),
      message: `Push failed: ${err instanceof Error ? err.message : String(err)}`,
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}
