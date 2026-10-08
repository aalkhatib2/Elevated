// Turns an order read from a rep's Discord screenshot into a row on the right
// weekly tab of the fiber-sales sheet.
//
// planOrder() is pure: it decides write / skip / review from the order and
// what is already in the sheet. writeOrder() does the sheet edits. Anything
// doubtful becomes a review item instead of a row — a wrong order number in
// the sheet costs more than a missing one, because commission keys off it.

import { mapHeaders } from './sheets.js';
import { readRange, writeRanges, clearRanges, getSheetProps, batchUpdate } from './sheets-write.js';

// Discord username -> the rep's name exactly as the sheet spells it.
export const REP_BY_DISCORD = {
  sanders0409_88270: 'Sanders Young',
  kingdrako4306: 'Roniel Mata',
  'elevated.chris': 'Christian Dick',
  ladiesman695966: 'Christian Grey',
  adamalkhatib: 'Adam Alkhatib',
  alejandro__05: 'Alejandro Benitez',
  jorge059100: 'Jorge Jimenez',
};

export const ORDER_RE = /^TMO(\d{8})[A-Z0-9]{5}$/;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_MS = 86_400_000;

// ---------- dates ----------

// The office works in Eastern time; a 9pm sale must not land on tomorrow.
export function easternDate(isoTimestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(isoTimestamp));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

const toUTC = (ymd) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10));
const fromUTC = (ms) => new Date(ms).toISOString().slice(0, 10);
const label = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]}${d.getUTCDate()}`;
};

// Weeks run Monday-Sunday, named like the hand-made tabs: "SEP28 to OCT4".
export function weekTabName(ymd) {
  const ms = toUTC(ymd);
  const start = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS;
  return `${label(start)} to ${label(start + 6 * DAY_MS)}`;
}

const sheetDate = (ymd) => `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}`;

// ---------- order numbers ----------

export function cleanOrderNumber(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^TM[O0]/.test(s)) s = `TMO${s.slice(3)}`;
  return s;
}

// The sheet has hand-typed "TM0…" (zero) entries and OCR confuses O/0 and
// I/1, so two numbers that differ only in those count as the same order.
export function orderKey(raw) {
  return cleanOrderNumber(raw).replace(/O/g, '0').replace(/[IL]/g, '1');
}

const looseKey = (raw) => orderKey(raw).replace(/S/g, '5').replace(/B/g, '8');

function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// ---------- planning ----------

// input:    { author, postedAt, orderNumber, gigs, clientName, installDate }
// existing: orders already in the sheet, as returned by getAllOrders()
export function planOrder(input, existing) {
  const reasons = [];
  const rep = REP_BY_DISCORD[input.author] || null;
  const date = easternDate(input.postedAt);
  const orderNumber = cleanOrderNumber(input.orderNumber);
  const plan = {
    action: 'write',
    reasons,
    tab: weekTabName(date),
    row: {
      date,
      rep,
      orderNumber,
      gigs: input.gigs === 1 || input.gigs === 2 ? input.gigs : null,
      clientName: input.clientName || null,
      installDate: input.installDate || null,
    },
  };
  const review = (reason) => {
    plan.action = 'review';
    reasons.push(reason);
    return plan;
  };

  if (!rep) return review('Poster is not mapped to a rep');

  const m = orderNumber.match(ORDER_RE);
  if (!m) return review('No valid order number');

  // The order number embeds its own date. A read that disagrees with when it
  // was posted is almost always a misread digit.
  const embedded = `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
  const gapDays = (toUTC(date) - toUTC(embedded)) / DAY_MS;
  if (Number.isNaN(gapDays) || gapDays < -1 || gapDays > 3) {
    return review('Order # date does not match the post date');
  }

  const key = orderKey(orderNumber);
  const same = existing.find((o) => orderKey(o.orderId) === key);
  if (same) {
    plan.action = 'skip';
    reasons.push(`Already logged (${same.week}, ${same.salesRep})`);
    return plan;
  }

  const near = existing.find((o) => o.orderId && editDistance(looseKey(o.orderId), looseKey(orderNumber)) <= 2);
  if (near) return review(`Order # is 1-2 characters off an existing entry (${cleanOrderNumber(near.orderId)})`);

  // Rep, date and order # are what matter; a row without gigs is still worth
  // writing, but someone has to fill the gap.
  if (plan.row.gigs === null) reasons.push('Gigs unreadable - fill in by hand');
  return plan;
}

