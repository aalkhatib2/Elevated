// Reads the live fiber-sales tracker directly from Google Sheets.
//
// The workbook has one tab per week (e.g. "AUG24 to AUG30"), added by hand
// every week, plus a hand-maintained "Summary" tab whose per-rep totals are
// COUNTIF formulas that hardcode each week's tab name — someone has to
// remember to extend it every week. We never read Summary. Instead we
// discover weekly tabs dynamically and compute totals ourselves, so a new
// week's tab is picked up automatically with zero code changes.
//
// Each weekly tab: title in A1, header row at row 4, data from row 5,
// columns Date | Sales Rep | Order # | # of Gigs | Client Name. Data ends
// wherever the Date column goes blank — never assume a fixed row count.
//
// Auth, in order of preference:
//
//   1. A service account (GOOGLE_SERVICE_ACCOUNT_EMAIL + _PRIVATE_KEY).
//      Works against a *private* sheet — share the sheet with the service
//      account's email as Viewer and the link can go back to restricted.
//      This is the wanted end state now that money is in the data.
//   2. A restricted, Sheets-API-only API key (GOOGLE_SHEETS_API_KEY).
//      Only works against a publicly link-readable resource, so using it
//      means the sheet stays shared "Anyone with the link → Viewer" —
//      i.e. every rep's commission is visible to anyone holding the URL.
//
// The API key came first because the original GCP project's org policy
// blocked service-account key creation. A GCP project created under a
// personal account has no such policy, which is the way out.
//
// Whichever is configured, the fetch path is otherwise identical.

import { createSign } from 'node:crypto';

const WEEKLY_TAB_RE = /^[A-Z]{3}\d{1,2}\s+to\s+[A-Z]{3}\d{1,2}$/i;
const CACHE_TTL_MS = 60 * 1000;

// Pure latency optimization under Fluid Compute's instance reuse — never a
// correctness dependency. Different concurrent instances hold independent
// copies, and any instance can cold-start at any time.
let cache = null; // { expiresAt, orders }

// Access tokens last an hour; re-minting one per request would add a second
// round trip to every page load for no reason.
let tokenCache = null; // { token, expiresAt }

