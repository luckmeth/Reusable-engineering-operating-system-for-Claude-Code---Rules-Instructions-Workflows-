/**
 * Installs a filter for one specific Node warning, as an import side effect.
 *
 * `node:sqlite` is still flagged experimental and announces itself on stderr
 * when loaded. CECC runs as a Claude Code hook, and hook stderr is shown to the
 * developer — on some events it is fed back to the agent — so an unsolicited
 * runtime warning on every tool call would be noise at best and misleading
 * context at worst.
 *
 * This lives in its own module rather than inline because ES module imports are
 * evaluated in declaration order: importing this file before `node:sqlite`
 * guarantees the filter is in place before the warning can fire. Doing it with
 * a dynamic import worked at runtime but defeated static analysis in bundlers.
 *
 * Only this exact warning is suppressed; everything else propagates normally.
 */
const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : (warning?.message ?? '');
  if (text.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
