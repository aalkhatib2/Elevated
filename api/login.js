import { sql } from './_lib/db.js';
import { verifyPassword } from './_lib/password.js';
import { createSessionCookie } from './_lib/session.js';

const GENERIC_ERROR = { ok: false, error: 'Invalid username or password' };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: 'Username and password are required' });
  }

  try {
    const rows = await sql`
      select id, full_name, username, password_hash, rep_code, team, division, market
      from reps
      where lower(username) = lower(${username})
      limit 1
    `;
    const rep = rows[0];
    // Never reveal whether the username existed — same error either way.
    if (!rep || !(await verifyPassword(password, rep.password_hash))) {
      return res.status(401).json(GENERIC_ERROR);
    }

    await sql`update reps set last_login_at = now() where id = ${rep.id}`;
    res.setHeader('Set-Cookie', createSessionCookie(rep));

    return res.status(200).json({
      ok: true,
      rep: {
        fullName: rep.full_name,
        repCode: rep.rep_code,
        team: rep.team,
        division: rep.division,
        market: rep.market,
      },
    });
  } catch (err) {
    console.error('[login] failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Try again.' });
  }
}
