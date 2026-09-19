import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The desktop build ships this server inside Electron, which has no install
  // step. Standalone output emits the server plus exactly the node_modules it
  // traced, so the packaged application carries no dev dependencies.
  output: 'standalone',
  // @cecc/core is a workspace package shipped as compiled ESM.
  transpilePackages: ['@cecc/core'],
  // node:sqlite is resolved by Node at runtime through createRequire; the
  // bundler must not try to inline it.
  serverExternalPackages: ['node:sqlite'],
  // The monorepo has its own lockfile; without this Next walks up and picks the
  // wrong workspace root for file tracing.
  outputFileTracingRoot: resolve(here, '../..'),
};

export default nextConfig;
