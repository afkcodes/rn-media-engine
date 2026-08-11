#!/usr/bin/env node
// Turn a `workshop dry-run --json` report into exactly ONE tracking issue.
//
// Same contract as rn-media's scripts/check-upstream.mjs issue upkeep: one
// issue, found by label; a closed one is reopened rather than replaced, so drift
// that comes back does not spawn issue #2; an unchanged body is not rewritten,
// so a weekly no-op does not notify subscribers.
//
// It surfaces and nothing else. It never edits a patch and never opens a PR.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { markdownTable } from './lib/table.js';

const LABEL = 'engine-drift';
const TITLE_PREFIX = 'Engine drift:';
const MARKER = '<!-- rn-media-engine-master-watch -->';
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
const REPO = process.env.GITHUB_REPOSITORY;
const RUN_URL = process.env.RUN_URL || '';

async function gh(path, opt = {}) {
  const res = await fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
    method: opt.method ?? 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'rn-media-engine-master-watch',
      authorization: `Bearer ${TOKEN}`,
      ...(opt.body ? { 'content-type': 'application/json' } : {}),
    },
    body: opt.body ? JSON.stringify(opt.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  try {
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, error: 'invalid JSON' };
  }
}

export function summarise(report) {
  const rows = [];
  let rejections = 0;
  let hazards = 0;
  for (const r of report) {
    if (r.error) {
      rows.push([`${r.dep} ${r.ref}`, 'could not fetch', '—', r.error]);
      continue;
    }
    const failed = (r.series ?? []).flatMap((s) => s.results.filter((x) => x.result === 'failed'));
    rejections += failed.length;
    hazards += r.options?.hazards ?? 0;
    rows.push([
      `${r.dep} ${r.ref}`,
      failed.length ? failed.map((f) => `\`${f.id}\``).join(', ') : 'none',
      String(r.options?.hazards ?? 0),
      `pinned: \`${r.pinned}\``,
    ]);
  }
  return { rows, rejections, hazards };
}

export function body(report, text) {
  const { rows, rejections, hazards } = summarise(report);
  const detailBlocks = [];
  for (const r of report) {
    if (r.error) continue;
    const failed = (r.series ?? []).flatMap((s) => s.results.filter((x) => x.result === 'failed'));
    for (const f of failed) {
      const anchors = (f.anchors ?? []).filter((a) => a.state !== 'found' && a.state !== 'applied');
      detailBlocks.push(
        [
          `#### \`${f.id}\` against ${r.dep} ${r.ref}`,
          '',
          anchors.length
            ? anchors.map((a) => `- anchor \`${a.file}\` #${a.index}: **${a.state}** (matched ${a.pristineCount}x, expected ${a.expectCount})${a.note ? ` — ${a.note}` : ''}`).join('\n')
            : '```\n' + String(f.reason).slice(0, 1500) + '\n```',
        ].join('\n'),
      );
    }
    const o = r.options ?? {};
    if (o.newAuto?.length) {
      detailBlocks.push(`#### New \`auto\` options in ${r.dep} ${r.ref} that we do not name\n\nEach builds itself in if its dependency resolves — the \`avfoundation\` class.\n\n\`${o.newAuto.join('` `')}\``);
    }
    if (o.removed?.length) {
      detailBlocks.push(`#### Options ${r.dep} ${r.ref} REMOVED that we still pass\n\nmeson hard-errors on each.\n\n\`${o.removed.join('` `')}\``);
    }
    if (o.typeChanged?.length) {
      detailBlocks.push(`#### Options whose TYPE changed in ${r.dep} ${r.ref}\n\nOur spelling is now wrong.\n\n\`${o.typeChanged.join('` `')}\``);
    }
    if (o.unmatched?.length) {
      detailBlocks.push(`#### FFmpeg component flags matching nothing in ${r.dep} ${r.ref}\n\nconfigure warns and carries on, so this has to be read here.\n\n\`${o.unmatched.map((u) => u.flag).join('` `')}\``);
    }
  }

  return [
    MARKER,
    `**${rejections} patch rejection(s) and ${hazards} option hazard(s) against upstream master.**`,
    '',
    'This is a weekly `workshop dry-run` against `mpv-player/mpv@master` and',
    '`FFmpeg/FFmpeg@master`. It is a REPORT: master is a moving target, rejections',
    'against it are expected, and nothing here blocks a release. The point is to',
    'learn that an anchor moved before the release lands, not after.',
    '',
    'Nothing is auto-bumped and no PR is opened. Rebasing a patch series is not a',
    "robot's job.",
    '',
    '## Summary',
    '',
    markdownTable([['Candidate', 'Rejected patches', 'Option hazards', 'Notes'], ...rows]),
    '',
    ...(detailBlocks.length ? ['## Detail', '', detailBlocks.join('\n\n')] : []),
    '',
    '<details><summary>Full console report</summary>',
    '',
    '```',
    text.slice(0, 40_000),
    '```',
    '',
    '</details>',
    '',
    '---',
    '',
    `<sub>Regenerated by \`.github/workflows/master-watch.yml\`. Edits are overwritten.${RUN_URL ? ` [Run](${RUN_URL}).` : ''} Last run: ${new Date().toISOString()}.</sub>`,
  ].join('\n');
}

