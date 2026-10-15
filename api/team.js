import { sql } from './_lib/db.js';
import { getSessionRep } from './_lib/auth.js';
import { getAllOrders, normalizeName } from './_lib/sheets.js';
import { RANGES, rangeCutoff } from './_lib/range.js';
import { noStore } from './_lib/http.js';

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const me = await getSessionRep(req);
    if (!me) return res.status(401).json({ error: 'Not signed in' });
    if (me.must_change_password) return res.status(403).json({ error: 'Choose your own password first.', mustChangePassword: true });

    // Everyone active, for the leaderboard and to find my own downline among
    // them. Deactivated reps have left the team, so they drop off both.
    const allReps = await sql`
      select id, full_name, market, created_at, recruited_by from reps where disabled_at is null
    `;
    // ?range= narrows the counts shown (by order date); an unknown value is
    // all time. Producing/Onboarding stays lifetime, so a rep doesn't flip
    // to "Onboarding" just because the range is a quiet week.
    const range = RANGES.includes(req.query && req.query.range) ? req.query.range : 'all';
    const cutoff = rangeCutoff(range);
    const orders = await getAllOrders(allReps.map((r) => r.full_name));
    const lifetime = {};
    const inRange = {};
    for (const o of orders) {
      const k = normalizeName(o.salesRep);
      if (!k) continue;
      lifetime[k] = (lifetime[k] || 0) + 1;
      if (!cutoff || o.date >= cutoff) inRange[k] = (inRange[k] || 0) + 1;
    }
    const countFor = (fullName) => inRange[normalizeName(fullName)] || 0;
    const everFor = (fullName) => lifetime[normalizeName(fullName)] || 0;

    const downline = allReps
      .filter((r) => r.recruited_by === me.id)
      .map((r) => ({
        fullName: r.full_name,
        market: r.market,
        recruitedAt: r.created_at,
        installs: countFor(r.full_name),
        status: everFor(r.full_name) > 0 ? 'Producing' : 'Onboarding',
      }))
      .sort((a, b) => b.installs - a.installs);

    const leaderboard = allReps
      .map((r) => ({
        fullName: r.full_name,
        installs: countFor(r.full_name),
        isYou: r.id === me.id,
      }))
      .sort((a, b) => b.installs - a.installs);

    return res.status(200).json({
      range,
      rep: {
        fullName: me.full_name,
        repCode: me.rep_code,
        team: me.team,
        division: me.division,
        market: me.market,
      },
      totals: {
        repsUnderYou: downline.length,
        producing: downline.filter((d) => d.status === 'Producing').length,
        onboarding: downline.filter((d) => d.status === 'Onboarding').length,
        teamInstalls: downline.reduce((sum, d) => sum + d.installs, 0),
      },
      downline,
      leaderboard,
    });
  } catch (err) {
    console.error('[team] failed:', err);
    return res.status(500).json({ error: 'Could not load team right now. Try again shortly.' });
  }
}
