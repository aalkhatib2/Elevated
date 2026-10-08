import { sql } from './_lib/db.js';
import { getSessionRep } from './_lib/auth.js';
import { getOrdersForRep, RATES } from './_lib/sheets.js';
import { classifyOrder, paydayFor } from './_lib/payroll.js';

// Office pay and office margin are deliberately left out: what the office
// collects from the carrier is owners-only, and anything in this payload is
// readable by the rep in their browser even if the page never shows it.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rep = await getSessionRep(req);
    if (!rep) return res.status(401).json({ error: 'Not signed in' });

    const allReps = await sql`select full_name from reps`;
    const orders = await getOrdersForRep(
      rep.full_name,
      allReps.map((r) => r.full_name)
    );
    orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const today = new Date().toISOString().slice(0, 10);

    const totals = orders.reduce(
      (acc, o) => {
        acc.orders += 1;
        acc.gigs += o.gigs || 0;
        if (o.repCommission != null) acc.repCommission += o.repCommission;
        if (o.pricedFrom === 'sheet') acc.pricedFromSheet += 1;
        return acc;
      },
      { orders: 0, gigs: 0, repCommission: 0, pricedFromSheet: 0 }
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
      // The rep's own rate card, so the page can say what an estimate is
      // based on without hard-coding numbers that could drift from RATES.
      commissionRates: RATES.repCommission,
      orders: orders.map((o) => {
        // Payroll's own rule, so Commission and Payroll never disagree on
        // whether an order is installed, pending or cancelled.
        const stage = classifyOrder(o);
        return {
          date: o.date,
          orderId: o.orderId,
          gigs: o.gigs,
          clientName: o.clientName,
          status: o.status,
          week: o.week,
          installDate: o.installDate,
          stage,
          // The Friday after the install week. Pending orders only get one
          // while their install appointment is still ahead.
          payday: stage === 'installed' ? paydayFor(o.installDate) : null,
          expectedPayday:
            stage === 'pending' && o.installDate && o.installDate >= today ? paydayFor(o.installDate) : null,
          repCommission: o.repCommission,
          pricedFrom: o.pricedFrom,
        };
      }),
    });
  } catch (err) {
    console.error('[orders] failed:', err);
    return res.status(500).json({ error: 'Could not load orders right now. Try again shortly.' });
  }
}
