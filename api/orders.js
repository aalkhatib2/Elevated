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
        if (o.repCommission != null) acc.repCommission += o.repCommission;
        if (o.officePay != null) acc.officePay += o.officePay;
        if (o.officeMargin != null) acc.officeMargin += o.officeMargin;
        if (o.pricedFrom === 'sheet') acc.pricedFromSheet += 1;
        return acc;
      },
      { orders: 0, gigs: 0, repCommission: 0, officePay: 0, officeMargin: 0, pricedFromSheet: 0 }
    );

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
      orders: orders.map((o) => ({
        date: o.date,
        orderId: o.orderId,
        gigs: o.gigs,
        clientName: o.clientName,
        status: o.status,
        week: o.week,
        installDate: o.installDate,
        repCommission: o.repCommission,
        officePay: o.officePay,
        officeMargin: o.officeMargin,
        pricedFrom: o.pricedFrom,
      })),
    });
  } catch (err) {
    console.error('[orders] failed:', err);
    return res.status(500).json({ error: 'Could not load orders right now. Try again shortly.' });
  }
}
