// Runs one pass of the Discord sales bot. Called on a schedule — by an
// external scheduler (cron-job.org) or Vercel Cron — never by the portal UI.
//
// Auth: the caller sends "Authorization: Bearer <secret>". Either
// SALES_BOT_SECRET (the external scheduler's own key) or CRON_SECRET (what
// Vercel Cron sends) is accepted. With neither configured the endpoint refuses
// everything, so it can't be triggered by accident.

import { runSalesBot } from './_lib/sales-bot.js';
import { bearerMatches, noStore } from './_lib/http.js';

const authorized = (header) => bearerMatches(header, process.env.SALES_BOT_SECRET, process.env.CRON_SECRET);

export default async function handler(req, res) {
  noStore(res);
  if (!authorized(req.headers.authorization)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const summary = await runSalesBot({ live: process.env.BOT_MODE === 'live' });
    console.log('[sales-bot]', JSON.stringify(summary));
    return res.status(200).json(summary);
  } catch (err) {
    console.error('[sales-bot] run failed:', err);
    return res.status(500).json({ error: 'Bot run failed' });
  }
}
