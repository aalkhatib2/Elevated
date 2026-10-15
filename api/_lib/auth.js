import { sql } from './db.js';
import { passwordStamp, readSessionFromRequest } from './session.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

// The signed-in rep, or null. A session issued under an earlier password is
// rejected — that is what makes a reset or a change sign out every other
// device, since the cookie itself is stateless. Cookies from before this
// check existed carry no stamp, which only matches a rep never reset since.
export async function getSessionRep(req) {
  const session = readSessionFromRequest(req);
  if (!session) return null;

  const rows = await sql`
    select id, full_name, username, rep_code, team, division, market, role,
           password_hash, must_change_password, password_changed_at,
           failed_logins, locked_until, disabled_at
    from reps
    where id = ${session.repId}
    limit 1
  `;
  const rep = rows[0];
  if (!rep || rep.disabled_at) return null;

  if ((session.pwc ?? null) !== passwordStamp(rep.password_changed_at)) return null;
  return rep;
}

export function isLocked(rep) {
  return Boolean(rep.locked_until) && new Date(rep.locked_until).getTime() > Date.now();
}

// Counts a wrong password; the fifth in a row locks the account and resets the
// counter, so the next lock needs five fresh failures rather than one.
export async function recordFailedPassword(repId) {
  await sql`
    update reps
    set failed_logins = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS} then 0 else failed_logins + 1 end,
        locked_until  = case when failed_logins + 1 >= ${MAX_FAILED_LOGINS}
                             then now() + make_interval(mins => ${LOCK_MINUTES})
                             else locked_until end
    where id = ${repId}
  `;
}

export async function clearFailedPasswords(repId) {
  await sql`update reps set failed_logins = 0, locked_until = null where id = ${repId}`;
}

// Returns an error message, or null when the new password is acceptable.
export function checkNewPassword(newPassword, { username }) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    return `Use ${MAX_PASSWORD_LENGTH} characters or fewer.`;
  }
  if (newPassword.toLowerCase().includes(String(username).toLowerCase())) {
    return "Don't include your username.";
  }
  if (/^(.)\1+$/.test(newPassword) || /^(0123456789|1234567890|12345678|87654321|password)/i.test(newPassword)) {
    return 'That one is too easy to guess. Try something else.';
  }
  return null;
}

export const lockedMessage = `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`;

// ---- sign-in throttle by address -------------------------------------------
//
// The per-account lock above stops one password being ground down, but not one
// address spraying a common password across every username. This caps failed
// sign-ins per address. Rows live a day (see scripts/schema.sql). If the table
// has not been created yet the throttle steps aside rather than locking
// everyone out, and says so in the logs.

export const MAX_IP_FAILURES = 20;
export const IP_WINDOW_MINUTES = 15;
let warnedNoThrottleTable = false;

function throttleUnavailable(err) {
  if (!warnedNoThrottleTable) {
    warnedNoThrottleTable = true;
    console.error('[auth] sign-in address throttle disabled — run the login_failures migration in scripts/schema.sql:', err.message);
  }
}

export async function ipThrottled(ip) {
  try {
    const [row] = await sql`
      select count(*)::int as n from login_failures
      where ip = ${ip} and at > now() - make_interval(mins => ${IP_WINDOW_MINUTES})
    `;
    return row.n >= MAX_IP_FAILURES;
  } catch (err) {
    throttleUnavailable(err);
    return false;
  }
}

export async function recordIpFailure(ip) {
  try {
    await sql`insert into login_failures (ip) values (${ip})`;
    // Housekeeping: a small share of failures sweeps day-old rows.
    if (Math.random() < 0.02) await sql`delete from login_failures where at < now() - interval '1 day'`;
  } catch (err) {
    throttleUnavailable(err);
  }
}
