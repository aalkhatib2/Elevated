/* Elevated portal — My Team live data.
   Fetches /api/team (real reps table + live Sheets order counts) and
   renders the KPI row, the Downline table, and the Leaderboard table.
   The topbar range re-asks the server (the counts come from the sheet),
   the search boxes filter what's loaded, and Export CSV downloads exactly
   the rows being shown. */
(function () {

  var kpiEls = {};
  document.querySelectorAll('[data-team]').forEach(function (el) {
    (kpiEls[el.dataset.team] = kpiEls[el.dataset.team] || []).push(el);
  });
  function setKpi(key, value) {
    (kpiEls[key] || []).forEach(function (el) { el.textContent = value; });
  }

  var downlineBody = document.querySelector('[data-team-body="downline"]');
  var leaderboardBody = document.querySelector('[data-team-body="leaderboard"]');
  var downlineCount = document.querySelector('[data-team-count="downline"]');
  var leaderboardCount = document.querySelector('[data-team-count="leaderboard"]');

  if (!downlineBody && !leaderboardBody) return;

  var RANGE_LABEL = {
    'all': 'all time',
    'last-month': 'last 30 days',
    'last-week': 'last 7 days',
    'this-week': 'this week'
  };

  var state = { range: 'all', downline: [], leaderboard: [], query: { downline: '', leaderboard: '' } };

  load();

  document.querySelectorAll('[data-team-range]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.range = btn.dataset.teamRange;
      load();
    });
  });

  document.querySelectorAll('[data-team-search]').forEach(function (input) {
    input.addEventListener('input', function () {
      state.query[input.dataset.teamSearch] = input.value.trim().toLowerCase();
      if (input.dataset.teamSearch === 'downline') renderDownline(); else renderLeaderboard();
    });
  });

  document.querySelectorAll('[data-team-export]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var which = btn.dataset.teamExport;
      var stamp = state.range + '-' + window.portalToday();
      if (which === 'downline') {
        window.portalCsv('team-downline-' + stamp + '.csv',
          ['Rep', 'Market', 'Recruited', 'Orders (' + RANGE_LABEL[state.range] + ')', 'Status'],
          shown('downline').map(function (r) {
            return [r.fullName, r.market, r.recruitedAt ? String(r.recruitedAt).slice(0, 10) : '', r.installs, r.status];
          }));
      } else {
        var rows = state.leaderboard;
        window.portalCsv('team-leaderboard-' + stamp + '.csv',
          ['Rank', 'Rep', 'Orders (' + RANGE_LABEL[state.range] + ')'],
          shown('leaderboard').map(function (r) {
            return [rows.indexOf(r) + 1, r.fullName, r.installs];
          }));
      }
    });
  });

  function load() {
    fetch('/api/team?range=' + encodeURIComponent(state.range), { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('request failed: ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function (err) {
        console.error('[team] failed to load', err);
        renderError(downlineBody);
        renderError(leaderboardBody);
      });
  }

  function render(data) {
    var totals = data.totals || {};
    var label = RANGE_LABEL[data.range] || RANGE_LABEL.all;
    setKpi('repsUnderYou', totals.repsUnderYou);
    setKpi('producing', totals.producing);
    setKpi('onboarding', totals.onboarding);
    setKpi('teamInstalls', totals.teamInstalls);
    setKpi('rangeLabel', label.charAt(0).toUpperCase() + label.slice(1));
    setKpi('rangeHead', 'Installs, ' + label);

    state.downline = data.downline || [];
    state.leaderboard = data.leaderboard || [];
    renderDownline();
    renderLeaderboard();
  }

  // The rows the search currently lets through, in their ranked order.
  function shown(which) {
    var rows = which === 'downline' ? state.downline : state.leaderboard;
    var q = state.query[which];
    return q ? rows.filter(function (r) { return r.fullName.toLowerCase().indexOf(q) !== -1; }) : rows;
  }

  function emptyRow(cols, title, text) {
    return '<tr><td colspan="' + cols + '" style="padding:0;border:none"><div class="empty">' +
      '<div class="box"><i></i></div><h3>' + title + '</h3>' + (text ? '<p>' + text + '</p>' : '') + '</div></td></tr>';
  }

  function renderDownline() {
    if (!downlineBody) return;
    var rows = shown('downline');
    if (downlineCount) downlineCount.textContent = rows.length + (rows.length === 1 ? ' rep' : ' reps');

    if (!state.downline.length) {
      downlineBody.innerHTML = emptyRow(4, 'Nobody on your team yet',
        'Send your interview link below &mdash; once someone joins, the office sets you as their recruiter and they show up here.');
      return;
    }
    if (!rows.length) {
      downlineBody.innerHTML = emptyRow(4, 'No matches', 'Nobody on your team matches “' + escapeHtml(state.query.downline) + '”.');
      return;
    }

    downlineBody.innerHTML = rows.map(function (r) {
      var sub = 'Recruited ' + formatMonthYear(r.recruitedAt) + (r.market ? ' &middot; ' + escapeHtml(r.market) : '');
      var tone = r.status === 'Producing' ? 'pos' : 'info';
      return (
        '<tr>' +
          '<td><span class="td-strong">' + escapeHtml(r.fullName) + '</span><span class="td-sub">' + sub + '</span></td>' +
          '<td class="td-mono">EL</td>' +
          '<td class="td-mono td-r">' + r.installs + '</td>' +
          '<td><span class="pill" data-tone="' + tone + '">' + r.status + '</span></td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderLeaderboard() {
    if (!leaderboardBody) return;
    var rows = shown('leaderboard');
    if (leaderboardCount) leaderboardCount.textContent = rows.length + (rows.length === 1 ? ' rep' : ' reps');

    if (!state.leaderboard.length) {
      leaderboardBody.innerHTML = emptyRow(4, 'No reps yet', '');
      return;
    }
    if (!rows.length) {
      leaderboardBody.innerHTML = emptyRow(4, 'No matches', 'Nobody matches “' + escapeHtml(state.query.leaderboard) + '”.');
      return;
    }

    // Rank comes from the full ranking, so a search doesn't renumber people.
    leaderboardBody.innerHTML = rows.map(function (r) {
      var rank = state.leaderboard.indexOf(r) + 1;
      return (
        '<tr>' +
          '<td class="td-rank' + (r.isYou ? ' you' : '') + '">' + String(rank).padStart(2, '0') + '</td>' +
          '<td>' + (r.isYou ? '<span class="td-strong">' : '') + escapeHtml(r.fullName) + (r.isYou ? '</span>' : '') +
            (r.isYou ? '<span class="td-sub">You</span>' : '') + '</td>' +
          '<td class="td-mono">EL</td>' +
          '<td class="td-mono td-r">' + r.installs + ' install' + (r.installs === 1 ? '' : 's') + '</td>' +
        '</tr>'
      );
    }).join('');
  }

  function renderError(body) {
    if (!body) return;
    var wrap = body.closest('.tbl-wrap');
    if (!wrap) return;
    wrap.innerHTML =
      '<div class="empty">' +
        '<div class="box"><i></i></div>' +
        '<h3>Could not load your team</h3>' +
        '<p>Something went wrong talking to the server. <a href="#" data-team-retry class="kpi-link" style="display:inline-block;margin-top:8px">Try again</a></p>' +
      '</div>';
    var retry = wrap.querySelector('[data-team-retry]');
    if (retry) retry.addEventListener('click', function (e) { e.preventDefault(); location.reload(); });
  }

  function formatMonthYear(iso) {
    if (!iso) return 'recently';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'recently';
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
