/* Elevated portal — Overview live figures.
   Pulls the same /api/orders payload the Orders page uses and fills in the
   Road to Elevated rail plus the Volume cards. The Money cards read
   /api/payroll — this week, last week and everything still waiting on an
   install — so they can never disagree with the Payroll page. */
(function () {

  // The single source of truth for the rail. The markup's resting state
  // mirrors these, but every number the rep reads is computed from here so
  // the fill, the percentage, the tier name and the gap can't drift apart.
  var TARGET = 150;
  var TIERS = [
    { at: 40,  name: 'Foundation' },
    { at: 75,  name: 'Momentum' },
    { at: 110, name: 'Prime' },
    { at: 150, name: 'Final Surge' }
  ];

  var els = {};
  document.querySelectorAll('[data-ov]').forEach(function (el) {
    (els[el.dataset.ov] = els[el.dataset.ov] || []).push(el);
  });

  function set(key, value) {
    (els[key] || []).forEach(function (el) { el.textContent = value; });
  }

  /* ---------------- live figures ---------------- */

  if (Object.keys(els).length) {
    fetch('/api/orders', { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('request failed: ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        console.error('[overview] could not load figures', err);
        // Leave the em-dash resting state in place rather than showing a
        // zero, which would read as "you sold nothing" instead of "we could
        // not reach the sheet".
      });
  }

  function render(data) {
    var orders = (data && data.orders) || [];
    var count = orders.length;
    var oneGig = orders.filter(function (o) { return o.gigs === 1; }).length;
    var twoGig = orders.filter(function (o) { return o.gigs === 2; }).length;
    var gigs = orders.reduce(function (sum, o) { return sum + (o.gigs || 0); }, 0);

    set('orders', count);
    set('gigs', gigs);
    set('oneGig', oneGig);
    set('twoGig', twoGig);
    set('oneGigPct', pct(oneGig, count));
    set('twoGigPct', pct(twoGig, count));

    // --- rail ---
    var capped = Math.min(count, TARGET);
    var percent = Math.round((capped / TARGET) * 100);
    var remaining = Math.max(TARGET - count, 0);

    set('roadCount', count.toLocaleString());
    set('roadGap', remaining.toLocaleString());
    set('roadPct', percent);
    set('roadTier', currentTier(count));

    (els.roadFill || []).forEach(function (el) {
      el.style.width = (capped / TARGET) * 100 + '%';
    });

    // A node/mark is "hit" once its threshold is actually cleared.
    document.querySelectorAll('[data-node]').forEach(function (el) {
      el.classList.toggle('hit', count >= Number(el.dataset.node));
    });
    document.querySelectorAll('[data-mark]').forEach(function (el) {
      el.classList.toggle('hit', count >= Number(el.dataset.mark));
    });
  }

  function pct(part, whole) {
    return whole ? Math.round((part / whole) * 100) + '%' : '0%';
  }

  // The tier you are working inside: the first threshold you have not yet
  // cleared. Once everything is cleared you are at the top one.
  function currentTier(count) {
    for (var i = 0; i < TIERS.length; i++) {
      if (count < TIERS[i].at) return TIERS[i].name;
    }
    return TIERS[TIERS.length - 1].name;
  }

  /* ---------------- money ---------------- */

  var mn = {};
  document.querySelectorAll('[data-mn]').forEach(function (el) {
    (mn[el.dataset.mn] = mn[el.dataset.mn] || []).push(el);
  });
  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function put(key, value) {
    (mn[key] || []).forEach(function (el) { el.textContent = value; });
  }
  function flag(key, text) {
    (mn[key] || []).forEach(function (el) { el.textContent = text || ''; el.hidden = !text; });
  }

  if (Object.keys(mn).length) loadMoney();

  function loadMoney() {
    // Leave the em-dash resting state on any failure: a zero would read as
    // "you are owed nothing", not "we could not reach Payroll".
    fetchPayroll('').then(function (thisWeek) {
      renderWeek('this', thisWeek);
      renderWaiting(thisWeek);
      return fetchPayroll(thisWeek.prevPeriod).then(function (lastWeek) { renderWeek('last', lastWeek); });
    }).catch(function (err) {
      console.error('[overview] could not load money figures', err);
    });
  }

  function fetchPayroll(period) {
    return fetch('/api/payroll' + (period ? '?period=' + encodeURIComponent(period) : ''), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('request failed: ' + res.status);
        return res.json();
      });
  }

  function norm(name) { return String(name || '').trim().toLowerCase().replace(/\s+/g, ' '); }

  // The owner's payroll response covers every rep; these cards are the
  // viewer's own, so pick out their block (a rep's response is already just them).
  function mine(d) {
    var me = norm(d.viewer && d.viewer.fullName);
    return (d.reps || []).filter(function (r) { return norm(r.rep) === me; })[0] || { lines: [], repTotal: 0 };
  }

  function renderWeek(prefix, d) {
    var block = mine(d);
    var installs = block.lines.filter(function (l) { return l.kind !== 'chargeback'; });
    var backs = block.lines.filter(function (l) { return l.kind === 'chargeback'; });
    var backTotal = backs.reduce(function (t, l) { return t + (l.repCommission || 0); }, 0);

    put(prefix + 'Total', money.format(block.repTotal || 0));
    put(prefix + 'Count', installs.length + (installs.length === 1 ? ' install' : ' installs') +
      (backs.length ? ' · ' + money.format(backTotal) + ' in chargebacks' : ''));
    put(prefix + 'Range', fmt(d.period.start) + ' – ' + fmt(d.period.end));

    if (prefix === 'this') flag('thisFlag', d.closed ? 'Closed — this is final' : 'Open — can still change');
    else flag('lastFlag', d.closed ? 'Closed and frozen' : 'Not closed yet');
  }

  function renderWaiting(d) {
    var me = norm(d.viewer.fullName);
    var rows = (d.pending || []).filter(function (l) { return norm(l.rep) === me; });
    var total = rows.reduce(function (t, l) { return t + (l.repCommission || 0); }, 0);
    var oldest = rows.reduce(function (min, l) { return l.soldDate && (!min || l.soldDate < min) ? l.soldDate : min; }, null);
    put('waitingTotal', money.format(total));
    put('waitingCount', rows.length + (rows.length === 1 ? ' order' : ' orders') + ' sold, not installed');
    put('waitingOldest', oldest ? ' · oldest sold ' + fmt(oldest) : '');
  }

  function fmt(iso) {
    var p = String(iso).split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (months[Number(p[1]) - 1] || p[1]) + ' ' + Number(p[2]);
  }

})();
