// One pass of the Discord sales bot: read new posts in #fiber-sales since the
// last run, OCR the screenshots, and log each order to the sheet.
//
// State lives in a "Bot" tab in the workbook (the portal ignores it): B1
// holds the id of the last Discord message handled, and every decision is
// appended below as a log row — the weekly review email reads those rows.
//
// Dry run (the default) plans everything and logs "would write" without
// touching the weekly tabs. Set BOT_MODE=live to write for real.

import os from 'node:os';
import { getFreshOrders } from './sheets.js';
import { readRange, writeRanges, appendRows, getSheetProps, batchUpdate } from './sheets-write.js';
import { planOrder, writeOrder } from './order-writer.js';
import { parseOrderText, groupPost } from './order-ocr.js';

const SERVER_ID = '1541221539943420035';
const CHANNEL_ID = '1541526382478233642';
const BOT_TAB = 'Bot';
const LOG_HEADER = [
  'Logged at (ET)', 'Mode', 'Message ID', 'Posted (ET)', 'Posted by', 'Rep', 'Order #', 'Gigs',
  'Client', 'Install date', 'Tab', 'Action', 'Reasons', 'Discord link',
];
// Leave headroom under the function's 300s limit; unfinished posts are picked
// up next run because the cursor only moves past finished ones.
const TIME_BUDGET_MS = 200_000;

// ---------- Discord ----------

async function discord(path, init = {}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`, ...(init.headers || {}) },
  });
  if (res.status === 429) {
    const { retry_after = 1 } = await res.json().catch(() => ({}));
    await new Promise((r) => setTimeout(r, retry_after * 1000));
    return discord(path, init);
  }
  if (!res.ok) throw new Error(`Discord ${path} failed: ${res.status} ${await res.text().catch(() => '')}`);
  return res.status === 204 ? null : res.json();
}

async function messagesAfter(cursor) {
  const all = [];
  let after = cursor;
  for (;;) {
    const batch = await discord(`/channels/${CHANNEL_ID}/messages?limit=100&after=${after}`);
    if (!batch.length) break;
    all.push(...batch);
    after = batch.reduce((max, m) => (BigInt(m.id) > BigInt(max) ? m.id : max), after);
    if (batch.length < 100) break;
  }
  return all.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
}

const react = (messageId, emoji) =>
  discord(`/channels/${CHANNEL_ID}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`, { method: 'PUT' });

// ---------- Bot tab ----------

async function ensureBotTab() {
  const props = await getSheetProps();
  if (props.some((p) => p.title === BOT_TAB)) return;
  await batchUpdate([{ addSheet: { properties: { title: BOT_TAB, index: props.length } } }]);
  await writeRanges([
    { range: `${BOT_TAB}!A1:C1`, values: [['Last message', '', 'Written by the Sales Counter bot. Do not edit rows 1-3.']] },
    { range: `${BOT_TAB}!A3`, values: [LOG_HEADER] },
  ]);
}

const readCursor = async () => String(((await readRange(`${BOT_TAB}!B1`))[0] || [])[0] || '').trim();
// Raw text, not a number: an 18-digit snowflake would lose precision.
const saveCursor = (id) => writeRanges([{ range: `${BOT_TAB}!B1`, values: [[`'${id}`]] }]);

const etStamp = (iso) =>
  new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });

// ---------- OCR ----------

async function ocrImages(worker, attachments) {
  const parsed = [];
  for (const a of attachments) {
    const buf = Buffer.from(await (await fetch(a.url)).arrayBuffer());
    const { data } = await worker.recognize(buf);
    parsed.push(parseOrderText(data.text));
  }
  return parsed;
}

// ---------- run ----------

// Row 2 of the Bot tab is a heartbeat: A "Last run", B ISO time (UTC), C ok |
// error, D counts or the error text. Anything watching the bot (Elevated OS)
// reads it and calls the bot stale if B is older than a couple of schedule
// intervals. Written on every run, including runs that found nothing new.
async function writeHeartbeat(status, detail) {
  try {
    await writeRanges([{ range: `${BOT_TAB}!A2:D2`, values: [['Last run', new Date().toISOString(), status, detail]] }]);
  } catch (err) {
    console.error('[sales-bot] heartbeat write failed:', err.message);
  }
}

