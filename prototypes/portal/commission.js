/* Elevated portal — Commission, from real orders only.
   Every deal the rep has written, priced at the rate card /api/orders sends
   (or the sheet's own figure, once it has one). Each order's stage comes
   from the API using Payroll's classifier, so the two pages always agree;
   cancelled orders are listed but never counted. What actually gets paid
   each week, and any chargebacks, live on the Payroll page. */
(function () {

  var weeksBody = document.querySelector('[data-cm-body="weeks"]');
  var linesBody = document.querySelector('[data-cm-body="lines"]');
  if (!weeksBody || !linesBody) return;

  var weeksCount = document.querySelector('[data-cm-count="weeks"]');
  var linesCount = document.querySelector('[data-cm-count="lines"]');
  var searchInput = document.querySelector('[data-cm-search]');
  var exportBtn = document.querySelector('[data-cm-export]');

  var money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var state = { all: [], inRange: [], range: 'all', query: '', rates: null };

  var kpi = {};
  document.querySelectorAll('[data-cm]').forEach(function (el) {
    (kpi[el.dataset.cm] = kpi[el.dataset.cm] || []).push(el);
  });
  function set(key, value) {
    (kpi[key] || []).forEach(function (el) { el.textContent = value; });
  }

  fetch('/api/orders', { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) throw new Error('request failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      state.all = (data && data.orders) || [];
      state.rates = data && data.commissionRates;
      apply();
    })
    .catch(function (err) {
      console.error('[commission] failed to load', err);
      renderError(weeksBody);
      renderError(linesBody);
    });

  document.querySelectorAll('[data-cm-range]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.range = btn.dataset.cmRange;
      apply();
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value.trim().toLowerCase();
      renderLines();
    });
  }

  if (exportBtn) exportBtn.addEventListener('click', exportCsv);

  /* ---------------- derive ---------------- */

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // Same cutoffs as the Orders page, so the two never disagree on a range.
  function rangeCutoff(range) {
    var now = new Date();
    var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (range === 'last-month') d.setUTCDate(d.getUTCDate() - 30);
    else if (range === 'last-week') d.setUTCDate(d.getUTCDate() - 7);
    else if (range === 'this-week') d.setUTCDate(d.getUTCDate() - d.getUTCDay() + (d.getUTCDay() === 0 ? -6 : 1));
    else return null;
    return d.toISOString().slice(0, 10);
  }

  function apply() {
    var cutoff = rangeCutoff(state.range);
    state.inRange = state.all
      .filter(function (o) { return !cutoff || o.date >= cutoff; })
      .sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    renderKpis();
    renderWeeks();
    renderLines();
  }

  // Cancelled orders never pay, so they never add to an estimate.
  function sum(rows) {
    return rows.reduce(function (t, o) {
      return o.stage === 'cancelled' ? t : t + (o.repCommission || 0);
    }, 0);
  }
  function stageCount(rows, stage) {
    return rows.filter(function (o) { return o.stage === stage; }).length;
  }

  /* ---------------- render ---------------- */

  function renderKpis() {
    var rows = state.inRange;
    var installed = rows.filter(function (o) { return o.stage === 'installed'; });
    set('deals', rows.length);
    set('oneGig', rows.filter(function (o) { return o.gigs === 1; }).length);
    set('twoGig', rows.filter(function (o) { return o.gigs === 2; }).length);
    set('estimated', money.format(sum(rows)));
    set('installed', money.format(sum(installed)));
    set('installedCount', installed.length);
    set('waitingCount', stageCount(rows, 'pending'));
    set('cancelledCount', stageCount(rows, 'cancelled'));
    if (state.rates) {
      set('rateCard', Object.keys(state.rates).sort().map(function (g) {
        return money.format(state.rates[g]) + ' per ' + g + '-gig';
      }).join(', '));
    }
  }

  function renderWeeks() {
    var groups = {};
    var order = [];
    state.inRange.forEach(function (o) {
      if (!groups[o.week]) { groups[o.week] = []; order.push(o.week); }
      groups[o.week].push(o);
    });
    // Rows arrive newest first, so first-seen order is newest week first.
    if (weeksCount) weeksCount.textContent = order.length + (order.length === 1 ? ' week' : ' weeks');

    if (!order.length) {
      weeksBody.innerHTML = emptyRow(6, 'No deals in this range', 'Pick a wider range, or check back once this week’s orders are logged.');
      return;
    }

    var html = order.map(function (week) {
      var rows = groups[week];
      return (
        '<tr>' +
          '<td class="td-strong">' + escapeHtml(week) + '</td>' +
          '<td class="td-mono td-r">' + rows.length + '</td>' +
          '<td class="td-mono td-r">' + count(rows, function (o) { return o.gigs === 1; }) + '</td>' +
          '<td class="td-mono td-r">' + count(rows, function (o) { return o.gigs === 2; }) + '</td>' +
          '<td class="td-mono td-r">' + count(rows, function (o) { return o.stage === 'installed'; }) + '</td>' +
          '<td class="td-mono td-r td-strong">' + money.format(sum(rows)) + '</td>' +
        '</tr>'
      );
    }).join('');

    var all = state.inRange;
    html +=
      '<tr class="tr-total">' +
        '<td>Total</td>' +
        '<td class="td-r">' + all.length + '</td>' +
        '<td class="td-r">' + count(all, function (o) { return o.gigs === 1; }) + '</td>' +
        '<td class="td-r">' + count(all, function (o) { return o.gigs === 2; }) + '</td>' +
        '<td class="td-r">' + count(all, function (o) { return o.stage === 'installed'; }) + '</td>' +
        '<td class="td-r">' + money.format(sum(all)) + '</td>' +
      '</tr>';
    weeksBody.innerHTML = html;
  }

  function visibleLines() {
    if (!state.query) return state.inRange;
    return state.inRange.filter(function (o) {
      return ((o.orderId || '') + ' ' + (o.clientName || '')).toLowerCase().indexOf(state.query) !== -1;
    });
  }

  function renderLines() {
    var rows = visibleLines();
    if (linesCount) linesCount.textContent = rows.length + (rows.length === 1 ? ' order' : ' orders');

    if (!rows.length) {
      linesBody.innerHTML = state.query
        ? emptyRow(7, 'No matches', 'Nothing in this range matches “' + escapeHtml(state.query) + '”.')
        : emptyRow(7, 'No deals in this range', 'Pick a wider range, or check back once this week’s orders are logged.');
      return;
    }

    linesBody.innerHTML = rows.map(function (o) {
      return (
        '<tr>' +
          '<td class="td-mono">' + formatDate(o.date) + '</td>' +
          '<td class="td-mono">' + escapeHtml(o.orderId || '—') + '</td>' +
          '<td>' + (o.clientName ? '<span class="td-strong">' + escapeHtml(o.clientName) + '</span>' : '<span class="td-sub" style="margin:0">—</span>') + '</td>' +
          '<td class="td-mono">' + (o.gigs != null ? o.gigs + ' gig' : '—') + '</td>' +
          '<td class="td-mono">' + (o.installDate ? formatDate(o.installDate) : '—') + '</td>' +
          '<td>' + stagePill(o.stage) + '</td>' +
          '<td class="td-r">' + (o.stage === 'cancelled'
            ? '<span class="td-sub" style="margin:0">Not counted</span>'
            : o.repCommission != null
            ? '<span class="td-mono td-strong">' + money.format(o.repCommission) + '</span>' + (o.pricedFrom === 'sheet' ? '<span class="td-sub">from sheet</span>' : '')
            : '<span class="figure-pill" title="No # of Gigs on this row in the sheet">Needs gigs</span>') +
          '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function stagePill(stage) {
    if (stage === 'installed') return '<span class="pill" data-tone="pos">Installed</span>';
    if (stage === 'cancelled') return '<span class="pill" data-tone="neg">Cancelled</span>';
    return '<span class="pill" data-tone="info">Waiting on install</span>';
  }

  function emptyRow(cols, title, text) {
    return '<tr><td colspan="' + cols + '" style="padding:0;border:none"><div class="empty">' +
      '<div class="box"><i></i></div><h3>' + title + '</h3><p>' + text + '</p></div></td></tr>';
  }

  function renderError(body) {
    var wrap = body.closest('.tbl-wrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="empty"><div class="box"><i></i></div>' +
      '<h3>Could not load your commission</h3>' +
      '<p>Something went wrong talking to the spreadsheet. ' +
      '<a href="#" class="kpi-link" data-cm-retry>Try again</a></p></div>';
    wrap.querySelector('[data-cm-retry]').addEventListener('click', function (e) { e.preventDefault(); location.reload(); });
  }

  /* ---------------- export ---------------- */

  function exportCsv() {
    var rows = visibleLines();
    var header = ['Order date', 'Order #', 'Client', 'Gigs', 'Install date', 'Stage', 'Est. commission', 'Priced from'];
    var lines = rows.map(function (o) {
      return [o.date, o.orderId, o.clientName, o.gigs, o.installDate, o.stage, o.repCommission,
        o.pricedFrom === 'sheet' ? 'sheet' : 'standard rate'].map(csvCell).join(',');
    });
    var blob = new Blob([header.join(',') + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'commission-' + state.range + '-' + todayISO() + '.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // Quotes every cell and neutralises a leading =,+,-,@ so a client name
  // can't run as a formula when the file is opened in a spreadsheet.
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* ---------------- helpers ---------------- */

  function count(rows, fn) { return rows.filter(fn).length; }

  function formatDate(iso) {
    var parts = String(iso).split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (months[Number(parts[1]) - 1] || parts[1]) + ' ' + parts[2];
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