// Signs a JWT with the service account's key and trades it for an access
// token. Hand-rolled rather than pulling in googleapis: one sign, one POST,
// against a stable documented endpoint — the dependency would be far larger
// than the code it replaces.
async function getServiceAccountToken() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (!email || !rawKey) return null; // not configured — caller falls back to the API key

  // 30s of slack so a token can't expire mid-flight.
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.token;

  // Env vars can't carry real newlines, so the PEM is stored with literal \n.
  const privateKey = rawKey.replace(/\\n/g, '\n');
  const now = Math.floor(Date.now() / 1000);

  const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      iss: email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ].join('.');

  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${signature}`,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google token exchange failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  return tokenCache.token;
}

async function sheetsFetch(path, params = {}) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID is not set');

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else if (value !== undefined) url.searchParams.set(key, value);
  }

  const headers = {};
  const token = await getServiceAccountToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else {
    const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
    if (!apiKey) {
      throw new Error(
        'No Sheets credentials: set GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (preferred), or GOOGLE_SHEETS_API_KEY'
      );
    }
    url.searchParams.set('key', apiKey);
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Sheets API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function listWeeklyTabs() {
  const data = await sheetsFetch('', { fields: 'sheets.properties.title' });
  const titles = (data.sheets || []).map((s) => s.properties.title);

  const weekly = [];
  for (const title of titles) {
    if (/^summary$/i.test(title)) continue;
    if (WEEKLY_TAB_RE.test(title)) weekly.push(title);
    else console.warn(`[sheets] skipping tab with an unrecognized name: "${title}"`);
  }
  return weekly;
}

// Sheets `values.batchGet` returns FORMATTED_VALUE strings by default
// (explicitly requested below too), so dates arrive as "08/31/2026" —
// already the display string, not a raw serial number.
// Exported (along with parseWeekRows/normalizeName below) purely so these
// pure, I/O-free functions can be unit-tested directly.
export function toISODate(raw) {
  if (raw == null || raw === '') return null;
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// Strips currency formatting — FORMATTED_VALUE means a money column arrives
// as "$350.00" or "1,250", not a bare number.
export function toNumber(raw) {
  if (raw == null || raw === '') return null;
  const n = Number.parseFloat(String(raw).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Columns are located by header text, never by position. The weekly tabs have
// already drifted apart — "AUG31 to SEP6" gained an "Install date" column that
// the older tabs don't have, which silently shifted Client Name from E to F —
// and a Commission column is landing on top of that. Positional parsing
// mislabels data when that happens without erroring, so it reads row 4 and
// maps names instead: a tab can gain columns, in any order, and still parse.
const HEADER_ALIASES = {
  date:          ['date', 'order date'],
  salesRep:      ['sales rep', 'rep', 'salesrep'],
  orderId:       ['order #', 'order id', 'order number', 'order'],
  gigs:          ['# of gigs', 'gigs', 'no of gigs', 'number of gigs'],
  installDate:   ['install date', 'installed', 'install'],
  clientName:    ['client name', 'client', 'customer', 'customer name'],
  status:        ['status', 'order status'],
  // Two separate money columns, deliberately not interchangeable: what the
  // rep earns, and what the office collects from the carrier. Bare
  // "commission" maps to the rep's number because that's what a rep reading
  // their own portal means by it.
  repCommission: ['rep commission', 'commission', 'rep pay', 'rep payout'],
  officePay:     ['office pay', 'office', 'office revenue', 'gross'],
};

// Fallback rate card, used per order only when the sheet has no money column
// for it. Sheet values always win, so a one-off override or a corrected row
// stays correct — this just means the portal shows real numbers now instead
// of waiting on someone to add formula columns to every weekly tab.
//
// Changing a rate here re-prices historical orders too. Once rates actually
// change, put the money in the sheet (where each row keeps the rate it was
// written at) rather than editing these.
export const RATES = {
  repCommission: { 1: 200, 2: 300 },
  officePay:     { 1: 350, 2: 450 },
};

function rateFor(kind, gigs) {
  if (gigs == null) return null;
  const value = RATES[kind][gigs];
  return value === undefined ? null : value;
}

function normalizeHeader(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function mapHeaders(headerRow = []) {
  const cols = {};
  headerRow.forEach((cell, i) => {
    const norm = normalizeHeader(cell);
    if (!norm) return;
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      // First match wins, so a duplicate header later in the row can't
      // silently steal a column that was already resolved.
      if (cols[field] === undefined && aliases.includes(norm)) cols[field] = i;
    }
  });
  return cols;
}

export function parseWeekRows(week, values) {
  const rows = [];
  if (!values.length) return rows;

  // values[0] is the header row (sheet row 4); data starts at values[1] (row 5).
  const cols = mapHeaders(values[0]);
  if (cols.date === undefined || cols.salesRep === undefined) {
    console.warn(`[sheets] "${week}": row 4 has no recognizable Date/Sales Rep header — skipping tab`);
    return rows;
  }

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const cell = (field) => (cols[field] === undefined ? undefined : row[cols[field]]);
    const text = (field) => String(cell(field) || '').trim();

    const date = toISODate(cell('date'));
    if (!date) break; // blank/unparseable Date cell = end of this tab's data

    const gigsRaw = cell('gigs');
    const gigs = toNumber(gigsRaw);
    if (gigsRaw != null && gigsRaw !== '' && gigs === null) {
      console.warn(`[sheets] "${week}" row ${i + 4}: unparseable # of Gigs "${gigsRaw}"`);
    }

    const sheetRepCommission = toNumber(cell('repCommission'));
    const sheetOfficePay = toNumber(cell('officePay'));
    const repCommission = sheetRepCommission ?? rateFor('repCommission', gigs);
    const officePay = sheetOfficePay ?? rateFor('officePay', gigs);

    rows.push({
      week,
      date,
      salesRep: text('salesRep'),
      orderId: text('orderId'),
      gigs,
      installDate: toISODate(cell('installDate')),
      clientName: text('clientName') || null,
      status: text('status') || null,
      repCommission,
      officePay,
      // What the office keeps. Only meaningful when both sides are known.
      officeMargin:
        repCommission != null && officePay != null ? officePay - repCommission : null,
      // Lets the UI say "estimated at the standard rate" vs "this is the
      // number the sheet actually records".
      pricedFrom: sheetRepCommission != null || sheetOfficePay != null ? 'sheet' : 'rate-card',
    });
  }
  return rows;
}

export function normalizeName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function loadAllOrders(knownFullNames = []) {
  if (cache && cache.expiresAt > Date.now()) return cache.orders;

  const weeks = await listWeeklyTabs();
  let orders = [];

  if (weeks.length) {
    const data = await sheetsFetch('/values:batchGet', {
      // Through Z, not E: the header map needs to see every column a tab has
      // grown (Install date, Commission, …), not just the original five.
      ranges: weeks.map((w) => `'${w}'!A4:Z1000`),
      valueRenderOption: 'FORMATTED_VALUE',
    });
    (data.valueRanges || []).forEach((vr, idx) => {
      orders.push(...parseWeekRows(weeks[idx], vr.values || []));
    });
  }

  if (knownFullNames.length) {
    const known = new Set(knownFullNames.map(normalizeName));
    const unmatched = new Map();
    for (const o of orders) {
      const norm = normalizeName(o.salesRep);
      if (norm && !known.has(norm)) {
        unmatched.set(o.salesRep, (unmatched.get(o.salesRep) || 0) + 1);
      }
    }
    for (const [name, count] of unmatched) {
      console.warn(
        `[sheets] "${name}" appears on ${count} row${count === 1 ? '' : 's'} but matches no rep in the reps table — typo, or a rep not yet seeded?`
      );
    }
  }

  cache = { expiresAt: Date.now() + CACHE_TTL_MS, orders };
  return orders;
}

export async function getOrdersForRep(fullName, knownFullNames = []) {
  const all = await loadAllOrders(knownFullNames);
  const target = normalizeName(fullName);
  return all.filter((o) => normalizeName(o.salesRep) === target);
}
