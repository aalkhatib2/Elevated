// Syncs the Fiber Sales sheet into the Fiber Sales board on monday.com. Called
// once a day by Vercel Cron (see vercel.json) — never by the portal UI.
//
// Auth: Vercel Cron sends "Authorization: Bearer $CRON_SECRET"; anything else
// (including a manual trigger) must send the same header. Without the secret
// configured the endpoint refuses everything.
//
// Writes only when MONDAY_SYNC_MODE=live; otherwise it reports what it would
// do. Add ?dry=1 to force a dry run even in live mode.

import { runMondaySync } from './_lib/monday-sync.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const forceDry = req.query?.dry === '1';
    const summary = await runMondaySync({ live: process.env.MONDAY_SYNC_MODE === 'live' && !forceDry });
    console.log('[monday-sync]', JSON.stringify(summary));
    return res.status(summary.errors.length ? 500 : 200).json(summary);
  } catch (err) {
    console.error('[monday-sync] run failed:', err);
    return res.status(500).json({ error: 'Sync failed' });
  }
}
