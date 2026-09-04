#!/usr/bin/env node
// Creates or resets the login for each ACTIVE rep listed in ROSTER below.
//
// Safe to re-run: it's idempotent (upserts by full_name), so this is also
// how you reset someone's forgotten password — just re-run the script and
// hand them the new password it prints.
//
// Requires DATABASE_URL in the environment. Get it with:
//   vercel env pull .env.development.local
// then either `export $(cat .env.development.local | xargs)` or load it
// however you normally load a local .env file, and run:
//   node scripts/seed-reps.mjs
//
// Never deployed — this whole scripts/ directory is excluded in .vercelignore.

import { neon } from '@neondatabase/serverless';
import { hashPassword } from '../api/_lib/password.js';

// Username convention: first initial + last name (e.g. Adam Alkhatib ->
// AAlkhatib). Set active: true to actually seed someone — usernames for
// everyone are pre-filled below so activating a rep later is a one-line
// change, not a lookup. Password defaults to DEFAULT_PASSWORD unless a
// person has their own `password` field.
//
// full_name must match the spelling used in the "Sales Rep" column of the
// weekly sales tracker EXACTLY — matching is case/whitespace-tolerant, but a
// genuine misspelling here silently orphans that rep's own rows (they just
// won't show up). Seeded from the spreadsheet's own "Summary" roster.
const DEFAULT_PASSWORD = '000000';

const ROSTER = [
  { full_name: 'Adam Alkhatib', username: 'AAlkhatib', rep_code: '4688257', market: 'Salt Lake City', active: true },
  { full_name: 'Alejandro Benitez', username: 'ABenitez', active: false },
  { full_name: 'Christian Dick', username: 'CDick', active: false },
  { full_name: 'Holden Mott', username: 'HMott', active: false },
  { full_name: 'Izaiah Jimenez', username: 'IJimenez', active: false },
  { full_name: 'Jahzir Johnson', username: 'JJohnson', active: false },
  { full_name: 'James Villers', username: 'JVillers', active: false },
  { full_name: 'Jorge Jimenez', username: 'JJimenez', active: false },
  { full_name: 'Roniel Mata', username: 'RMata', active: false },
  { full_name: 'Sanders Young', username: 'SYoung', active: false },
];

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is not set.');
    console.error('Run `vercel env pull .env.development.local` first, load it, then re-run.');
    process.exit(1);
  }

  const toSeed = ROSTER.filter((r) => r.active);
  if (!toSeed.length) {
    console.log('Nobody in ROSTER is marked active: true — nothing to do.');
    return;
  }

  const sql = neon(connectionString);
  const results = [];

  for (const person of toSeed) {
    const password = person.password || DEFAULT_PASSWORD;
    const passwordHash = await hashPassword(password);

    await sql`
      insert into reps (full_name, username, password_hash, rep_code, market)
      values (${person.full_name}, ${person.username}, ${passwordHash}, ${person.rep_code || null}, ${person.market || null})
      on conflict (full_name) do update
        set username = excluded.username,
            password_hash = excluded.password_hash,
            rep_code = excluded.rep_code,
            market = excluded.market
    `;

    results.push({ name: person.full_name, username: person.username, password });
  }

  console.log('\nDone. Logins:\n');
  results.forEach((r) => {
    console.log(`  ${r.name.padEnd(20)} ${r.username.padEnd(14)} ${r.password}`);
  });
  console.log('\nRe-run this script anytime to reset someone\'s password (edit their `password` field first if it should differ from the default).\n');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
