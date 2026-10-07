/* Elevated portal — shared session check + live sidebar identity.
   Runs on every signed-in portal page. Unauthenticated visitors get bounced
   to login.html; a rep still on a password someone issued them is sent to
   Account to pick their own first; everyone else gets their real details
   populated into the sidebar via [data-field] markers. */
(function () {

  var here = location.pathname + location.search;
  var onAccount = /\/account\.html$/.test(location.pathname);

  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) return Promise.reject(res);
      return res.json();
    })
    .then(function (data) {
      if (!data || !data.authenticated) throw new Error('unauthenticated');
      if (data.mustChangePassword && !onAccount) {
        location.replace('account.html?setup=1&next=' + encodeURIComponent(here));
        return;
      }
      applyRep(data.rep);
      if (data.rep.role === 'owner') {
        document.querySelectorAll('[data-owner-only]').forEach(function (el) { el.hidden = false; });
      }
    })
    .catch(function () {
      location.replace('login.html?next=' + encodeURIComponent(here));
    });

  function applyRep(rep) {
    var fields = {
      username: rep.username,
      fullName: rep.fullName,
      team: rep.team,
      division: rep.division,
      market: rep.market,
      repCode: rep.repCode
    };
    Object.keys(fields).forEach(function (key) {
      var value = fields[key];
      // Render an explicit dash for a missing field rather than skipping
      // it — skipping would leave whatever placeholder was baked into the
      // static HTML on screen, which reads as real data for this rep.
      var text = (value == null || value === '') ? '—' : value;
      document.querySelectorAll('[data-field="' + key + '"]').forEach(function (el) {
        el.textContent = text;
      });
    });
  }

  document.querySelectorAll('[data-signout]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () {
        location.href = 'login.html';
      });
    });
  });

})();
