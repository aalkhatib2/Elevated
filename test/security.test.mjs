import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bearerMatches, clientIp, isSameOrigin } from '../api/_lib/http.js';
import { toCsv } from '../api/_lib/payroll.js';
import { buildConfig, buildCsp, inlineScriptHashes } from '../scripts/build-headers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const SHIPPED_PAGES = [
  'index.html', 'apply.html', 'privacy.html', 'terms.html', 'disclosures.html',
  ...readdirSync(path.join(ROOT, 'prototypes/portal')).filter((f) => f.endsWith('.html')).map((f) => `prototypes/portal/${f}`),
];

const req = (headers) => ({ headers: { host: 'www.joinelevated.net', ...headers } });

test('same-origin check: a browser POST from this site passes', () => {
  assert.equal(isSameOrigin(req({ 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(isSameOrigin(req({ origin: 'https://www.joinelevated.net' })), true);
});

test('same-origin check: a cross-site browser POST is refused', () => {
  assert.equal(isSameOrigin(req({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })), false);
  assert.equal(isSameOrigin(req({ 'sec-fetch-site': 'same-site' })), false);
  assert.equal(isSameOrigin(req({ origin: 'https://evil.example' })), false);
  assert.equal(isSameOrigin(req({ origin: 'null' })), false);
});

test('same-origin check: non-browser callers (no Origin) are not CSRF and pass', () => {
  assert.equal(isSameOrigin(req({})), true);
});

test('bearer check matches only a configured secret', () => {
  assert.equal(bearerMatches('Bearer s3cret', 's3cret'), true);
  assert.equal(bearerMatches('Bearer s3cret', undefined, 's3cret'), true);
  assert.equal(bearerMatches('Bearer wrong', 's3cret'), false);
  assert.equal(bearerMatches('Bearer ', ''), false, 'an empty secret must never match');
  assert.equal(bearerMatches(undefined, undefined), false);
});

test('client address comes from the edge header, first hop only', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-real-ip': '5.6.7.8' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: {} }), 'unknown');
});

test('payroll CSV: a client name cannot run as a spreadsheet formula', () => {
  const csv = toCsv({
    period: { payday: '2026-10-16' },
    reps: [{
      rep: 'Jordan Reyes',
      repTotal: -200,
      officePay: -350,
      lines: [
        { kind: 'order', orderId: 'TMO20261005ABCDE', clientName: '=HYPERLINK("http://x","y")', installDate: '2026-10-06', gigs: 1, repCommission: 200, officePay: 350 },
        { kind: 'chargeback', orderId: 'TMO20260928ZZZZZ', clientName: '@SUM(A1)', installDate: '2026-09-29', gigs: 1, repCommission: -200, officePay: -350 },
      ],
    }],
    totals: { repCommission: -200, officePay: -350 },
  });
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""y"")"`), csv);
  assert.ok(csv.includes("'@SUM(A1)"), csv);
  assert.ok(/,-200,-350\n/.test(csv), 'negative numbers stay numbers');
  assert.ok(!/(^|,)=/m.test(csv), 'no cell starts with =');
});

test('vercel.json headers are generated from the current pages (run scripts/build-headers.mjs)', () => {
  const onDisk = JSON.parse(read('vercel.json'));
  assert.deepEqual(onDisk, buildConfig(ROOT));
});

test('no page CSP allows inline or eval script', () => {
  for (const rule of buildConfig(ROOT).headers) {
    for (const h of rule.headers) {
      if (h.key !== 'Content-Security-Policy') continue;
      const scriptSrc = h.value.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
      assert.ok(scriptSrc, `${rule.source} has a script-src`);
      assert.ok(!/unsafe-inline|unsafe-eval/.test(scriptSrc), `${rule.source}: ${scriptSrc}`);
      assert.match(h.value, /frame-ancestors 'none'/);
    }
  }
});

test('inline script hashing ignores external and data scripts, normalises CRLF', () => {
  const lf = inlineScriptHashes('<script>a()\n</script><script src="x.js"></script><script type="application/json">{}</script>');
  const crlf = inlineScriptHashes('<script>a()\r\n</script>');
  assert.equal(lf.length, 1);
  assert.deepEqual(lf, crlf);
  assert.match(buildCsp({ hashes: lf }), /script-src 'self' https:\/\/cdn\.jsdelivr\.net 'sha256-/);
});

test('every CDN script is pinned with Subresource Integrity', () => {
  for (const page of SHIPPED_PAGES) {
    const tags = read(page).match(/<script[^>]*src="https:\/\/[^"]+"[^>]*>/g) || [];
    for (const tag of tags) {
      assert.match(tag, /integrity="sha(256|384|512)-[A-Za-z0-9+/=]+"/, `${page}: ${tag}`);
      assert.match(tag, /crossorigin="anonymous"/, `${page}: ${tag}`);
    }
  }
});

test('public pages link the privacy policy, terms and disclosures', () => {
  for (const page of ['index.html', 'apply.html', 'privacy.html', 'terms.html', 'disclosures.html']) {
    const html = read(page);
    for (const link of ['privacy.html', 'terms.html', 'disclosures.html']) {
      assert.ok(html.includes(`href="${link}"`), `${page} links ${link}`);
    }
  }
});

test('apply form will not submit without contact consent', () => {
  const html = read('apply.html');
  const box = html.match(/<input type="checkbox" id="consent"[^>]*>/);
  assert.ok(box, 'consent checkbox present');
  assert.ok(!/checked/.test(box[0]), 'consent is never pre-ticked');
  assert.match(html, /4: !!\(answers\.day && answers\.time && answers\.consent\)/);
  assert.ok(!html.includes('EL-2026-0871'), 'no fake application number');
});

test('portal pages are kept out of search engines', () => {
  for (const page of SHIPPED_PAGES.filter((p) => p.startsWith('prototypes/portal/'))) {
    assert.match(read(page), /<meta name="robots" content="noindex, nofollow">/, page);
  }
});
