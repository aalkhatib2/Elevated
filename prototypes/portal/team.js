/* Elevated portal — My Team live data.
   Fetches /api/team (real reps table + live Sheets order counts) and
   renders the KPI row, the Downline table, and the Leaderboard table.
   Revenue stays a placeholder pill on both — no commission column in the
   sheet yet, same reason Commission page is still mocked. */
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

  fetch('/api/team', { credentials: 'same-origin' })
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

  function render(data) {
    var totals = data.totals || {};
    setKpi('repsUnderYou', totals.repsUnderYou);
    setKpi('producing', totals.producing);
    setKpi('onboarding', totals.onboarding);
    setKpi('teamInstalls', totals.teamInstalls);

    renderDownline(data.downline || []);
    renderLeaderboard(data.leaderboard || []);
  }

  function renderDownline(rows) {
    if (!downlineBody) return;
    if (downlineCount) downlineCount.textContent = rows.length + (rows.length === 1 ? ' rep' : ' reps');

    if (!rows.length) {
      downlineBody.innerHTML =
        '<tr><td colspan="4" style="padding:0;border:none">' +
          '<div class="empty">' +
            '<div class="box"><i></i></div>' +
            '<h3>Nobody on your team yet</h3>' +
            '<p>Send your recruiting link below &mdash; once someone signs up under you, they show up here.</p>' +
          '</div>' +
        '</td></tr>';
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

  function renderLeaderboard(rows) {
    if (!leaderboardBody) return;
    if (leaderboardCount) leaderboardCount.textContent = rows.length + (rows.length === 1 ? ' rep' : ' reps');

    if (!rows.length) {
      leaderboardBody.innerHTML =
        '<tr><td colspan="5" style="padding:0;border:none">' +
          '<div class="empty"><div class="box"><i></i></div><h3>No reps yet</h3></div>' +
        '</td></tr>';
      return;
    }

    leaderboardBody.innerHTML = rows.map(function (r, i) {
      var sub = r.isYou ? 'You' : '';
      return (
        '<tr>' +
          '<td class="td-rank' + (r.isYou ? ' you' : '') + '">' + String(i + 1).padStart(2, '0') + '</td>' +
          '<td>' + (r.isYou ? '<span class="td-strong">' : '') + escapeHtml(r.fullName) + (r.isYou ? '</span>' : '') +
            (sub ? '<span class="td-sub">' + sub + '</span>' : '') + '</td>' +
          '<td class="td-mono">EL</td>' +
          '<td class="td-mono td-r">' + r.installs + ' install' + (r.installs === 1 ? '' : 's') + '</td>' +
          '<td class="td-r"><span class="figure-pill">Add figure</span></td>' +
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
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
