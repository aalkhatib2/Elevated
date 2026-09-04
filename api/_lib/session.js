// Signed httpOnly session cookie — a hand-rolled HMAC, not a JWT library.
// Small enough (one HMAC, one comparison) that a dependency would cost more
// than it saves for a 10-person internal tool. Deliberately stateless: there
// is no server-side revocation list, so a copied cookie stays valid until it
// expires even after logout clears it from one browser. If that ever becomes
// a real problem, the fix is a `sessions` table keyed by a session id (the
// cookie would carry the id, not the payload) — not built here.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_NAME = 'elevated_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14; // 14 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

function sign(body) {
  return createHmac('sha256', getSecret()).update(body).digest('base64url');
}

export function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function verifySession(cookieValue) {
  if (!cookieValue || typeof cookieValue !== 'string') return null;

  const dot = cookieValue.indexOf('.');
  if (dot < 0) return null;
  const body = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);

  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || Date.now() >= payload.exp) return null;
  return payload;
}

export function createSessionCookie(rep) {
  const now = Date.now();
  const value = signSession({
    repId: rep.id,
    fullName: rep.full_name,
    iat: now,
    exp: now + MAX_AGE_SECONDS * 1000,
  });
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionFromRequest(req) {
  const header = req.headers.cookie || '';
  const match = header
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return verifySession(match.slice(COOKIE_NAME.length + 1));
}
