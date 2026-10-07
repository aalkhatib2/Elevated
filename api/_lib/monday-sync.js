// One-way sync: the "Fiber Sales" Google Sheet -> the "Fiber Sales" board on
// monday.com (EMG Operations workspace). The sheet stays the source of truth
// (the portal reads it); monday is a mirror.
//
// Orders are matched on order #, case/O-vs-0/I-vs-1 folded so that fixing a
// typo in the sheet renames the monday item instead of duplicating it. Per
// order the sync will:
//   - create the item (in its week's group, creating the group if needed),
//   - fill in or change rep / date / gigs / install date / client / status
//     when the sheet has a value that differs,
//   - move it to the right week group if the sheet re-filed it.
// It never blanks a monday field the sheet leaves empty and never deletes
// anything: monday items with no matching sheet row are only reported.
//
// Dry run (the default) plans and reports without writing. Set
// MONDAY_SYNC_MODE=live to write for real.

import { getAllOrders } from './sheets.js';

const API_URL = 'https://api.monday.com/v2';
const API_VERSION = '2024-10';
export const BOARD_ID = '18434495487';

export const COL = {
  rep: 'dropdown_mm7x16az',
  date: 'date_mm7xg89e',
  gigs: 'color_mm7x3vjz',
  install: 'date_mm7x6s1t',
  client: 'text_mm7xtm8b',
  status: 'color_mm7xfs1c',
};
const COL_IDS = Object.values(COL);

// ---------- monday GraphQL ----------

async function monday(query, variables = {}, attempt = 0) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.MONDAY_API_TOKEN,
      'API-Version': API_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 429 && attempt < 4) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    return monday(query, variables, attempt + 1);
  }
  const json = await res.json().catch(() => ({}));
  const errors = json.errors || (json.error_message ? [{ message: json.error_message }] : null);
  if (!res.ok || errors) {
    const text = JSON.stringify(errors || json).slice(0, 400);
    if (attempt < 4 && /complexity|rate limit/i.test(text)) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      return monday(query, variables, attempt + 1);
    }
    throw new Error(`monday API ${res.status}: ${text}`);
  }
  return json.data;
}

const ITEM_FIELDS = `id name group { id } column_values(ids: [${COL_IDS.map((c) => `"${c}"`).join(', ')}]) { id text }`;

async function fetchBoard() {
  const first = await monday(
    `query ($board: [ID!]) { boards(ids: $board) { groups { id title } items_page(limit: 500) { cursor items { ${ITEM_FIELDS} } } } }`,
    { board: [BOARD_ID] }
  );
  const board = first.boards?.[0];
  if (!board) throw new Error(`monday board ${BOARD_ID} not found or not accessible with this token`);
  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const next = await monday(
      `query ($cursor: String!) { next_items_page(limit: 500, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } } }`,
      { cursor }
    );
    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }
  return { groups: board.groups, items };
}

const createGroup = (name) =>
  monday(`mutation ($board: ID!, $name: String!) { create_group(board_id: $board, group_name: $name) { id } }`, {
    board: BOARD_ID,
    name,
  }).then((d) => d.create_group.id);

const createItem = (name, groupId, columnValues) =>
  monday(
    `mutation ($board: ID!, $group: String!, $name: String!, $cv: JSON!) {
       create_item(board_id: $board, group_id: $group, item_name: $name, column_values: $cv, create_labels_if_missing: true) { id }
     }`,
    { board: BOARD_ID, group: groupId, name, cv: JSON.stringify(columnValues) }
  ).then((d) => d.create_item.id);

const changeColumns = (itemId, columnValues) =>
  monday(
    `mutation ($board: ID!, $item: ID!, $cv: JSON!) {
       change_multiple_column_values(board_id: $board, item_id: $item, column_values: $cv, create_labels_if_missing: true) { id }
     }`,
    { board: BOARD_ID, item: String(itemId), cv: JSON.stringify(columnValues) }
  );

const moveToGroup = (itemId, groupId) =>
  monday(`mutation ($item: ID!, $group: String!) { move_item_to_group(item_id: $item, group_id: $group) { id } }`, {
    item: String(itemId),
    group: groupId,
  });

// ---------- planning (pure) ----------

