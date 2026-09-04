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
// Auth: a restricted (Sheets-API-only) API key, not a service account — the
// GCP project's org policy blocks service-account key creation and touching
// Organization Policy Admin to lift it was out of scope. An API key only
// works against a publicly link-readable resource, so the spreadsheet is
// shared "Anyone with the link → Viewer". Deliberate, accepted tradeoff:
// the sheet is link-readable by anyone who has the URL, not just this app.
// Fine while it holds no dollar amounts; revisit (real service account, or
// a personal OAuth refresh token — either keeps the sheet private and needs
// no org-policy change) before anything sensitive lands in it.

const WEEKLY_TAB_RE = /^[A-Z]{3}\d{1,2}\s+to\s+[A-Z]{3}\d{1,2}$/i;
const CACHE_TTL_MS = 60 * 1000;

// Pure latency optimization under Fluid Compute's instance reuse — never a
// correctness dependency. Different concurrent instances hold independent
// copies, and any instance can cold-start at any time.
let cache = null; // { expiresAt, orders }

async function sheetsFetch(path, params = {}) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID is not set');
  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_SHEETS_API_KEY is not set');

  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`);
  url.searchParams.set('key', apiKey);
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
    else if (value !== undefined) url.searchParams.set(key, value);
  }

  const res = await fetch(url);
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

export function parseWeekRows(week, values) {
  const rows = [];
  // values[0] is the header row (sheet row 4); data starts at values[1] (row 5).
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const [dateRaw, repRaw, orderId, gigsRaw, clientName] = row;

    const date = toISODate(dateRaw);
    if (!date) break; // blank/unparseable Date cell = end of this tab's data

    let gigs = Number.parseInt(gigsRaw, 10);
    if (gigsRaw != null && gigsRaw !== '' && Number.isNaN(gigs)) {
      console.warn(`[sheets] "${week}" row ${i + 5}: unparseable # of Gigs "${gigsRaw}"`);
    }
    if (Number.isNaN(gigs)) gigs = null;

    rows.push({
      week,
      date,
      salesRep: (repRaw || '').trim(),
      orderId: (orderId || '').trim(),
      gigs,
      clientName: (clientName || '').trim() || null,
      status: null, // no Status column in the sheet yet — see plan Part 1
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
      ranges: weeks.map((w) => `'${w}'!A4:E1000`),
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
