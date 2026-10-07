import { sql } from './_lib/db.js';
import { getSessionRep } from './_lib/auth.js';
import { getOrderCountsByRep } from './_lib/sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const me = await getSessionRep(req);
    if (!me) return res.status(401).json({ error: 'Not signed in' });

    // Everyone, for the leaderboard and to find my own downline among them.
    const allReps = await sql`select id, full_name, market, created_at, recruited_by from reps`;
    const counts = await getOrderCountsByRep(allReps.map((r) => r.full_name));
    const countFor = (fullName) =>
      counts[fullName.trim().toLowerCase().replace(/\s+/g, ' ')] || 0;

    const downline = allReps
      .filter((r) => r.recruited_by === me.id)
      .map((r) => ({
        fullName: r.full_name,
        market: r.market,
        recruitedAt: r.created_at,
        installs: countFor(r.full_name),
        status: countFor(r.full_name) > 0 ? 'Producing' : 'Onboarding',
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