// Matching key: upper-case alphanumerics, letter O read as zero, I/L as one —
// the same confusion the sheet already has (TMO… vs TM0…).
export function orderKey(raw) {
  return String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

// What the sheet says an item's columns should hold. `text` is how monday
// reports that value back, so we can tell whether anything changed.
export function desiredFields(order) {
  const f = {};
  if (order.salesRep) f[COL.rep] = { text: order.salesRep, value: { labels: [order.salesRep] } };
  if (order.date) f[COL.date] = { text: order.date, value: { date: order.date } };
  if (order.gigs === 1 || order.gigs === 2) {
    const label = `${order.gigs} Gig`;
    f[COL.gigs] = { text: label, value: { label } };
  }
  if (order.installDate) f[COL.install] = { text: order.installDate, value: { date: order.installDate } };
  if (order.clientName) f[COL.client] = { text: order.clientName, value: order.clientName };
  if (order.status) f[COL.status] = { text: order.status, value: { label: order.status } };
  return f;
}

const orderName = (o) => o.orderId || '(no order #)';
const sameText = (a, b) => String(a ?? '').trim() === String(b ?? '').trim();

export function planSync(orders, items, groups) {
  const groupByTitle = new Map(groups.map((g) => [g.title, g.id]));
  const titleById = new Map(groups.map((g) => [g.id, g.title]));

  const byKey = new Map();
  for (const item of [...items].sort((a, b) => Number(a.id) - Number(b.id))) {
    const key = orderKey(item.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(item);
  }

  const seen = new Map();
  const matched = new Set();
  const plan = { creates: [], updates: [], newGroups: [], orphans: [], unchanged: 0 };
  const newGroups = new Set();

  for (const order of orders) {
    const key = orderKey(order.orderId);
    const nth = seen.get(key) || 0;
    seen.set(key, nth + 1);
    const item = byKey.get(key)?.[nth];
    const fields = desiredFields(order);

    if (!item) {
      if (!groupByTitle.has(order.week)) newGroups.add(order.week);
      plan.creates.push({ order, name: orderName(order), fields });
      continue;
    }
    matched.add(item.id);

    const current = Object.fromEntries(item.column_values.map((c) => [c.id, c.text]));
    const changes = {};
    for (const [id, want] of Object.entries(fields)) {
      if (!sameText(current[id], want.text)) changes[id] = want.value;
    }
    const rename = sameText(item.name, orderName(order)) ? null : orderName(order);
    const wantGroup = groupByTitle.get(order.week);
    const move = titleById.get(item.group?.id) !== order.week;
    if (move && !wantGroup) newGroups.add(order.week);

    if (Object.keys(changes).length || rename || move) {
      plan.updates.push({ item, order, changes, rename, move });
    } else {
      plan.unchanged += 1;
    }
  }

  plan.newGroups = [...newGroups];
  plan.orphans = items.filter((i) => !matched.has(i.id)).map((i) => i.name);
  return plan;
}

// ---------- run ----------

export async function runMondaySync({ live = false } = {}) {
  if (!process.env.MONDAY_API_TOKEN) throw new Error('MONDAY_API_TOKEN is not set');

  const orders = await getAllOrders();
  // An empty read means the sheet call failed quietly; never "sync" that.
  if (!orders.length) throw new Error('Sheet returned no orders — refusing to sync');

  const { groups, items } = await fetchBoard();
  const plan = planSync(orders, items, groups);

  const summary = {
    mode: live ? 'live' : 'dry-run',
    sheetOrders: orders.length,
    mondayItems: items.length,
    toCreate: plan.creates.length,
    toUpdate: plan.updates.length,
    unchanged: plan.unchanged,
    newGroups: plan.newGroups,
    orphans: plan.orphans,
    created: 0,
    updated: 0,
    moved: 0,
    renamed: 0,
    errors: [],
  };
  if (!live) return summary;

  const groupId = new Map(groups.map((g) => [g.title, g.id]));
  const ensureGroup = async (title) => {
    if (!groupId.has(title)) groupId.set(title, await createGroup(title));
    return groupId.get(title);
  };

  for (const c of plan.creates) {
    try {
      const values = Object.fromEntries(Object.entries(c.fields).map(([id, f]) => [id, f.value]));
      await createItem(c.name, await ensureGroup(c.order.week), values);
      summary.created += 1;
    } catch (err) {
      summary.errors.push(`create ${c.name}: ${err.message}`);
    }
  }

  for (const u of plan.updates) {
    try {
      const values = { ...u.changes };
      if (u.rename) values.name = u.rename;
      if (Object.keys(values).length) {
        await changeColumns(u.item.id, values);
        summary.updated += 1;
        if (u.rename) summary.renamed += 1;
      }
      if (u.move) {
        await moveToGroup(u.item.id, await ensureGroup(u.order.week));
        summary.moved += 1;
      }
    } catch (err) {
      summary.errors.push(`update ${u.item.name}: ${err.message}`);
    }
  }

  return summary;
}
