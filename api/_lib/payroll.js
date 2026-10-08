// Weekly payroll: turns the sheet's orders into a Motorsport-style statement.
//
// Rules (agreed with the owner):
//   - A pay period is a Mon–Sun week of *install dates*, not sold dates.
//   - Each week is paid on the Friday of the FOLLOWING week: installs Mon
//     Oct 5 – Sun Oct 11 are paid Fri Oct 16. Nothing pays in the week it
//     installs.
//   - Sold-but-not-installed orders are listed as pending and roll forward.
//   - An order cancelled after its week was closed is clawed back as a
//     negative chargeback line in the next open week.
//   - Closing a week freezes its lines in Postgres (payroll_lines), so a later
//     change to RATES or to the sheet can never rewrite what was paid.
//
// Everything here is pure — orders and already-closed lines come in as
// arguments — so it can be unit tested without a sheet or a database.

import { normalizeName } from './sheets.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseISO(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : d;
}

const toISO = (d) => d.toISOString().slice(0, 10);

// The Mon–Sun install week containing `iso`, and the Friday it is paid
// (11 days after its Monday). Returns null for an unparseable date.
export function payPeriodFor(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  const sinceMonday = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(d.getTime() - sinceMonday * DAY_MS);
  const end = new Date(start.getTime() + 6 * DAY_MS);
  const payday = new Date(start.getTime() + 11 * DAY_MS);
  return { key: toISO(start), start: toISO(start), end: toISO(end), payday: toISO(payday) };
}

// The Friday an install on `iso` gets paid.
export function paydayFor(iso) {
  const p = payPeriodFor(iso);
  return p ? p.payday : null;
}

// The install week paid on the first payday on or after `iso` — i.e. "what
// gets paid this coming Friday" (on a Friday, that Friday's statement).
export function payPeriodPaidOn(iso) {
  const d = parseISO(iso);
  if (!d) return null;
  const toFriday = (5 - d.getUTCDay() + 7) % 7;
  return payPeriodFor(toISO(new Date(d.getTime() + (toFriday - 11) * DAY_MS)));
}

export function addDays(iso, days) {
  const d = parseISO(iso);
  return d ? toISO(new Date(d.getTime() + days * DAY_MS)) : null;
}

const INSTALLED = new Set(['installed', 'active', 'complete', 'completed', 'done']);
const CANCELLED = new Set(['cancelled', 'canceled', 'churned', 'chargeback', 'declined']);

// 'installed' | 'pending' | 'cancelled'. A row with an install date but no
// status is treated as installed — the date is itself the proof, and it keeps
// a rep from going unpaid because nobody typed a status word.
export function classifyOrder(order) {
  const status = String(order.status || '').trim().toLowerCase();
  if (CANCELLED.has(status)) return 'cancelled';
  if (INSTALLED.has(status)) return 'installed';
  if (!status && order.installDate) return 'installed';
  return 'pending';
}

// Stable identity for "was this order already paid?". Order # is the real key;
// the fallback only matters for rows where it was left blank.
export function orderKey(order) {
  const id = String(order.orderId || '').trim().toLowerCase();
  return id || [normalizeName(order.salesRep), order.date, normalizeName(order.clientName)].join('|');
}

function toLine(order, extra = {}) {
  return {
    kind: 'order',
    orderKey: orderKey(order),
    rep: order.salesRep,
    orderId: order.orderId || null,
    clientName: order.clientName || null,
    gigs: order.gigs ?? null,
    soldDate: order.date || null,
    installDate: order.installDate || null,
    repCommission: order.repCommission,
    officePay: order.officePay,
    ...extra,
  };
}

const sum = (rows, field) => rows.reduce((acc, r) => acc + (r[field] || 0), 0);

