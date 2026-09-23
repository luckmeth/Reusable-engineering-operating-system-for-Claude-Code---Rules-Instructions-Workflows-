import { describe, expect, it } from 'vitest';
import { detectSecrets, isSupabaseServiceRoleJwt, maskValue, redact, redactDeep } from '../src/secrets.js';
import { fakeJwt, fixture } from './helpers.js';

describe('secret detection', () => {
  it('distinguishes a Supabase service-role key from an anon key', () => {
    // These are visually identical and have wildly different blast radii.
    const service = detectSecrets(`const k = "${fakeJwt('service_role')}"`);
    const anon = detectSecrets(`const k = "${fakeJwt('anon')}"`);

    expect(service[0]?.kind).toBe('supabase_service_role');
    expect(service[0]?.privileged).toBe(true);
    expect(anon[0]?.kind).toBe('jwt');
    expect(anon[0]?.privileged).toBe(false);
  });

  it.each([
    ['github token', fixture.githubPat(), 'github_token'],
    ['aws key', fixture.awsAccessKey(), 'aws_access_key'],
    ['stripe live key', fixture.stripeLive(), 'stripe_key'],
    ['anthropic key', fixture.anthropicKey(), 'anthropic_key'],
    ['npm token', fixture.npmToken(), 'npm_token'],
  ])('detects a %s', (_label, value, kind) => {
    const found = detectSecrets(`const token = "${value}"`);
    expect(found.map((f) => f.kind)).toContain(kind);
  });

  it('extracts only the password from a connection string, keeping the host readable', () => {
    const found = detectSecrets('DATABASE_URL=postgres://admin:sup3rS3cret@db.host:5432/app');
    expect(found).toHaveLength(1);
    expect(found[0]?.value).toBe('sup3rS3cret');
    expect(redact('DATABASE_URL=postgres://admin:sup3rS3cret@db.host:5432/app')).toContain('db.host:5432');
  });

  it.each([
    'const apiKey = "your-api-key-here"',
    'API_KEY=process.env.API_KEY',
    'const secret = "xxxxxxxxxxxxxxxx"',
    'password: "<YOUR_PASSWORD>"',
    'token = "${TOKEN}"',
    'api_key: "changeme12345678"',
  ])('ignores the placeholder %s', (text) => {
    expect(detectSecrets(text)).toHaveLength(0);
  });

  it('produces no findings on ordinary code', () => {
    const code = `
      const userName = "jonathan-smith-account";
      const endpoint = "https://api.example.com/v1/resources";
      const description = "This function validates the session token format";
      export const MAX_RETRIES = 5;
    `;
    expect(detectSecrets(code)).toHaveLength(0);
  });
});

describe('redaction', () => {
  it('masks the value but keeps a suffix so the key can be identified for rotation', () => {
    const token = fixture.githubPat();
    const masked = maskValue(token);
    expect(masked).not.toContain(token.slice(4, 20));
    expect(masked).toContain(token.slice(-4));
  });

  it('never lets a credential through to storage', () => {
    const secret = fixture.stripeLive();
    expect(redact(`stripe.init("${secret}")`)).not.toContain(secret);
  });

  it('redacts recursively through nested structures', () => {
    const secret = fixture.githubPat();
    const result = redactDeep({ outer: { list: [{ token: secret }] } }) as { outer: { list: Array<{ token: string }> } };
    expect(result.outer.list[0]?.token).not.toContain(secret);
  });

  it('leaves text without secrets byte-identical', () => {
    const text = 'function add(a: number, b: number) { return a + b; }';
    expect(redact(text)).toBe(text);
  });

  it('survives adversarial input without throwing', () => {
    for (const input of ['', 'a'.repeat(100_000), '\u0000￿', '}{][)(', '%s%s%n', '../'.repeat(500)]) {
      expect(() => redact(input)).not.toThrow();
    }
  });

  it('does not treat an anon JWT as privileged', () => {
    expect(isSupabaseServiceRoleJwt(fakeJwt('anon'))).toBe(false);
    expect(isSupabaseServiceRoleJwt('not.a.jwt')).toBe(false);
    expect(isSupabaseServiceRoleJwt('')).toBe(false);
  });
});

/**
 * Regression cover for the documentation false positive.
 *
 * A README showing `postgresql://USER:PASSWORD@HOST/db` was reported as a
 * leaked privileged credential at CRITICAL, 94% confidence. The captured value
 * is the password segment alone — `PASSWORD` — which the anchored placeholder
 * check did not recognise.
 *
 * The second half of this block matters more than the first: suppressing too
 * much is how a scanner goes quiet on a real leak, so every case below pairs
 * the placeholder with a credential of the same shape that must still fire.
 */
describe('placeholders in documentation', () => {
  const passwordsIn = (text: string) =>
    detectSecrets(text)
      .filter((m) => m.kind === 'connection_string_password')
      .map((m) => m.value);

  it('ignores the connection string every README shows', () => {
    expect(passwordsIn('postgresql://USER:PASSWORD@HOST/neondb?sslmode=require')).toEqual([]);
    expect(passwordsIn('postgres://user:password@localhost:5432/db')).toEqual([]);
    expect(passwordsIn('mongodb+srv://USERNAME:YOUR_PASSWORD@cluster0.mongodb.net')).toEqual([]);
    expect(passwordsIn('mysql://root:<your-password>@127.0.0.1/app')).toEqual([]);
    expect(passwordsIn('redis://user:[password]@redis:6379')).toEqual([]);
  });

  it('still reports a connection string carrying a real password', () => {
    expect(passwordsIn('postgresql://app:hunter2Xk9qLm@db.internal/prod')).toEqual(['hunter2Xk9qLm']);
    expect(passwordsIn('postgres://svc:aB3%40kL9zQw1@10.0.0.4:5432/main')).toEqual(['aB3%40kL9zQw1']);
  });

  it('ignores env-variable names given as values', () => {
    expect(detectSecrets('api_key = "YOUR_API_KEY_HERE"')).toEqual([]);
    expect(detectSecrets('password: "DB_PASSWORD"')).toEqual([]);
    expect(detectSecrets('secret = "replace-with-your-secret"')).toEqual([]);
  });

  it('does not suppress an all-caps value that is actually a key', () => {
    // No underscore, so it is not variable-name shaped and must still fire.
    const found = detectSecrets('api_key = "AB12CD34EF56GH78IJ90"');
    expect(found.map((m) => m.value)).toEqual(['AB12CD34EF56GH78IJ90']);
  });
});
