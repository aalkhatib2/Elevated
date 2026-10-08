import test from 'node:test';
import assert from 'node:assert/strict';
import { payPeriodFor, paydayFor, payPeriodPaidOn, classifyOrder, buildPayroll, toCsv } from '../api/_lib/payroll.js';

const order = (o) => ({
  week: 'SEP28 to OCT4', date: '2026-09-28', salesRep: 'Adam Alkhatib', orderId: 'A1',
  gigs: 1, installDate: null, clientName: 'Client', status: null,
  repCommission: 200, officePay: 350, ...o,
});

test('payPeriodFor: Monday and Sunday belong to the same Mon–Sun week', () => {
  assert.deepEqual(payPeriodFor('2026-09-28'), { key: '2026-09-28', start: '2026-09-28', end: '2026-10-04', payday: '2026-10-09' });
  assert.equal(payPeriodFor('2026-10-04').start, '2026-09-28'); // Sunday
  assert.equal(payPeriodFor('2026-10-05').start, '2026-10-05'); // next Monday
  assert.equal(payPeriodFor('2026-02-30'), null);
});

test('an install is paid the Friday of the following week, never its own week', () => {
  assert.equal(paydayFor('2026-10-07'), '2026-10-16'); // Wednesday -> next week's Friday
  assert.equal(paydayFor('2026-10-05'), '2026-10-16'); // Monday
  assert.equal(paydayFor('2026-10-09'), '2026-10-16'); // a Friday install still waits a week
  assert.equal(paydayFor('2026-10-11'), '2026-10-16'); // Sunday
  assert.equal(paydayFor('2026-10-12'), '2026-10-23'); // next Monday rolls to the Friday after
  assert.equal(paydayFor('2026-12-30'), '2027-01-08'); // across a year end
  assert.equal(paydayFor('nope'), null);
});

test('payPeriodPaidOn: the install week paid on the coming Friday', () => {
  assert.equal(payPeriodPaidOn('2026-10-08').start, '2026-09-28'); // Thu -> Fri Oct 9 pays Sep 28–Oct 4
  assert.equal(payPeriodPaidOn('2026-10-09').start, '2026-09-28'); // payday itself
  assert.equal(payPeriodPaidOn('2026-10-10').start, '2026-10-05'); // Sat -> Fri Oct 16 pays Oct 5–11
  assert.equal(payPeriodPaidOn('2026-10-12').payday, '2026-10-16');
});

test('classifyOrder', () => {
  assert.equal(classifyOrder(order({ status: 'Installed' })), 'installed');
  assert.equal(classifyOrder(order({ status: 'Canceled' })), 'cancelled');
  assert.equal(classifyOrder(order({ status: 'Pending' })), 'pending');
  assert.equal(classifyOrder(order({ status: null, installDate: '2026-10-01' })), 'installed');
  assert.equal(classifyOrder(order({ status: null })), 'pending');
});

test('pays on install date, not sold date', () => {
  const orders = [
    order({ orderId: 'A', date: '2026-09-20', installDate: '2026-09-30', status: 'Installed' }), // in week
    order({ orderId: 'B', date: '2026-09-29', installDate: '2026-10-06', status: 'Installed' }), // next week
    order({ orderId: 'C', date: '2026-09-29', status: 'Sold' }),                                   // pending
  ];
  const p = buildPayroll(orders, '2026-09-28');
  assert.equal(p.totals.orders, 1);
  assert.equal(p.totals.repCommission, 200);
  assert.equal(p.totals.officeMargin, 150);
  assert.deepEqual(p.pending.map((l) => l.orderId), ['C']);
});

test('groups by rep and totals', () => {
  const orders = [
    order({ orderId: 'A', installDate: '2026-09-29', status: 'Installed' }),
    order({ orderId: 'B', installDate: '2026-09-30', status: 'Installed', gigs: 2, repCommission: 300, officePay: 450 }),
    order({ orderId: 'C', salesRep: 'Christian Dick', installDate: '2026-10-01', status: 'Installed' }),
  ];
  const p = buildPayroll(orders, '2026-10-02'); // any day in the week
  assert.equal(p.reps.length, 2);
  assert.equal(p.reps[0].rep, 'Adam Alkhatib');
  assert.equal(p.reps[0].repTotal, 500);
  assert.equal(p.totals.repCommission, 700);
});

test('an order already frozen in a closed week is not paid again', () => {
  const o = order({ orderId: 'A', installDate: '2026-09-29', status: 'Installed' });
  const closed = [{ kind: 'order', orderKey: 'a', rep: o.salesRep, repCommission: 200, officePay: 350, periodStart: '2026-09-28' }];
  assert.equal(buildPayroll([o], '2026-09-28', closed).totals.orders, 0);
});

test('cancelled after being paid -> one negative chargeback in the next open week', () => {
  const o = order({ orderId: 'A', installDate: '2026-09-29', status: 'Cancelled' });
  const closed = [{ kind: 'order', orderKey: 'a', rep: o.salesRep, repCommission: 200, officePay: 350, periodStart: '2026-09-28' }];
  const next = buildPayroll([o], '2026-10-05', closed);
  assert.equal(next.totals.repCommission, -200);
  assert.equal(next.reps[0].lines[0].kind, 'chargeback');
  // Already clawed back -> not again.
  const again = buildPayroll([o], '2026-10-12', [...closed, { kind: 'chargeback', orderKey: 'a', rep: o.salesRep, periodStart: '2026-10-05' }]);
  assert.equal(again.totals.repCommission, 0);
});

test('cancelled before ever being paid costs nothing', () => {
  const o = order({ orderId: 'A', installDate: '2026-09-29', status: 'Cancelled' });
  assert.equal(buildPayroll([o], '2026-09-28').totals.repCommission, 0);
});

test('late install inside a closed week that missed its snapshot is paid now, flagged late', () => {
  const o = order({ orderId: 'L', installDate: '2026-09-29', status: 'Installed' });
  const closed = [{ kind: 'order', orderKey: 'other', rep: 'X', repCommission: 1, officePay: 1, periodStart: '2026-09-28' }];
  const p = buildPayroll([o], '2026-10-05', closed);
  assert.equal(p.totals.orders, 1);
  assert.equal(p.reps[0].lines[0].late, true);
});

test('unpriced orders are counted, not silently zeroed', () => {
  const o = order({ installDate: '2026-09-29', status: 'Installed', gigs: 3, repCommission: null, officePay: null });
  assert.equal(buildPayroll([o], '2026-09-28').totals.unpriced, 1);
});

test('csv escapes commas and totals each rep', () => {
  const o = order({ installDate: '2026-09-29', status: 'Installed', clientName: 'Doe, Jane' });
  const csv = toCsv(buildPayroll([o], '2026-09-28'));
  assert.match(csv, /"Doe, Jane"/);
  assert.match(csv, /REP TOTAL/);
});
