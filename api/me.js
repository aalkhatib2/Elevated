import { getSessionRep } from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ authenticated: false });
  }

  try {
    const rep = await getSessionRep(req);
    if (!rep) return res.status(401).json({ authenticated: false });

    return res.status(200).json({
      authenticated: true,
      mustChangePassword: rep.must_change_password,
      rep: {
        fullName: rep.full_name,
        username: rep.username,
        repCode: rep.rep_code,
        team: rep.team,
        division: rep.division,
        market: rep.market,
        role: rep.role,
      },
    });
  } catch (err) {
    console.error('[me] failed:', err);
    return res.status(500).json({ authenticated: false });
  }
}
