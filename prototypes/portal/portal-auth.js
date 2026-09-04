/* Elevated portal — shared session check + live sidebar identity.
   Runs on all 4 portal pages. Unauthenticated visitors get bounced to
   login.html; authenticated ones get their real name/team/division/market/
   rep code populated into the sidebar via [data-field] markers. */
(function () {

  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) return Promise.reject(res);
      return res.json();
    })
    .then(function (data) {
      if (!data || !data.authenticated) throw new Error('unauthenticated');
      applyRep(data.rep);
    })
    .catch(function () {
      var next = encodeURIComponent(location.pathname + location.search);
      location.replace('login.html?next=' + next);
    });

  function applyRep(rep) {
    var fields = {
      fullName: rep.fullName,
      team: rep.team,
      division: rep.division,
      market: rep.market,
      repCode: rep.repCode
    };
    Object.keys(fields).forEach(function (key) {
      var value = fields[key];
      if (value == null || value === '') return;
      document.querySelectorAll('[data-field="' + key + '"]').forEach(function (el) {
        el.textContent = value;
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
