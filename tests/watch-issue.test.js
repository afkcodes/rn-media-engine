// The master-watch issue body is generated from a dry-run JSON report. It must
// render without a token and without a network, or the only way to review it is
// to wait a week for the scheduled run.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { body, summarise } from '../tools/watch-issue.mjs';

const report = [
  {
    dep: 'mpv',
    ref: 'master',
    pinned: '0.41.0',
    series: [
      {
        label: 'android/audio',
        results: [
          { id: '001-lavc-set-java-vm', kind: 'diff', result: 'applied', reason: 'clean' },
          { id: '003-pcm-tap', kind: 'anchored', result: 'failed', reason: '1/7 anchor(s) did not match', anchors: [{ file: 'common/global.h', index: 4, state: 'gone', pristineCount: 0, expectCount: 1, note: 'one tap per mpv core' }] },
        ],
      },
    ],
    options: { newAuto: ['amf', 'libcurl'], removed: [], typeChanged: [], hazards: 2 },
  },
  { dep: 'ffmpeg', ref: 'master', error: 'HTTP 502' },
];

test('summarise counts rejections and hazards, and survives a failed fetch', () => {
  const s = summarise(report);
  assert.equal(s.rejections, 1);
  assert.equal(s.hazards, 2);
  assert.equal(s.rows.length, 2);
});

test('the issue body names the lost anchor and the new auto options', () => {
  const md = body(report, 'console output here');
  assert.match(md, /<!-- rn-media-engine-master-watch -->/);
  assert.match(md, /1 patch rejection\(s\) and 2 option hazard\(s\)/);
  assert.match(md, /common\/global\.h.*\*\*gone\*\*/);
  assert.match(md, /one tap per mpv core/);
  assert.match(md, /libcurl/);
  assert.match(md, /console output here/);
  // It must be explicit that nothing is auto-bumped.
  assert.match(md, /no PR is opened/);
});

test('a clean report produces a body with no detail section', () => {
  const clean = [{ dep: 'mpv', ref: 'master', pinned: '0.41.0', series: [{ label: 'android/audio', results: [{ id: '001', result: 'applied', reason: 'clean' }] }], options: { newAuto: [], removed: [], typeChanged: [], hazards: 0 } }];
  const md = body(clean, '');
  assert.equal(summarise(clean).rejections, 0);
  assert.doesNotMatch(md, /## Detail/);
});