// ---------- sheet layout ----------

const colLetter = (i) => String.fromCharCode(65 + i);
const q = (title) => `'${title.replace(/'/g, "''")}'`;

async function readLayout(title) {
  const values = await readRange(`${q(title)}!A1:Z300`);
  const a = (r) => String((values[r - 1] || [])[0] || '').trim();
  const cols = mapHeaders(values[3] || []);
  const headerWidth = (values[3] || []).length;

  let totalRow = null;
  for (let r = 5; r <= values.length; r++) {
    if (/^total orders/i.test(a(r))) { totalRow = r; break; }
  }
  if (!totalRow || cols.date === undefined || cols.salesRep === undefined || cols.orderId === undefined) {
    throw new Error(`"${title}" does not look like a weekly tab (no header row or Total Orders row)`);
  }

  // One blank spacer row sits above "Total Orders:" on every tab; keep it blank.
  const spacer = (values[totalRow - 2] || []).every((c) => c === '' || c == null);
  const lastSlot = spacer ? totalRow - 2 : totalRow - 1;

  let emptySlot = null;
  for (let r = 5; r <= lastSlot; r++) {
    const row = values[r - 1] || [];
    if (!row[cols.date] && !row[cols.salesRep] && !row[cols.orderId]) { emptySlot = r; break; }
  }

  const repRows = [];
  const blockHeader = values.findIndex((row, i) => i + 1 > totalRow && String(row[0] || '').trim() === 'Sales Rep');
  if (blockHeader >= 0) {
    for (let r = blockHeader + 2; r <= values.length && !/^total$/i.test(a(r)); r++) {
      if (a(r)) repRows.push({ row: r, name: a(r) });
    }
  }

  return { values, cols, headerWidth, totalRow, lastSlot, emptySlot, repRows };
}

function insertRowRequest(sheetId, row) {
  return {
    insertDimension: {
      range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      inheritFromBefore: true,
    },
  };
}

function copyRowRequest(sheetId, fromRow, toRow, width) {
  const range = (r) => ({ sheetId, startRowIndex: r - 1, endRowIndex: r, startColumnIndex: 0, endColumnIndex: width });
  return { copyPaste: { source: range(fromRow), destination: range(toRow), pasteType: 'PASTE_NORMAL' } };
}

// Inserting *above* the last row of a block is what makes formula ranges
// like $B$5:$B$29 or SUM(B34:B40) grow to include the new row; inserting
// below them would leave the new row uncounted. The last row's content is
// then copied up into the gap (so relative formulas re-anchor), leaving a
// free row at the bottom.
async function growBlock(sheetId, lastRow, width) {
  await batchUpdate([insertRowRequest(sheetId, lastRow), copyRowRequest(sheetId, lastRow + 1, lastRow, width)]);
  return lastRow + 1;
}

// ---------- tabs ----------

async function ensureWeekTab(tab) {
  const props = await getSheetProps();
  const found = props.find((p) => p.title === tab);
  if (found) return { sheetId: found.sheetId, created: false };

  // Copy the newest weekly tab so the new week keeps its formatting and its
  // full rep list, then empty the order rows.
  const weekly = props.filter((p) => /^[A-Z]{3}\d{1,2}\s+to\s+[A-Z]{3}\d{1,2}$/i.test(p.title));
  if (!weekly.length) throw new Error('No weekly tab to copy from');
  const source = weekly.reduce((a, b) => (b.index > a.index ? b : a));

  const res = await batchUpdate([
    { duplicateSheet: { sourceSheetId: source.sheetId, insertSheetIndex: source.index + 1, newSheetName: tab } },
  ]);
  const sheetId = res.replies[0].duplicateSheet.properties.sheetId;

  const layout = await readLayout(tab);
  await clearRanges([`${q(tab)}!A5:${colLetter(layout.headerWidth - 1)}${layout.lastSlot}`]);
  await writeRanges([
    { range: `${q(tab)}!A1`, values: [[`Weekly Sales Tracker — ${tab}`]] },
    { range: `${q(tab)}!B${layout.totalRow}`, values: [[`=COUNTA(A5:A${layout.lastSlot})`]] },
  ]);
  await addWeekToSummary(tab);
  return { sheetId, created: true };
}

