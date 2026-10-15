import { sql } from './_lib/db.js';
import { hashPassword, verifyPassword } from './_lib/password.js';
import { createSessionCookie } from './_lib/session.js';
import {
  clearFailedPasswords, ipThrottled, isLocked, lockedMessage, recordFailedPassword, recordIpFailure,
} from './_lib/auth.js';
import { blockCrossOrigin, clientIp, noStore } from './_lib/http.js';

const GENERIC_ERROR = { ok: false, error: 'Invalid username or password' };
const MAX_USERNAME_LENGTH = 64;
const MAX_LOGIN_PASSWORD_LENGTH = 256;

// A real hash to verify against when the username does not exist or is
// deactivated, so "no such user" costs the same scrypt as "wrong password" and
// response time does not reveal which usernames are real.
let decoyHash;
const decoy = () => (decoyHash ||= hashPassword('not-a-real-password'));

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (blockCrossOrigin(req, res)) return;

  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ ok: false, error: 'Username and password are required' });
  }
  if (username.length > MAX_USERNAME_LENGTH || password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    return res.status(401).json(GENERIC_ERROR);
  }

  const ip = clientIp(req);

  try {
    if (await ipThrottled(ip)) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again in a few minutes.' });
    }

    const rows = await sql`
      select id, full_name, username, password_hash, rep_code, team, division, market,
             must_change_password, password_changed_at, locked_until, disabled_at
      from reps
      where lower(username) = lower(${username})
      limit 1
    `;
    const rep = rows[0];

    // Checked before the password, so a locked account can't be probed further.
    if (rep && isLocked(rep)) {
      return res.status(429).json({ ok: false, error: lockedMessage });
    }

    // Never reveal whether the username existed — same error either way. A
    // deactivated login gets that same error, so it looks like any other.
    const usable = rep && !rep.disabled_at;
    const passwordOk = await verifyPassword(password, usable ? rep.password_hash : await decoy());
    if (!usable || !passwordOk) {
      if (usable) await recordFailedPassword(rep.id);
      await recordIpFailure(ip);
      return res.status(401).json(GENERIC_ERROR);
    }

    await clearFailedPasswords(rep.id);
    await sql`update reps set last_login_at = now() where id = ${rep.id}`;
    res.setHeader('Set-Cookie', createSessionCookie(rep));

    return res.status(200).json({
      ok: true,
      mustChangePassword: rep.must_change_password,
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
