// Password hashing via Node's built-in scrypt — no bcrypt dependency (native
// addon or slow pure-JS reimplementation, neither is worth it here). scrypt
// is OWASP-endorsed and memory-hard. Node's own defaults (N=16384, r=8, p=1)
// are used explicitly rather than tuned, and stored alongside the hash so
// the cost can change later without invalidating existing passwords.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$N=${N},r=${R},p=${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;

  const parts = storedHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;

  const params = {};
  for (const kv of parts[1].split(',')) {
    const [k, v] = kv.split('=');
    params[k] = Number(v);
  }

  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!salt.length || !expected.length) return false;

  const derived = await scrypt(password, salt, expected.length, {
    N: params.N,
    r: params.r,
    p: params.p,
  });

  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
