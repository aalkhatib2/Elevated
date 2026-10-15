#!/usr/bin/env node
// Generates the `headers` block of vercel.json: security headers, a
// Content-Security-Policy per page, and cache rules.
//
//   node scripts/build-headers.mjs          rewrite vercel.json
//   node scripts/build-headers.mjs --check  exit 1 if vercel.json is stale
//
// Why a generator: the pages carry inline <script> blocks and the site has no
// build step to add nonces, so the CSP pins each inline script by SHA-256
// instead of allowing 'unsafe-inline' for scripts. Edit an inline script and
// its hash changes; `npm test` fails until this is re-run, which is the point —
// a stale hash would otherwise silently stop that script in production.
//
// Everything in vercel.json other than `headers` (crons, functions) is kept.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Pages that get their own CSP. Portal pages are discovered from disk.
const TOP_LEVEL_PAGES = ['index.html', 'apply.html', 'privacy.html', 'terms.html', 'disclosures.html'];

// The one third party a page may talk to. The apply form posts to Web3Forms.
const CONNECT_EXTRA = { 'apply.html': ['https://api.web3forms.com'] };

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  },
];

const NOINDEX = { key: 'X-Robots-Tag', value: 'noindex, nofollow' };

// Static media changes rarely and is not fingerprinted, so a month plus a
// week of stale-while-revalidate: fast repeat visits, and a replaced logo
// still shows up for everyone within the month.
const MEDIA_CACHE = {
  key: 'Cache-Control',
  value: 'public, max-age=2592000, stale-while-revalidate=604800',
};

export function inlineScriptHashes(html) {
  const hashes = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
    if (type && !/^(module|text\/javascript|application\/javascript)$/i.test(type)) continue;
    // Git stores these files with LF; a Windows checkout may hold CRLF. The
    // deployed bytes are the stored ones, so hash those.
    const body = m[2].replace(/\r\n/g, '\n');
    if (!body.trim()) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return [...hashes].sort();
}

export function buildCsp({ hashes, connect = [] }) {
  const directives = [
    ["default-src", ["'self'"]],
    ['script-src', ["'self'", 'https://cdn.jsdelivr.net', ...hashes]],
    // Inline style="" attributes are used throughout; styles cannot run code.
    ['style-src', ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com']],
    ['font-src', ["'self'", 'https://fonts.gstatic.com']],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['connect-src', ["'self'", ...connect]],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['upgrade-insecure-requests', []],
  ];
  return directives.map(([name, values]) => [name, ...values].join(' ')).join('; ');
}

function pageList(root) {
  const portalDir = path.join(root, 'prototypes', 'portal');
  const portal = readdirSync(portalDir)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => `prototypes/portal/${f}`);
  return [...TOP_LEVEL_PAGES, ...portal];
}

export function buildHeaders(root = ROOT) {
  const rules = [];

  for (const page of pageList(root)) {
    let html;
    try {
      html = readFileSync(path.join(root, page), 'utf8');
    } catch {
      continue; // listed page not written yet
    }
    const csp = buildCsp({ hashes: inlineScriptHashes(html), connect: CONNECT_EXTRA[page] || [] });
    const headers = [{ key: 'Content-Security-Policy', value: csp }];
    const isPortal = page.startsWith('prototypes/portal/');
    if (isPortal) headers.push(NOINDEX);

    const sources = page === 'index.html' ? ['/', '/index.html'] : [`/${page}`];
    for (const source of sources) rules.push({ source, headers });
  }

  rules.push({
    source: '/api/(.*)',
    headers: [{ key: 'Cache-Control', value: 'no-store' }, NOINDEX],
  });
  rules.push({
    source: '/(.*)\\.(png|jpg|jpeg|webp|svg|ico|woff2)',
    headers: [MEDIA_CACHE],
  });
  rules.push({
    source: '/globe-land.json',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
  });
  // Last, so every response carries the baseline set.
  rules.push({ source: '/(.*)', headers: SECURITY_HEADERS });

  return rules;
}

export function buildConfig(root = ROOT) {
  const existing = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const { headers: _old, ...rest } = existing;
  return { ...rest, headers: buildHeaders(root) };
}

const serialize = (config) => `${JSON.stringify(config, null, 2)}\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.join(ROOT, 'vercel.json');
  const next = serialize(buildConfig());
  if (process.argv.includes('--check')) {
    const current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    if (current !== next) {
      console.error('vercel.json is out of date. Run: node scripts/build-headers.mjs');
      process.exit(1);
    }
    console.log('vercel.json headers are current.');
  } else {
    writeFileSync(target, next);
    console.log('vercel.json headers written.');
  }
}