async function main() {
  if (!TOKEN || !REPO) throw new Error('GH_TOKEN and GITHUB_REPOSITORY are required');
  const { report } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const text = readFileSync(process.argv[3], 'utf8');
  const { rejections, hazards } = summarise(report);
  const fetchFailed = report.some((r) => r.error);

  const title = `${TITLE_PREFIX} ${rejections} patch rejection(s), ${hazards} option hazard(s) vs master`;
  const issueBody = body(report, text);
  const wantsIssue = rejections > 0 || hazards > 0 || fetchFailed;

  const label = await gh(`/repos/${REPO}/labels/${LABEL}`);
  if (!label.ok && label.status === 404) {
    await gh(`/repos/${REPO}/labels`, {
      method: 'POST',
      body: { name: LABEL, color: 'fbca04', description: 'The patch series or the flag semantics drifted against upstream master' },
    });
  }

  const list = await gh(`/repos/${REPO}/issues?labels=${LABEL}&state=open&per_page=100`);
  if (!list.ok) throw new Error(`could not list issues: ${list.error}`);
  const open = (list.data ?? []).filter((i) => !i.pull_request);

  if (!wantsIssue) {
    if (open.length === 0) {
      console.log('No drift against master and no open issue — nothing to do.');
      return;
    }
    for (const issue of open) {
      await gh(`/repos/${REPO}/issues/${issue.number}/comments`, {
        method: 'POST',
        body: { body: `${MARKER}\nThe full series applies to upstream master and every flag still resolves, as of ${new Date().toISOString()}. Closing; reopened automatically if drift returns.` },
      });
      await gh(`/repos/${REPO}/issues/${issue.number}`, { method: 'PATCH', body: { title, body: issueBody, state: 'closed', state_reason: 'completed' } });
      console.log(`Closed #${issue.number}.`);
    }
    return;
  }

  let target = open[0];
  if (!target) {
    const closed = await gh(`/repos/${REPO}/issues?labels=${LABEL}&state=closed&sort=updated&direction=desc&per_page=20`);
    if (closed.ok) target = (closed.data ?? []).find((i) => !i.pull_request && String(i.title).startsWith(TITLE_PREFIX) && String(i.body ?? '').includes(MARKER));
  }

  if (!target) {
    const created = await gh(`/repos/${REPO}/issues`, { method: 'POST', body: { title, body: issueBody, labels: [LABEL] } });
    if (!created.ok) throw new Error(`could not create issue: ${created.error}`);
    console.log(`Created #${created.data.number}: ${title}`);
    return;
  }

  // An unchanged report should not notify every week. The timestamp and the run
  // URL are the only things that always differ, so they are stripped first.
  const strip = (b) => String(b ?? '').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>').replace(/actions\/runs\/\d+/g, 'actions/runs/<id>');
  if (target.state === 'open' && target.title === title && strip(target.body) === strip(issueBody)) {
    console.log(`#${target.number} already up to date.`);
    return;
  }
  const patched = await gh(`/repos/${REPO}/issues/${target.number}`, { method: 'PATCH', body: { title, body: issueBody, state: 'open' } });
  if (!patched.ok) throw new Error(`could not update issue #${target.number}: ${patched.error}`);
  console.log(`${target.state === 'closed' ? 'Reopened' : 'Updated'} #${target.number}: ${title}`);
}

// Only run when invoked as a script — the report rendering is imported by
// tests, and a module that fires network calls on import cannot be tested.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`watch-issue: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
}
