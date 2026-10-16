import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
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

// Runs apply.html's own funnel script against a stub DOM and drives it like a
// user would: type into the fields, pick answers, press Continue / Request
// Interview. `sent` counts calls to fetch, i.e. applications actually posted.
function applyFunnel() {
  const html = read('apply.html');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((c) => c.includes('submitApplication'));
  assert.ok(code, 'funnel script found');

  const el = (tag = 'DIV') => {
    const attrs = {};
    const node = {
      tagName: tag, dataset: {}, style: {}, hidden: false, textContent: '', disabled: false, children: [], listeners: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), removeAttribute(k) { delete attrs[k]; },
      querySelector: () => el(), querySelectorAll: () => [], closest: () => null,
      addEventListener(t, f) { (node.listeners[t] = node.listeners[t] || []).push(f); },
      appendChild(c) { node.children.push(c); }, focus() {}, remove() {},
      set innerHTML(v) { node.children = []; },
    };
    return node;
  };
  const byId = {};
  const getElementById = (id) => (byId[id] = byId[id] || el(['fullName', 'phone', 'email', 'consent'].includes(id) ? 'INPUT' : 'DIV'));
  const docListeners = {};
  const document = {
    getElementById,
    querySelector: (sel) => (/^#[\w-]+$/.test(sel) ? getElementById(sel.slice(1)) : el()),
    querySelectorAll: () => [],
    createElement: () => el('BUTTON'),
    addEventListener(t, f) { (docListeners[t] = docListeners[t] || []).push(f); },
  };
  const state = { sent: 0 };
  const fetch = () => { state.sent++; return Promise.resolve({ json: () => ({ success: true }) }); };
  const window = { matchMedia: () => ({ matches: true }), scrollTo() {} };
  vm.runInNewContext(code, { document, window, fetch, setTimeout, console });

  const click = (match) => docListeners.click.forEach((f) => f({ target: { closest: match } }));
  return Object.assign(state, {
    type: (id, value) => byId[id].listeners.input.forEach((f) => f({ target: { value } })),
    choose: (q, val) => click((sel) => (sel === '[data-q]' ? Object.assign(el('BUTTON'), { dataset: { q, val }, parentElement: el() }) : null)),
    next: () => click((sel) => (sel === '[data-next]' ? el('BUTTON') : null)),
    consent: (checked) => byId.consent.listeners.change.forEach((f) => f({ target: { checked } })),
    // Walks all four steps; returns once Request Interview has been pressed.
    run({ phone = '(801) 555-0142', email = 'jordan@email.com', consent }) {
      this.type('fullName', 'Jordan Reyes'); this.type('phone', phone); this.type('email', email); this.next();
      this.choose('exp', 'Door to door'); this.next();
      this.choose('camp', 'Fiber'); this.next();
      this.choose('day', 'Monday'); this.choose('time', '9:00 AM – 12:00 PM');
      if (consent) this.consent(true);
      this.next();
    },
  });
}

test('apply form will not submit without contact consent', () => {
  const html = read('apply.html');
  const box = html.match(/<input type="checkbox" id="consent"[^>]*>/);
  assert.ok(box, 'consent checkbox present');
  assert.ok(!/\bchecked\b/.test(box[0]), 'consent is never pre-ticked');
  assert.ok(!html.includes('EL-2026-0871'), 'no fake application number');

  const withoutConsent = applyFunnel();
  withoutConsent.run({ consent: false });
  withoutConsent.next();   // pressing again changes nothing
  assert.equal(withoutConsent.sent, 0, 'nothing is posted while consent is unticked');

  const unticked = applyFunnel();
  unticked.run({ consent: false });
  unticked.consent(true); unticked.consent(false);
  unticked.next();
  assert.equal(unticked.sent, 0, 'ticking then unticking still blocks it');

  const withConsent = applyFunnel();
  withConsent.run({ consent: true });
  assert.equal(withConsent.sent, 1, 'a complete application with consent is posted once');
});

test('apply form will not advance past a bad phone number or email', () => {
  for (const [phone, email] of [['555-0142', 'jordan@email.com'], ['(801) 555-01422', 'jordan@email.com'], ['call me', 'jordan@email.com'], ['(801) 555-0142', 'jordan@email'], ['(801) 555-0142', 'jordan email.com']]) {
    const f = applyFunnel();
    f.run({ phone, email, consent: true });
    assert.equal(f.sent, 0, `blocked: ${phone} / ${email}`);
  }
  for (const phone of ['8015550142', '1 (801) 555-0142', '+1 801.555.0142']) {
    const f = applyFunnel();
    f.run({ phone, consent: true });
    assert.equal(f.sent, 1, `accepted: ${phone}`);
  }
});

test('portal pages are kept out of search engines', () => {
  for (const page of SHIPPED_PAGES.filter((p) => p.startsWith('prototypes/portal/'))) {
    assert.match(read(page), /<meta name="robots" content="noindex, nofollow">/, page);
  }
});
