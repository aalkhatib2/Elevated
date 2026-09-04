import { readSessionFromRequest } from './_lib/session.js';
import { sql } from './_lib/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ authenticated: false });
  }

  const session = readSessionFromRequest(req);
  if (!session) return res.status(401).json({ authenticated: false });

  try {
    const rows = await sql`
      select full_name, rep_code, team, division, market
      from reps
      where id = ${session.repId}
      limit 1
    `;
    const rep = rows[0];
    if (!rep) return res.status(401).json({ authenticated: false });

    return res.status(200).json({
      authenticated: true,
      rep: {
        fullName: rep.full_name,
        repCode: rep.rep_code,
        team: rep.team,
        division: rep.division,
        market: rep.market,
      },
    });
  } catch (err) {
    console.error('[me] failed:', err);
    return res.status(500).json({ authenticated: false });
  }
}
