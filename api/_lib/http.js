// Small request guards shared by the API handlers.

import { timingSafeEqual } from 'node:crypto';

// Authenticated JSON must never sit in a browser or proxy cache.
export function noStore(res) {
  res.setHeader('Cache-Control', 'no-store');
}

// CSRF defence in depth, on top of SameSite=Lax on the session cookie. Browsers
// always attach Origin to a cross-origin POST, so a request that names another
// origin is refused. A request with neither Origin nor Sec-Fetch-Site did not
// come from a browser (curl, the cron scheduler) and cannot be a CSRF.
export function isSameOrigin(req) {
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';

  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Sends the 403 and returns true when the request must not proceed.
export function blockCrossOrigin(req, res) {
  if (isSameOrigin(req)) return false;
  res.status(403).json({ ok: false, error: 'Cross-origin request refused.' });
  return true;
}

// Constant-time check of an "Authorization: Bearer <secret>" header against
// any number of configured secrets. An unset secret never matches.
export function bearerMatches(header, ...secrets) {
  const given = Buffer.from(String(header || ''));
  return secrets.some((secret) => {
    if (!secret) return false;
    const want = Buffer.from(`Bearer ${secret}`);
    return want.length === given.length && timingSafeEqual(want, given);
  });
}

// The caller's address as Vercel's edge reports it. Used only to throttle
// sign-in attempts, never stored beyond the throttle window.
export function clientIp(req) {
  const h = req.headers;
  const raw = h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0] || '';
  return raw.trim().slice(0, 64) || 'unknown';
}
