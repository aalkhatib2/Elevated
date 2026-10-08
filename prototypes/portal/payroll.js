/* Elevated portal — Payroll page.
   Fetches /api/payroll for one Mon–Sun install week (paid the Friday of the
   week after) and renders it the way the
   Motorsport "Sales reps" report reads: a block per rep, a line per order,
   a rep total, then the shop total. Owners also get Close week and CSV. */
(function () {

  var repsEl = document.querySelector('[data-pay-reps]');
  if (!repsEl) return;

  var kpisEl = document.querySelector('[data-pay-kpis]');
  var msgEl = document.querySelector('[data-pay-msg]');
  var rangeEl = document.querySelector('[data-pay-range]');
  var pendingWrap = document.querySelector('[data-pay-pending-wrap]');
  var pendingBody = document.querySelector('[data-pay-pending]');
  var closeBtn = document.querySelector('[data-pay-close]');
  var csvBtn = document.querySelector('[data-pay-csv]');

  var params = new URLSearchParams(location.search);
  var state = { period: params.get('period') || '', data: null };

  load();

  document.querySelector('[data-pay-prev]').addEventListener('click', function () { go(state.data && state.data.prevPeriod); });
  document.querySelector('[data-pay-next]').addEventListener('click', function () { go(state.data && state.data.nextPeriod); });
  document.querySelector('[data-pay-this]').addEventListener('click', function () { go(''); });
  document.querySelector('[data-pay-print]').addEventListener('click', function () { window.print(); });
  csvBtn.addEventListener('click', function () {
    location.href = '/api/payroll?format=csv&period=' + encodeURIComponent(state.data.period.start);
  });
  closeBtn.addEventListener('click', closeWeek);

  function go(period) {
    if (period == null) return;
    state.period = period;
    history.replaceState(null, '', period ? '?period=' + period : location.pathname);
    load();
  }

  function load() {
    msgEl.textContent = 'Loading statement…';
    msgEl.hidden = false;
    fetch('/api/payroll' + (state.period ? '?period=' + encodeURIComponent(state.period) : ''), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) { state.data = data; render(data); })
      .catch(function (err) {
        console.error('[payroll] failed to load', err);
        msgEl.textContent = 'Could not load payroll. Try again shortly.';
        repsEl.innerHTML = '';
        kpisEl.innerHTML = '';
      });
  }

  function closeWeek() {
    var p = state.data.period;
    if (!confirm('Close installs ' + p.start + ' – ' + p.end + ' (paid Friday ' + p.payday + ')? This freezes what each rep is paid for the week.')) return;
    closeBtn.disabled = true;
    fetch('/api/payroll', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: p.start })
    })
      .then(function (res) { return res.json().then(function (b) { return { ok: res.ok, body: b }; }); })
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.error || 'Could not close the week');
        load();
      })
      .catch(function (err) { alert(err.message); })
      .finally(function () { closeBtn.disabled = false; });
  }

  function render(d) {
    var owner = d.viewer.isOwner;
    rangeEl.textContent = 'Installs ' + fmtDate(d.period.start) + ' – ' + fmtDate(d.period.end) +
      ' · paid Friday ' + fmtDate(d.period.payday) + ' · ' + (d.closed ? 'Closed' : 'Open');
    closeBtn.hidden = !d.canClose;
    csvBtn.hidden = !owner;

    var t = d.totals;
    var cards = [
      ['Installs paid', String(t.orders), 'Installed this week · paid Fri ' + fmtDate(d.period.payday)],
      [owner ? 'Owed to reps' : 'You earn', money(t.repCommission), d.closed ? 'Frozen at close' : 'Live from the sheet']
    ];
    if (owner) {
      cards.push(['Office pay', money(t.officePay), 'Collected from the carrier']);
      cards.push(['Office margin', money(t.officeMargin), 'Office pay minus rep commission']);
    }
    kpisEl.innerHTML = cards.map(function (c) {
      return '<article class="kpi"><div class="kpi-bar"><span class="kpi-k">' + c[0] + '</span></div>' +
        '<div class="kpi-v">' + c[1] + '</div><p class="kpi-sub">' + c[2] + '</p></article>';
    }).join('');

    if (t.unpriced) {
      msgEl.textContent = t.unpriced + ' order' + (t.unpriced === 1 ? ' has' : 's have') +
        ' no rate (gig count not on the rate card) and counts as $0 until priced in the sheet.';
      msgEl.hidden = false;
    } else if (!d.reps.length) {
      msgEl.textContent = 'No installs in this week, so nothing pays on Friday ' + fmtDate(d.period.payday) + '.';
      msgEl.hidden = false;
    } else {
      msgEl.hidden = true;
    }

    repsEl.innerHTML = d.reps.map(function (r) {
      var rows = r.lines.map(function (l) {
        var neg = l.kind === 'chargeback';
        return '<tr>' +
          '<td class="td-mono">' + esc(l.orderId || '—') + (l.late ? ' <span class="pill" data-tone="warn">Late</span>' : '') +
            (neg ? ' <span class="pill" data-tone="neg">Chargeback</span>' : '') + '</td>' +
          '<td><span class="td-strong">' + esc(l.clientName || '—') + '</span></td>' +
          '<td class="td-mono">' + (l.installDate || '—') + '</td>' +
          '<td class="td-mono">' + (l.gigs != null ? l.gigs + ' gig' : '—') + '</td>' +
          '<td class="td-r' + (neg ? ' pay-neg' : '') + '">' + (l.repCommission == null ? '—' : money(l.repCommission)) + '</td>' +
          '</tr>';
      }).join('');
      return '<section class="pay-rep"><h3>' + esc(r.rep) + '</h3>' +
        '<div class="tbl-wrap"><div class="tbl-scroll"><table class="tbl" style="min-width:560px">' +
        '<thead><tr><th>Order #</th><th>Client</th><th>Install date</th><th>Gigs</th><th class="td-r">Commission</th></tr></thead>' +
        '<tbody>' + rows +
        '<tr class="pay-total"><td colspan="4">(' + r.orderCount + ') Rep total</td><td class="td-r">' + money(r.repTotal) + '</td></tr>' +
        '</tbody></table></div></div></section>';
    }).join('');

    var pend = d.pending || [];
    pendingWrap.hidden = !pend.length;
    pendingBody.innerHTML = pend.map(function (l) {
      return '<tr><td>' + esc(l.rep) + '</td><td class="td-mono">' + esc(l.orderId || '—') + '</td><td>' +
        esc(l.clientName || '—') + '</td><td class="td-mono">' + (l.gigs != null ? l.gigs + ' gig' : '—') +
        '</td><td class="td-mono">' + esc(l.soldDate || '') + '</td></tr>';
    }).join('');
  }

  function money(n) {
    var v = Number(n) || 0;
    return (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(iso) {
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var p = iso.split('-');
    return months[Number(p[1]) - 1] + ' ' + Number(p[2]) + ', ' + p[0];
  }

  function esc(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
