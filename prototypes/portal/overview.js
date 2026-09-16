/* Elevated portal — Overview live figures.
   Pulls the same /api/orders payload the Orders page uses and fills in the
   Road to Elevated rail plus the Volume cards. Only figures the Fiber Sales
   sheet actually supports are wired here: order count and the gig split.
   The Money cards stay placeholders until the sheet grows a commission
   column — see the note under the Money heading. */
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

})();
