/* Elevated portal — Orders page live data.
   Fetches /api/orders, renders the Timeline table, and wires the search box,
   the All Time/Last Month/Last Week/This Week range buttons in the topbar,
   and Export CSV (exactly the rows currently shown). */
(function () {

  var tbody = document.querySelector('[data-orders-body]');
  if (!tbody) return; // not on a page with the Timeline table

  var countEl = document.querySelector('[data-orders-count]');
  var searchInput = document.querySelector('[data-orders-search]');
  var rangeButtons = document.querySelectorAll('[data-orders-range]');
  var exportBtn = document.querySelector('[data-orders-export]');

  var state = { all: [], filtered: [], query: '', range: 'all' };

  renderLoading();

  fetch('/api/orders', { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) throw new Error('request failed: ' + res.status);
      return res.json();
    })
    .then(function (data) {
      state.all = (data && data.orders) || [];
      applyFilters();
    })
    .catch(function (err) {
      console.error('[orders] failed to load', err);
      renderError();
    });

  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.query = searchInput.value.trim().toLowerCase();
      applyFilters();
    });
  }

  rangeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.range = btn.dataset.ordersRange;
      applyFilters();
    });
  });

  if (exportBtn) {
    exportBtn.addEventListener('click', function () {
      window.portalCsv(
        'orders-' + state.range + '-' + window.portalToday() + '.csv',
        ['Order date', 'Order #', 'Client', 'Gigs', 'Install date', 'Status in sheet', 'Stage'],
        state.filtered.map(function (o) {
          return [o.date, o.orderId, o.clientName, o.gigs, o.installDate, o.status, o.stage];
        })
      );
    });
  }

  function applyFilters() {
    var cutoff = window.portalRangeCutoff(state.range);
    state.filtered = state.all.filter(function (o) {
      if (cutoff && o.date < cutoff) return false;
      if (state.query) {
        var haystack = ((o.orderId || '') + ' ' + (o.clientName || '')).toLowerCase();
        if (haystack.indexOf(state.query) === -1) return false;
      }
      return true;
    });
    state.filtered.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
    render();
  }

  function renderLoading() {
    tbody.innerHTML = '<tr><td colspan="7" class="tbl-msg">Loading your orders&hellip;</td></tr>';
  }

  function renderError() {
    var wrap = tbody.closest('.tbl-wrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="empty">' +
        '<div class="box"><i></i></div>' +
        '<h3>Could not load your orders</h3>' +
        '<p>Something went wrong talking to the spreadsheet. ' +
        '<a href="#" data-orders-retry class="kpi-link" style="display:inline-block;margin-top:8px">Try again</a></p>' +
      '</div>';
    var retry = wrap.querySelector('[data-orders-retry]');
    if (retry) retry.addEventListener('click', function (e) { e.preventDefault(); location.reload(); });
  }

  function render() {
    if (countEl) countEl.textContent = state.filtered.length + ' total';

    if (state.filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" style="padding:0;border:none">' +
          '<div class="empty">' +
            '<div class="box"><i></i></div>' +
            '<h3>No orders yet</h3>' +
            '<p>Orders you write will show up here once they are logged for the week.</p>' +
          '</div>' +
        '</td></tr>';
      return;
    }

    tbody.innerHTML = state.filtered.map(function (o, i) {
      return (
        '<tr>' +
          '<td class="td-num">' + String(i + 1).padStart(2, '0') + '</td>' +
          '<td class="td-mono">' + formatDate(o.date) + '</td>' +
          '<td class="td-mono">' + escapeHtml(o.orderId || '—') + '</td>' +
          '<td>' + (o.clientName
            ? '<span class="td-strong">' + escapeHtml(o.clientName) + '</span>'
            : '<span style="color:var(--muted)">—</span>') + '</td>' +
          '<td class="td-mono">' + (o.gigs != null ? o.gigs + ' gig' : '—') + '</td>' +
          '<td>' + statusPill(o.status) + '</td>' +
          '<td class="td-mono">' + payCell(o) + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  // Paid the Friday after the install week (installed Thu Oct 1 -> Fri Oct 9).
  function payCell(o) {
    if (o.payday) return (o.payday < todayISO() ? 'Paid' : 'Pays') + ' Fri ' + formatDate(o.payday);
    if (o.stage === 'cancelled') return '—';
    if (o.expectedPayday) return 'Fri ' + formatDate(o.expectedPayday) + ' once installed';
    return '<span style="color:var(--muted)">After install</span>';
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function statusPill(status) {
    if (!status) return '<span class="pill" data-tone="mute">Not tracked yet</span>';
    var toneMap = { active: 'pos', pending: 'info', cancelled: 'warn', churned: 'neg' };
    var tone = toneMap[String(status).toLowerCase()] || 'mute';
    return '<span class="pill" data-tone="' + tone + '">' + escapeHtml(status) + '</span>';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    var months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var m = months[Number(parts[1]) - 1] || parts[1];
    return m + ' ' + parts[2];
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