// ---------- Summary tab ----------

async function readSummary() {
  const values = await readRange('Summary!A1:Z80');
  const a = (r) => String((values[r - 1] || [])[0] || '').trim();
  const header = values.findIndex((row) => String(row[0] || '').trim() === 'Sales Rep') + 1;
  const repRows = [];
  for (let r = header + 1; r <= values.length && !/^total \(listed reps\)$/i.test(a(r)); r++) {
    if (a(r)) repRows.push({ row: r, name: a(r) });
  }
  return { values, header, repRows };
}

async function addWeekToSummary(tab) {
  const { values, header } = await readSummary();
  if (!header) return;
  const row = values[header - 1] || [];
  if (row.some((c) => String(c).trim() === tab)) return;
  let col = 2; // column C: weekly columns start after Sales Rep | Total
  while (row[col]) col++;
  await writeRanges([{ range: `Summary!${colLetter(col)}${header}`, values: [[tab]] }]);
}

async function ensureRepInSummary(rep) {
  const { repRows } = await readSummary();
  if (!repRows.length || repRows.some((r) => r.name.toLowerCase() === rep.toLowerCase())) return false;
  const props = await getSheetProps();
  const sheetId = props.find((p) => p.title === 'Summary').sheetId;
  const free = await growBlock(sheetId, repRows[repRows.length - 1].row, 26);
  await writeRanges([{ range: `Summary!A${free}`, values: [[rep]] }]);
  return true;
}

// ---------- writing ----------

export async function writeOrder(plan) {
  if (plan.action !== 'write') throw new Error(`writeOrder called with a "${plan.action}" plan`);
  const { tab, row } = plan;
  const notes = [];

  const { sheetId, created } = await ensureWeekTab(tab);
  if (created) notes.push(`created tab ${tab}`);

  let layout = await readLayout(tab);
  if (!layout.emptySlot) {
    const free = await growBlock(sheetId, layout.lastSlot, layout.headerWidth);
    await clearRanges([`${q(tab)}!A${free}:${colLetter(layout.headerWidth - 1)}${free}`]);
    layout = await readLayout(tab);
    notes.push('tab was full - added a row');
  }
  const r = layout.emptySlot;
  const { cols } = layout;

  const cells = [
    ['date', sheetDate(row.date)],
    ['salesRep', row.rep],
    ['orderId', row.orderNumber],
    ['gigs', row.gigs],
    ['installDate', row.installDate ? sheetDate(row.installDate) : null],
    ['clientName', row.clientName],
  ];
  const data = cells
    .filter(([field, value]) => value != null && cols[field] !== undefined)
    .map(([field, value]) => ({ range: `${q(tab)}!${colLetter(cols[field])}${r}`, values: [[value]] }));
  // Total Orders was a hand-typed number on some tabs; make it count itself.
  data.push({ range: `${q(tab)}!B${layout.totalRow}`, values: [[`=COUNTA(A5:A${layout.lastSlot})`]] });
  await writeRanges(data);

  // A rep missing from this tab's "Weekly Sales by Rep" block would sell
  // nothing as far as its Total row is concerned.
  if (layout.repRows.length && !layout.repRows.some((x) => x.name.toLowerCase() === row.rep.toLowerCase())) {
    const free = await growBlock(sheetId, layout.repRows[layout.repRows.length - 1].row, 4);
    await writeRanges([{ range: `${q(tab)}!A${free}`, values: [[row.rep]] }]);
    notes.push(`added ${row.rep} to the tab's rep block`);
  }
  if (await ensureRepInSummary(row.rep)) notes.push(`added ${row.rep} to Summary`);

  return { tab, row: r, notes };
}
