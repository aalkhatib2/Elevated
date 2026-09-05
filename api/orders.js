import { readSessionFromRequest } from './_lib/session.js';
import { sql } from './_lib/db.js';
import { getOrdersForRep } from './_lib/sheets.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = readSessionFromRequest(req);
  if (!session) return res.status(401).json({ error: 'Not signed in' });

  try {
    const repRows = await sql`
      select full_name, rep_code, team, division, market
      from reps
      where id = ${session.repId}
      limit 1
    `;
    const rep = repRows[0];
    if (!rep) return res.status(401).json({ error: 'Not signed in' });

    const allReps = await sql`select full_name from reps`;
    const orders = await getOrdersForRep(
      rep.full_name,
      allReps.map((r) => r.full_name)
    );
    orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const totals = orders.reduce(
      (acc, o) => {
        acc.orders += 1;
        acc.gigs += o.gigs || 0;
        if (o.commission != null) {
          acc.commission += o.commission;
          acc.commissionRows += 1;
        }
        return acc;
      },
      { orders: 0, gigs: 0, commission: 0, commissionRows: 0 }
    );
    // Distinguishes "every row is priced and they sum to zero" from "the sheet
    // has no Commission column yet" — the UI shouldn't render $0 for the latter.
    if (totals.commissionRows === 0) totals.commission = null;

    return res.status(200).json({
      rep: {
        fullName: rep.full_name,
        repCode: rep.rep_code,
        team: rep.team,
        division: rep.division,
        market: rep.market,
      },
      period: {
        weeksIncluded: [...new Set(orders.map((o) => o.week))],
        asOf: new Date().toISOString(),
      },
      totals,
      orders: orders.map(({ date, orderId, gigs, clientName, status, week, installDate, commission }) => ({
        date,
        orderId,
        gigs,
        clientName,
        status,
        week,
        installDate,
        commission,
      })),
    });
  } catch (err) {
    console.error('[orders] failed:', err);
    return res.status(500).json({ error: 'Could not load orders right now. Try again shortly.' });
  }
}
