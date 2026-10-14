import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RANGES, rangeCutoff } from '../api/_lib/range.js';

// Wednesday 14 Oct 2026, mid-afternoon UTC.
const wed = new Date('2026-10-14T15:30:00Z');

test('all time (and anything unknown) has no cutoff', () => {
  assert.equal(rangeCutoff('all', wed), null);
  assert.equal(rangeCutoff('bogus', wed), null);
  assert.equal(rangeCutoff(undefined, wed), null);
});

test('last month is the last 30 days, last week the last 7', () => {
  assert.equal(rangeCutoff('last-month', wed), '2026-09-14');
  assert.equal(rangeCutoff('last-week', wed), '2026-10-07');
});

test('this week starts on the most recent Monday', () => {
  assert.equal(rangeCutoff('this-week', wed), '2026-10-12');
  assert.equal(rangeCutoff('this-week', new Date('2026-10-12T00:00:00Z')), '2026-10-12'); // Monday itself
  assert.equal(rangeCutoff('this-week', new Date('2026-10-18T23:59:00Z')), '2026-10-12'); // Sunday
});

test('the range uses the UTC day, so it cannot depend on the server timezone', () => {
  assert.equal(rangeCutoff('last-week', new Date('2026-10-14T00:30:00Z')), '2026-10-07');
  assert.equal(rangeCutoff('last-week', new Date('2026-10-14T23:30:00Z')), '2026-10-07');
});

test('every range the buttons send is one the API recognises', () => {
  const html = ['overview', 'orders', 'commission', 'team']
    .map((p) => readFileSync(new URL(`../prototypes/portal/${p}.html`, import.meta.url), 'utf8')).join('\n');
  const sent = [...html.matchAll(/data-(?:ov|orders|cm|team)-range="([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(sent.length >= 16, 'expected four buttons on each of four pages');
  for (const r of sent) assert.ok(RANGES.includes(r), `unknown range in markup: ${r}`);
});

test('the browser helper and the server helper agree', () => {
  // portal.js can't be imported (it needs a DOM), so run its helper in a stub window.
  const src = readFileSync(new URL('../prototypes/portal/portal.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('window.portalRangeCutoff = function'), src.indexOf('// Download rows as a CSV file'));
  const window = {};
  const RealDate = Date;
  for (const range of RANGES) {
    for (const now of ['2026-10-12T00:00:00Z', '2026-10-14T15:30:00Z', '2026-10-18T23:59:00Z', '2026-01-02T08:00:00Z']) {
      globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } };
      try {
        new Function('window', body)(window);
        assert.equal(window.portalRangeCutoff(range), rangeCutoff(range, new RealDate(now)), `${range} @ ${now}`);
      } finally {
        globalThis.Date = RealDate;
      }
    }
  }
});
