// Owner-only rep management.
//
//   GET  /api/reps   every login, plus Sales Rep names in the sheet with no login
//   POST /api/reps   { action, ... }
//        create  { fullName, username, market?, repCode?, recruitedBy? } -> tempPassword
//        update  { id, market?, repCode?, recruitedBy? }
//        reset   { id }                                                   -> tempPassword
//        unlock  { id }
//        disable { id } | enable { id }
//
// A temporary password is returned exactly once, to the owner, and the rep
// must replace it on first sign-in. Reps are deactivated, never deleted: the
// row keeps their orders matched and Payroll history linked.

import { sql } from './_lib/db.js';
import { getSessionRep } from './_lib/auth.js';
import { generateTempPassword, hashPassword } from './_lib/password.js';
import { getAllOrders, normalizeName } from './_lib/sheets.js';

const USERNAME_RE = /^[A-Za-z0-9._-]{2,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class BadRequest extends Error {
  constructor(message, field) { super(message); this.field = field; }
}

function text(value, { field, max, required = false }) {
  const v = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (required && !v) throw new BadRequest('This is required.', field);
  if (v.length > max) throw new BadRequest(`Keep it under ${max} characters.`, field);
  return v || null;
}

function suggestUsername(fullName) {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  const clean = (s) => s.replace(/[^A-Za-z0-9]/g, '');
  if (parts.length < 2) return clean(parts[0] || '');
  return clean(parts[0][0].toUpperCase() + parts[parts.length - 1]);
}

async function findRep(id) {
  if (!UUID_RE.test(String(id || ''))) throw new BadRequest('Unknown rep.');
  const [rep] = await sql`select id, full_name, username, role, disabled_at from reps where id = ${id}`;
  if (!rep) throw new BadRequest('Unknown rep.');
  return rep;
}

async function checkRecruiter(recruitedBy, selfId = null) {
  if (!recruitedBy) return null;
  if (!UUID_RE.test(recruitedBy)) throw new BadRequest('Pick a recruiter from the list.', 'recruitedBy');
  if (recruitedBy === selfId) throw new BadRequest("A rep can't recruit themselves.", 'recruitedBy');
  const [r] = await sql`select id from reps where id = ${recruitedBy}`;
  if (!r) throw new BadRequest('Pick a recruiter from the list.', 'recruitedBy');
  return recruitedBy;
}

async function checkUnique({ fullName, username, repCode }, selfId = null) {
  if (fullName) {
    const [dup] = await sql`
      select 1 from reps where lower(full_name) = lower(${fullName}) and id is distinct from ${selfId}`;
    if (dup) throw new BadRequest('Someone already has a login under that name.', 'fullName');
  }
  if (username) {
    const [dup] = await sql`
      select 1 from reps where lower(username) = lower(${username}) and id is distinct from ${selfId}`;
    if (dup) throw new BadRequest('That username is taken.', 'username');
  }
  if (repCode) {
    const [dup] = await sql`select 1 from reps where rep_code = ${repCode} and id is distinct from ${selfId}`;
    if (dup) throw new BadRequest('Another rep already has that rep code.', 'repCode');
  }
}

async function list() {
  const reps = await sql`
    select r.id, r.full_name, r.username, r.role, r.market, r.rep_code, r.recruited_by,
           rec.full_name as recruited_by_name, r.created_at, r.last_login_at,
           r.must_change_password, r.locked_until, r.disabled_at
    from reps r
    left join reps rec on rec.id = r.recruited_by
    order by r.disabled_at is not null, lower(r.full_name)
  `;

  const orders = await getAllOrders(reps.map((r) => r.full_name));
  const bySheetName = new Map();
  for (const o of orders) {
    const key = normalizeName(o.salesRep);
    if (!key) continue;
    const entry = bySheetName.get(key) || { name: o.salesRep.trim(), orders: 0, lastOrderDate: null };
    entry.orders += 1;
    if (!entry.lastOrderDate || o.date > entry.lastOrderDate) entry.lastOrderDate = o.date;
    bySheetName.set(key, entry);
  }

  const now = Date.now();
  const known = new Set(reps.map((r) => normalizeName(r.full_name)));
  return {
    reps: reps.map((r) => {
      const sheet = bySheetName.get(normalizeName(r.full_name));
      return {
        id: r.id,
        fullName: r.full_name,
        username: r.username,
        role: r.role,
        market: r.market,
        repCode: r.rep_code,
        recruitedBy: r.recruited_by,
        recruitedByName: r.recruited_by_name,
        createdAt: r.created_at,
        lastLoginAt: r.last_login_at,
        mustChangePassword: r.must_change_password,
        locked: Boolean(r.locked_until) && new Date(r.locked_until).getTime() > now,
        disabled: Boolean(r.disabled_at),
        orders: sheet ? sheet.orders : 0,
        lastOrderDate: sheet ? sheet.lastOrderDate : null,
      };
    }),
    // Names reps typed into the sheet that no login matches: either someone
    // who still needs a login, or a misspelling worth fixing in the sheet.
    unmatched: [...bySheetName.entries()]
      .filter(([key]) => !known.has(key))
      .map(([, e]) => ({ ...e, suggestedUsername: suggestUsername(e.name) }))
      .sort((a, b) => b.orders - a.orders),
  };
}

async function issuePassword(id) {
  const tempPassword = generateTempPassword();
  await sql`
    update reps
    set password_hash = ${await hashPassword(tempPassword)},
        must_change_password = true,
        password_changed_at = now(),
        failed_logins = 0,
        locked_until = null
    where id = ${id}
  `;
  return tempPassword;
}

async function act(body, owner) {
  const action = body && body.action;

  if (action === 'create') {
    const fullName = text(body.fullName, { field: 'fullName', max: 100, required: true });
    const username = text(body.username, { field: 'username', max: 40, required: true });
    if (!USERNAME_RE.test(username)) {
      throw new BadRequest('Letters, numbers, dots, dashes or underscores — 2 to 40 of them.', 'username');
    }
    const market = text(body.market, { field: 'market', max: 80 });
    const repCode = text(body.repCode, { field: 'repCode', max: 40 });
    const recruitedBy = await checkRecruiter(body.recruitedBy || null);
    await checkUnique({ fullName, username, repCode });

    const tempPassword = generateTempPassword();
    const [rep] = await sql`
      insert into reps (full_name, username, password_hash, market, rep_code, recruited_by,
                        must_change_password, password_changed_at)
      values (${fullName}, ${username}, ${await hashPassword(tempPassword)}, ${market}, ${repCode}, ${recruitedBy},
              true, now())
      returning id, full_name, username
    `;
    return { rep: { id: rep.id, fullName: rep.full_name, username: rep.username }, tempPassword };
  }

  const rep = await findRep(body && body.id);

  if (action === 'update') {
    const market = text(body.market, { field: 'market', max: 80 });
    const repCode = text(body.repCode, { field: 'repCode', max: 40 });
    const recruitedBy = await checkRecruiter(body.recruitedBy || null, rep.id);
    await checkUnique({ repCode }, rep.id);
    await sql`
      update reps set market = ${market}, rep_code = ${repCode}, recruited_by = ${recruitedBy}
      where id = ${rep.id}
    `;
    return {};
  }

  if (action === 'reset') {
    if (rep.id === owner.id) throw new BadRequest('Change your own password from Account.');
    if (rep.disabled_at) throw new BadRequest('Reactivate this rep first.');
    return { rep: { id: rep.id, fullName: rep.full_name, username: rep.username }, tempPassword: await issuePassword(rep.id) };
  }

  if (action === 'unlock') {
    await sql`update reps set failed_logins = 0, locked_until = null where id = ${rep.id}`;
    return {};
  }

  if (action === 'disable') {
    if (rep.id === owner.id) throw new BadRequest("You can't deactivate your own login.");
    if (rep.role === 'owner') throw new BadRequest("Owner logins can't be deactivated here.");
    await sql`update reps set disabled_at = now() where id = ${rep.id} and disabled_at is null`;
    return {};
  }

  if (action === 'enable') {
    await sql`update reps set disabled_at = null where id = ${rep.id}`;
    return {};
  }

  throw new BadRequest('Unknown action.');
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  // Responses can carry a one-time password; never let anything cache them.
  res.setHeader('Cache-Control', 'no-store');

  try {
    const me = await getSessionRep(req);
    if (!me) return res.status(401).json({ ok: false, error: 'Not signed in' });
    if (me.role !== 'owner') return res.status(403).json({ ok: false, error: 'Only the owner can manage reps.' });

    if (req.method === 'GET') return res.status(200).json({ ok: true, viewerId: me.id, ...(await list()) });
    return res.status(200).json({ ok: true, ...(await act(req.body || {}, me)) });
  } catch (err) {
    if (err instanceof BadRequest) return res.status(400).json({ ok: false, error: err.message, field: err.field });
    console.error('[reps] failed:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Try again.' });
  }
}
