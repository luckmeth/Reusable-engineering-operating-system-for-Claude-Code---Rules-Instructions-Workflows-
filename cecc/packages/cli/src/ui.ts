/**
 * Terminal presentation.
 *
 * No dependency: a security tool should not pull a package tree in to print
 * coloured text. Colour is disabled when stdout is not a TTY or NO_COLOR is
 * set, so piping `cecc status` into a file produces clean output.
 */
const useColor = process.stdout.isTTY && !process.env['NO_COLOR'] && process.env['TERM'] !== 'dumb';

const wrap = (code: string) => (s: string): string => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
  bgRed: wrap('41'),
};

export const SEVERITY_COLOR: Record<string, (s: string) => string> = {
  critical: (s) => c.bold(c.red(s)),
  high: c.red,
  medium: c.yellow,
  low: c.blue,
  info: c.gray,
};

export const STATE_ICON: Record<string, string> = {
  pass: c.green('✔'),
  fail: c.red('✖'),
  pending: c.yellow('◦'),
  not_applicable: c.gray('–'),
};

export function heading(text: string): string {
  return `\n${c.bold(text)}\n${c.gray('─'.repeat(Math.min(text.length, 60)))}`;
}

export function kv(label: string, value: string, width = 22): string {
  return `  ${c.gray(label.padEnd(width))} ${value}`;
}

/** Pads accounting for ANSI escapes, which do not occupy display columns. */
export function padVisible(text: string, width: number): string {
  const visibleLength = text.replace(/\u001b\[\d+m/g, '').length;
  return text + ' '.repeat(Math.max(0, width - visibleLength));
}

export function table(rows: string[][], headers?: string[]): string {
  const all = headers ? [headers, ...rows] : rows;
  if (all.length === 0) return c.gray('  (none)');

  const widths: number[] = [];
  for (const row of all) {
    row.forEach((cell, i) => {
      const len = cell.replace(/\u001b\[\d+m/g, '').length;
      widths[i] = Math.max(widths[i] ?? 0, len);
    });
  }

  const lines: string[] = [];
  if (headers) {
    lines.push(`  ${headers.map((h, i) => padVisible(c.gray(h), widths[i] ?? 0)).join('  ')}`);
  }
  for (const row of rows) {
    lines.push(`  ${row.map((cell, i) => padVisible(cell, widths[i] ?? 0)).join('  ')}`);
  }
  return lines.join('\n');
}

/** Wraps prose to a width, preserving an indent. Long impact text is unreadable otherwise. */
export function wrapText(text: string, width = 78, indent = '    '): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + word).length + 1 > width - indent.length) {
      if (current) lines.push(indent + current.trim());
      current = `${word} `;
    } else {
      current += `${word} `;
    }
  }
  if (current.trim()) lines.push(indent + current.trim());
  return lines.join('\n');
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return iso;
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export const timeOnly = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '??:??:??' : d.toISOString().slice(11, 19);
};
