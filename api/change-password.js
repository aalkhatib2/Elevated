import { sql } from './_lib/db.js';
import { hashPassword, verifyPassword } from './_lib/password.js';
import { createSessionCookie } from './_lib/session.js';
import {
  checkNewPassword, clearFailedPasswords, getSessionRep, isLocked, lockedMessage, recordFailedPassword,
} from './_lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const rep = await getSessionRep(req);
    if (!rep) return res.status(401).json({ ok: false, error: 'Your session ended. Sign in again.' });

    const { currentPassword, newPassword } = req.body || {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Enter your current password and a new one.' });
    }

    // Shares the sign-in lockout, so a borrowed session can't be used to
    // guess the current password either.
    if (isLocked(rep)) return res.status(429).json({ ok: false, error: lockedMessage });

    if (!(await verifyPassword(currentPassword, rep.password_hash))) {
      await recordFailedPassword(rep.id);
      return res.status(400).json({ ok: false, field: 'currentPassword', error: 'Current password is wrong.' });
    }
    await clearFailedPasswords(rep.id);

    const problem = checkNewPassword(newPassword, { username: rep.username });
    if (problem) return res.status(400).json({ ok: false, field: 'newPassword', error: problem });
    if (newPassword === currentPassword) {
      return res.status(400).json({ ok: false, field: 'newPassword', error: 'Pick a password you are not already using.' });
    }

    // The new stamp goes into both the row and this device's fresh cookie, so
    // every other session stops matching and this one keeps working.
    const [updated] = await sql`
      update reps
      set password_hash = ${await hashPassword(newPassword)},
          password_changed_at = now(),
          must_change_password = false
      where id = ${rep.id}
      returning id, full_name, password_changed_at
    `;
    res.setHeader('Set-Cookie', createSessionCookie(updated));
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[change-password] failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Try again.' });
  }
}