// Groups flat lines into per-rep blocks with totals — the shape the statement
// and the roll-up both render. Used for live weeks and for frozen ones alike.
export function groupLines(lines) {
  const byRep = new Map();
  for (const line of lines) {
    const k = normalizeName(line.rep);
    if (!byRep.has(k)) byRep.set(k, { rep: line.rep, lines: [] });
    byRep.get(k).lines.push(line);
  }
  const reps = [...byRep.values()].map((r) => {
    r.lines.sort((a, b) => (a.installDate || '') < (b.installDate || '') ? -1 : 1);
    return {
      ...r,
      orderCount: r.lines.filter((l) => l.kind === 'order').length,
      repTotal: sum(r.lines, 'repCommission'),
      officePay: sum(r.lines, 'officePay'),
      unpriced: r.lines.filter((l) => l.repCommission == null).length,
    };
  });
  reps.sort((a, b) => a.rep.localeCompare(b.rep));
  const all = reps.flatMap((r) => r.lines);
  return {
    reps,
    totals: {
      orders: all.filter((l) => l.kind === 'order').length,
      repCommission: sum(all, 'repCommission'),
      officePay: sum(all, 'officePay'),
      officeMargin: sum(all, 'officePay') - sum(all, 'repCommission'),
      unpriced: all.filter((l) => l.repCommission == null).length,
    },
  };
}

// Builds the statement for the week starting `periodStart` from live orders.
//
// closedLines: every line already frozen in a closed week, shaped like
//   { kind, orderKey, rep, repCommission, officePay, periodStart }.
//   They decide what is "already paid", what needs a chargeback, and which
//   weeks are closed (so an install the sheet gained late is picked up
//   rather than silently dropped).
export function buildPayroll(orders, periodStart, closedLines = []) {
  const period = payPeriodFor(periodStart);
  if (!period) throw new Error(`Bad period start: ${periodStart}`);

  const paid = new Map(); // orderKey -> frozen 'order' line
  const clawed = new Set(); // orderKeys already charged back
  const closedWeeks = new Set();
  for (const l of closedLines) {
    closedWeeks.add(l.periodStart);
    if (l.kind === 'order') paid.set(l.orderKey, l);
    if (l.kind === 'chargeback') clawed.add(l.orderKey);
  }
  const lastClosed = [...closedWeeks].sort().pop() || null;
  const isOpenWeek = !closedWeeks.has(period.start);

  const lines = [];
  const pending = [];

  for (const order of orders) {
    const state = classifyOrder(order);
    const key = orderKey(order);

    if (state === 'cancelled') {
      // Only claw back money that actually went out, once, in the first open
      // week after the cancellation was noticed.
      const was = paid.get(key);
      const eligible = isOpenWeek && (!lastClosed || period.start > lastClosed);
      if (was && !clawed.has(key) && eligible) {
        lines.push(
          toLine(order, {
            kind: 'chargeback',
            repCommission: -(was.repCommission || 0),
            officePay: -(was.officePay || 0),
          })
        );
      }
      continue;
    }

    if (state === 'pending') {
      if (order.date <= period.end) pending.push(toLine(order, { kind: 'pending' }));
      continue;
    }

    // Installed.
    if (paid.has(key) || !order.installDate) continue;
    const inWeek = order.installDate >= period.start && order.installDate <= period.end;
    // An install dated inside an already-closed week that never made its
    // snapshot is paid now, flagged late, instead of falling through the gap.
    const lateInClosedWeek =
      isOpenWeek && order.installDate < period.start && closedWeeks.has(payPeriodFor(order.installDate).start);
    if (inWeek) lines.push(toLine(order));
    else if (lateInClosedWeek) lines.push(toLine(order, { late: true }));
  }

  return { period, ...groupLines(lines), pending, closed: false };
}

// Statement lines as plain rows for a CSV export.
export function toCsv(statement) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Rep', 'Type', 'Order #', 'Client', 'Install date', 'Gigs', 'Rep commission', 'Office pay'];
  const rows = [header];
  for (const r of statement.reps) {
    for (const l of r.lines) {
      rows.push([r.rep, l.kind, l.orderId, l.clientName, l.installDate, l.gigs, l.repCommission, l.officePay]);
    }
    rows.push([r.rep, 'REP TOTAL', '', '', '', '', r.repTotal, r.officePay]);
  }
  rows.push(['ALL REPS', 'TOTAL', '', '', '', '', statement.totals.repCommission, statement.totals.officePay]);
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
