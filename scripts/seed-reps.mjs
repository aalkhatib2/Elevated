#!/usr/bin/env node
// Creates portal logins for every ACTIVE rep in ROSTER below.
//
//   node --env-file=.env.local scripts/seed-reps.mjs                 create missing logins only
//   node --env-file=.env.local scripts/seed-reps.mjs --reset HMott   new password for one rep
//
// Existing logins are never touched unless named with --reset, so re-running
// after adding someone to ROSTER only creates that person. Every new or reset
// login gets its own random password, written to scripts/rep-logins.local.csv
// (git-ignored, and scripts/ is never deployed) — passwords are not printed,
// so they don't end up in terminal scrollback or logs. Hand each rep theirs,
// then delete the file.

import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';
import { generateTempPassword as newPassword, hashPassword } from '../api/_lib/password.js';

const OUT_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rep-logins.local.csv');

// Username convention: first initial + last name (Adam Alkhatib -> AAlkhatib).
// Login is case-insensitive.
//
// full_name must match the "Sales Rep" column of the weekly sales tracker
// EXACTLY (case/whitespace-tolerant) — a misspelling here silently orphans
// that rep's orders. If the sheet's spelling changes, change it here and in the
// database together — a roster name the database doesn't have makes this script
// try to create a second login. A username, once issued, can stay as it was:
// Delaney Leale's is still "Delany".
//
// recruited_by is another roster entry's username — who brought this rep on,
// for My Team's downline and leaderboard. Leave unset when unknown.
const ROSTER = [
  { full_name: 'Adam Alkhatib', username: 'AAlkhatib', rep_code: '4688257', market: 'Salt Lake City', role: 'owner', active: true },
  { full_name: 'Alejandro Benitez', username: 'ABenitez', active: true },
  { full_name: 'Christian Dick', username: 'Christian', role: 'owner', active: true, recruited_by: 'AAlkhatib' },
  { full_name: 'Christian Grey', username: 'CGrey', active: true },
  { full_name: 'Delaney Leale', username: 'Delany', active: true },
  { full_name: 'Holden Mott', username: 'HMott', active: true },
  // Izaiah, Jahzir and Jorge were removed from the database on 2026-10-06/07;
  // inactive here so a re-run doesn't quietly recreate them.
  { full_name: 'Izaiah Jimenez', username: 'IJimenez', active: false },
  { full_name: 'Jahzir Johnson', username: 'JJohnson', active: false },
  { full_name: 'James Villers', username: 'JVillers', active: true },
  { full_name: 'Jorge Jimenez', username: 'JJimenez', active: false },
  { full_name: 'Roniel Mata', username: 'RMata', active: true },
  { full_name: 'Sanders Young', username: 'SYoung', active: true },
];

function parseArgs(argv) {
  const reset = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reset' && argv[i + 1]) reset.push(argv[++i].toLowerCase());
    else { console.error(`Unknown argument: ${argv[i]}`); process.exit(1); }
  }
  return { reset };
}

async function main() {
  const { reset } = parseArgs(process.argv.slice(2));

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Run with: node --env-file=.env.local scripts/seed-reps.mjs');
    process.exit(1);
  }

  const active = ROSTER.filter((r) => r.active);
  const unknownReset = reset.filter((u) => !active.some((r) => r.username.toLowerCase() === u));
  if (unknownReset.length) {
    console.error(`Not an active roster username: ${unknownReset.join(', ')}`);
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  const existing = new Set((await sql`select full_name from reps`).map((r) => r.full_name));

  const created = [];
  const resetDone = [];
  const issued = [];

  for (const person of active) {
    const isReset = reset.includes(person.username.toLowerCase());
    if (existing.has(person.full_name) && !isReset) continue;

    const password = newPassword();
    const passwordHash = await hashPassword(password);

    // An issued password is temporary: the rep must pick their own on next
    // sign-in, and every session from before this moment stops working.
    await sql`
      insert into reps (full_name, username, password_hash, rep_code, market, role,
                        must_change_password, password_changed_at)
      values (${person.full_name}, ${person.username}, ${passwordHash}, ${person.rep_code || null}, ${person.market || null}, ${person.role || 'rep'},
              true, now())
      on conflict (full_name) do update
        set username = excluded.username,
            password_hash = excluded.password_hash,
            role = excluded.role,
            must_change_password = true,
            password_changed_at = now(),
            failed_logins = 0,
            locked_until = null
    `;

    (existing.has(person.full_name) ? resetDone : created).push(person);
    issued.push({ ...person, password });
  }

  // Resolve recruited_by usernames to ids once everyone in this run exists.
  // Only fills a recruiter the database doesn't already have.
  for (const person of active) {
    if (!person.recruited_by) continue;
    await sql`
      update reps set recruited_by = (select id from reps where username = ${person.recruited_by})
      where full_name = ${person.full_name} and recruited_by is null
    `;
  }

  if (issued.length) {
    if (!existsSync(OUT_FILE)) writeFileSync(OUT_FILE, 'full_name,username,password,issued_at\n');
    const at = new Date().toISOString();
    appendFileSync(OUT_FILE, issued.map((p) => `${p.full_name},${p.username},${p.password},${at}`).join('\n') + '\n');
  }

  const line = (p) => `  ${p.full_name.padEnd(20)} ${p.username}`;
  console.log(`\nCreated ${created.length} login(s):`);
  created.forEach((p) => console.log(line(p)));
  if (resetDone.length) {
    console.log(`\nReset ${resetDone.length} password(s):`);
    resetDone.forEach((p) => console.log(line(p)));
  }
  const skipped = active.filter((p) => existing.has(p.full_name) && !reset.includes(p.username.toLowerCase()));
  if (skipped.length) {
    console.log('\nAlready had a login (unchanged):');
    skipped.forEach((p) => console.log(line(p)));
  }
  if (issued.length) console.log(`\nPasswords written to ${OUT_FILE}\nHand each rep theirs, then delete the file.\n`);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
