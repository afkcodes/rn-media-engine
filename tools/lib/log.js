// Output helpers. The workshop prints plain text: it has to be as readable in a
// CI log as in a terminal, so no colour and no cursor tricks.

/** @typedef {'ok'|'fail'|'warn'|'skip'|'info'} Mark */

/** @type {Record<Mark, string>} */
export const MARK = {
  ok: 'PASS',
  fail: 'FAIL',
  warn: 'WARN',
  skip: 'SKIP',
  info: '····',
};

export function heading(text) {
  console.log(`\n${text}\n${'─'.repeat([...text].length)}`);
}

export function line(text = '') {
  console.log(text);
}

/** @param {Mark} mark */
export function mark(mark_, text) {
  console.log(`  [${MARK[mark_]}] ${text}`);
}

/** Indents every line, so a multi-line git error cannot break the report's shape. */
export function detail(text) {
  for (const l of String(text).split('\n')) console.log(`         ${l}`);
}

export function warn(text) {
  console.warn(`workshop: warning: ${text}`);
}

export function fail(text) {
  console.error(`workshop: ${text}`);
}

/** Append a markdown block to GitHub's step summary when running under Actions. */
export async function stepSummary(markdown) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  const { appendFileSync } = await import('node:fs');
  appendFileSync(path, `${markdown}\n`);
}
