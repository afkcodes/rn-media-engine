// Box-drawing table + markdown table. Rendering only; no domain knowledge.

/**
 * @param {string[][]} rows first row is the header
 * @returns {string}
 */
export function asciiTable(rows) {
  if (rows.length === 0) return '';
  const cols = Math.max(...rows.map((r) => r.length));
  const norm = rows.map((r) => Array.from({ length: cols }, (_, i) => String(r[i] ?? '')));
  const widths = norm[0].map((_, c) => Math.max(...norm.map((r) => [...r[c]].length)));
  const line = (l, m, r) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const pad = (s, w) => s + ' '.repeat(Math.max(0, w - [...s].length));
  const fmt = (r) => '│ ' + r.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │';
  return [
    line('┌', '┬', '┐'),
    fmt(norm[0]),
    line('├', '┼', '┤'),
    ...norm.slice(1).map(fmt),
    line('└', '┴', '┘'),
  ].join('\n');
}

/**
 * @param {string[][]} rows first row is the header
 * @returns {string}
 */
export function markdownTable(rows) {
  if (rows.length === 0) return '';
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
  const head = rows[0].map(esc);
  return [
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.map(esc).join(' | ')} |`),
  ].join('\n');
}

/** Wrap `text` to `width` columns, indenting continuation lines. */
export function wrap(text, width = 78, indent = '') {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = indent + w;
    } else {
      line = line ? `${line} ${w}` : indent + w;
    }
  }
  if (line) out.push(line);
  return out.join('\n');
}
