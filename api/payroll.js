// Weekly payroll statements.
//
//   GET  /api/payroll?period=YYYY-MM-DD[&format=csv]
//        Any day in the wanted Mon–Sun week (default: this week). Owners get
//        every rep; a rep gets only their own lines. A closed week is read
//        from the frozen snapshot, an open one is computed live from the sheet.
//   POST /api/payroll   { period }
//        Owner only. Freezes a finished week into payroll_lines.

import { readSessionFromRequest } from './_lib/session.js';
import { sql } from './_lib/db.js';
import { getAllOrders, normalizeName } from './_lib/sheets.js';
import { addDays, buildPayroll, groupLines, payPeriodFor, toCsv } from './_lib/payroll.js';

// Dates and numerics are cast in SQL so the driver hands back plain strings
// and numbers instead of Date / string-decimal objects.
async function loadClosedLines() {
  return sql`
    select kind, order_key as "orderKey", rep_name as rep,
           rep_commission::float8 as "repCommission", office_pay::float8 as "officePay",
           period_start::text as "periodStart"
    from payroll_lines
  `;
}

async function loadFrozenWeek(periodStart) {
  const rows = await sql`
    select kind, order_key as "orderKey", rep_name as rep, order_id as "orderId",
           client_name as "clientName", gigs, install_date::text as "installDate",
           rep_commission::float8 as "repCommission", office_pay::float8 as "officePay", late
    from payroll_lines
    where period_start = ${periodStart}
  `;
  return rows;
}

function onlyRep(statement, fullName) {
  const target = normalizeName(fullName);
  const lines = statement.reps
    .filter((r) => normalizeName(r.rep) === target)
    .flatMap((r) => r.lines);
  return {
    ...statement,
    ...groupLines(lines),
    pending: (statement.pending || []).filter((l) => normalizeName(l.rep) === target),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = readSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  try {
    const meRows = await sql`select id, full_name, role from reps where id = ${session.repId} limit 1`;
    const me = meRows[0];
    if (!me) return res.status(401).json({ error: 'Not signed in' });
    const isOwner = me.role === 'owner';

    const today = new Date().toISOString().slice(0, 10);
    const requested =
      (req.method === 'POST' ? (req.body && req.body.period) : req.query && req.query.period) || today;
    const period = payPeriodFor(requested);
    if (!period) return res.status(400).json({ error: 'period must be a date like 2026-09-28' });

    const closedRows = await loadClosedLines();
    const isClosed = (await sql`select 1 from pay_periods where period_start = ${period.start}`).length > 0;

    if (req.method === 'POST') {
      if (!isOwner) return res.status(403).json({ error: 'Only the owner can close a week' });
      if (period.end >= today) {
        return res.status(409).json({ error: `That week is not over yet (ends ${period.end})` });
      }
      if (isClosed) return res.status(409).json({ error: 'That week is already closed' });

      const reps = await sql`select id, full_name from reps`;
      const orders = await getAllOrders(reps.map((r) => r.full_name));
      const statement = buildPayroll(orders, period.start, closedRows);
      const idByName = new Map(reps.map((r) => [normalizeName(r.full_name), r.id]));

      const rows = statement.reps.flatMap((r) =>
        r.lines.map((l) => ({
          kind: l.kind,
          order_key: l.orderKey,
          rep_id: idByName.get(normalizeName(l.rep)) || null,
          rep_name: l.rep,
          order_id: l.orderId,
          client_name: l.clientName,
          gigs: l.gigs,
          install_date: l.installDate,
          rep_commission: l.repCommission,
          office_pay: l.officePay,
          late: !!l.late,
        }))
      );

      // One statement, so the period and its lines land together or not at all
      // (the Neon HTTP driver has no multi-call transactions). The unique
      // constraints turn a racing double-click into a clean failure.
      const result = await sql`
        with p as (
          insert into pay_periods (period_start, period_end, closed_by)
          values (${period.start}, ${period.end}, ${me.id})
          on conflict do nothing
          returning period_start
        ), l as (
          insert into payroll_lines
            (period_start, kind, order_key, rep_id, rep_name, order_id, client_name,
             gigs, install_date, rep_commission, office_pay, late)
          select p.period_start, r.kind, r.order_key, r.rep_id, r.rep_name, r.order_id, r.client_name,
                 r.gigs, r.install_date, r.rep_commission, r.office_pay, r.late
          from p, jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(
            kind text, order_key text, rep_id uuid, rep_name text, order_id text, client_name text,
            gigs integer, install_date date, rep_commission numeric, office_pay numeric, late boolean)
          returning 1
        )
        select (select count(*) from p)::int as closed, (select count(*) from l)::int as lines
      `;
      if (!result[0].closed) return res.status(409).json({ error: 'That week is already closed' });
      return res.status(200).json({ closed: true, period, lines: result[0].lines, totals: statement.totals });
    }

    // GET
    let statement;
    if (isClosed) {
      const lines = await loadFrozenWeek(period.start);
      statement = { period, ...groupLines(lines), pending: [], closed: true };
    } else {
      const reps = await sql`select full_name from reps`;
      const orders = await getAllOrders(reps.map((r) => r.full_name));
      statement = buildPayroll(orders, period.start, closedRows);
    }
    if (!isOwner) statement = onlyRep(statement, me.full_name);

    if (req.query && req.query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="payroll-${period.start}.csv"`);
      return res.status(200).send(toCsv(statement));
    }

    return res.status(200).json({
      ...statement,
      viewer: { isOwner, fullName: me.full_name },
      prevPeriod: addDays(period.start, -7),
      nextPeriod: addDays(period.start, 7),
      canClose: isOwner && !statement.closed && period.end < today,
    });
  } catch (err) {
    console.error('[payroll] failed:', err);
    return res.status(500).json({ error: 'Could not load payroll right now. Try again shortly.' });
  }
}