export async function runSalesBot({ live = false } = {}) {
  try {
    const summary = await runPass({ live });
    const { mode, processed, written, wouldWrite, skipped, review, stoppedEarly } = summary;
    await writeHeartbeat(
      'ok',
      `${mode}: ${processed} posts, ${live ? `${written} written` : `${wouldWrite} would write`}, ${skipped} skipped, ${review} review${stoppedEarly ? ', stopped early (time budget)' : ''}`
    );
    return summary;
  } catch (err) {
    await writeHeartbeat('error', String(err.message || err).slice(0, 300));
    throw err;
  }
}

async function runPass({ live }) {
  const started = Date.now();
  const mode = live ? 'live' : 'dry run';
  const summary = { mode, processed: 0, written: 0, wouldWrite: 0, skipped: 0, review: 0, cursor: null, stoppedEarly: false };

  await ensureBotTab();
  let cursor = await readCursor();

  // First run: start from the newest message instead of re-reading history.
  if (!cursor) {
    const [latest] = await discord(`/channels/${CHANNEL_ID}/messages?limit=1`);
    if (latest) await saveCursor(latest.id);
    summary.cursor = latest?.id || null;
    summary.initialized = true;
    return summary;
  }

  const messages = (await messagesAfter(cursor)).filter((m) => !m.author.bot);
  const withImages = messages.filter((m) => m.attachments?.some((a) => a.content_type?.startsWith('image/')));
  if (!withImages.length) {
    if (messages.length) await saveCursor(messages[messages.length - 1].id);
    summary.cursor = messages.length ? messages[messages.length - 1].id : cursor;
    return summary;
  }

  const existing = await getFreshOrders();
  const { createWorker } = await import('tesseract.js');
  // /tmp is the only writable path on Vercel; the language data is cached there.
  const worker = await createWorker('eng', 1, { cachePath: os.tmpdir() });

  try {
    for (const m of messages) {
      if (Date.now() - started > TIME_BUDGET_MS) { summary.stoppedEarly = true; break; }

      const images = (m.attachments || []).filter((a) => a.content_type?.startsWith('image/'));
      if (images.length) {
        const posted = etStamp(m.timestamp);
        const link = `https://discord.com/channels/${SERVER_ID}/${CHANNEL_ID}/${m.id}`;
        const logRow = (fields) => [
          etStamp(new Date().toISOString()), mode, `'${m.id}`, posted, m.author.username,
          fields.rep || '', fields.orderNumber || '', fields.gigs ?? '', fields.clientName || '',
          fields.installDate || '', fields.tab || '', fields.action, fields.reasons || '', link,
        ];
        const rows = [];
        let outcome = null; // which reaction the post gets in live mode

        const group = groupPost(await ocrImages(worker, images));
        if (!group.orders.length) {
          rows.push(logRow({
            action: 'review',
            reasons: group.continuationOnly ? 'Second page only - no order number' : 'No order number found',
          }));
          summary.review++;
          outcome = 'review';
        }

        for (const o of group.orders) {
          const plan = planOrder({ author: m.author.username, postedAt: m.timestamp, ...o }, existing);
          const fields = { ...plan.row, tab: plan.tab, reasons: plan.reasons.join('; ') };
          if (plan.action === 'write') {
            if (live) {
              const res = await writeOrder(plan);
              fields.reasons = [fields.reasons, ...res.notes].filter(Boolean).join('; ');
              summary.written++;
            } else {
              summary.wouldWrite++;
            }
            // Count it immediately so a second screenshot of the same order
            // in this run is recognized as a duplicate.
            existing.push({ orderId: plan.row.orderNumber, salesRep: plan.row.rep, week: plan.tab, date: plan.row.date });
            // A written row that is missing gigs still needs a human.
            const needsHuman = plan.reasons.length > 0;
            if (needsHuman) summary.review++;
            rows.push(logRow({ ...fields, action: live ? (needsHuman ? 'written - review' : 'written') : 'would write' }));
            if (outcome !== 'review') outcome = needsHuman ? 'review' : 'written';
          } else {
            summary[plan.action === 'skip' ? 'skipped' : 'review']++;
            rows.push(logRow({ ...fields, action: plan.action === 'skip' ? 'skip' : 'review' }));
            if (plan.action === 'review') outcome = 'review';
          }
        }

        await appendRows(`${BOT_TAB}!A3`, rows);
        if (live && outcome === 'written') await react(m.id, '✅').catch(() => {});
        if (live && outcome === 'review') await react(m.id, '⚠️').catch(() => {});
        summary.processed++;
      }

      await saveCursor(m.id);
      summary.cursor = m.id;
    }
  } finally {
    await worker.terminate();
  }
  summary.seconds = Math.round((Date.now() - started) / 1000);
  return summary;
}
