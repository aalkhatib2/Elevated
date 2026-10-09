/* Elevated portal — shared session check + live sidebar identity.
   Runs on every signed-in portal page. Unauthenticated visitors get bounced
   to login.html; everyone else gets their real details populated into the
   sidebar via [data-field] markers. A rep still on a password someone issued
   them gets a centred, undismissable "pick your own password" dialog over
   whatever page they opened, with the page blurred behind it. */
(function () {

  var here = location.pathname + location.search;

  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) {
      if (!res.ok) return Promise.reject(res);
      return res.json();
    })
    .then(function (data) {
      if (!data || !data.authenticated) throw new Error('unauthenticated');
      applyRep(data.rep);
      if (data.rep.role === 'owner') {
        document.querySelectorAll('[data-owner-only]').forEach(function (el) { el.hidden = false; });
        document.querySelectorAll('.rail-badge').forEach(function (el) { el.textContent = 'Owner'; });
      }
      if (data.mustChangePassword) requireNewPassword(data.rep);
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

  function signOut() {
    fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).finally(function () {
      location.href = 'login.html';
    });
  }

  document.querySelectorAll('[data-signout]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      signOut();
    });
  });

  /* ---------------- first sign-in: pick your own password ---------------- */

  var SETUP_HTML =
    '<form class="dlg-body setup-body" novalidate>' +
      '<img class="setup-mark" src="../../brand/wordmark-elevated-light.svg" alt="Elevated" width="5424" height="799">' +
      '<div>' +
        '<p class="kicker">First sign-in</p>' +
        '<h2 id="setupTitle">Pick your own password</h2>' +
      '</div>' +
      '<p class="dlg-lede">The password you were given is temporary. Choose one only you know to continue &mdash; signed in as <b data-setup-user></b>.</p>' +
      '<label class="field"><span>Temporary password</span>' +
        '<input type="password" name="currentPassword" autocomplete="current-password" required></label>' +
      '<label class="field"><span>New password</span>' +
        '<input type="password" name="newPassword" autocomplete="new-password" minlength="8" required aria-describedby="setupHint"></label>' +
      '<label class="field"><span>Confirm new password</span>' +
        '<input type="password" name="confirmPassword" autocomplete="new-password" minlength="8" required></label>' +
      '<p class="field-hint" id="setupHint">At least 8 characters. Don’t use your username.</p>' +
      '<p class="form-msg" data-tone="error" role="alert" data-setup-error hidden></p>' +
      '<button class="btn btn-primary" type="submit"><span>Save and continue</span>' +
        '<svg class="arrow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 8h11M9 4l4 4-4 4"/></svg></button>' +
      '<button class="setup-out" type="button" data-setup-signout>Not you? Sign out</button>' +
    '</form>';

  function requireNewPassword(rep) {
    var dlg = document.createElement('dialog');
    dlg.className = 'dlg setup-dlg';
    dlg.setAttribute('aria-labelledby', 'setupTitle');
    dlg.innerHTML = SETUP_HTML;
    dlg.querySelector('[data-setup-user]').textContent = rep.username || rep.fullName || '';
    document.body.appendChild(dlg);

    var form = dlg.querySelector('form');
    var errorEl = dlg.querySelector('[data-setup-error]');
    var btn = form.querySelector('button[type="submit"]');
    var done = false;

    // The only ways out are a new password or signing out. Escape is
    // cancelled, and if a browser closes the dialog anyway (Chrome lets a
    // second Escape through), it simply opens again.
    dlg.addEventListener('cancel', function (e) { e.preventDefault(); });
    dlg.addEventListener('close', function () { if (!done) dlg.showModal(); });
    dlg.querySelector('[data-setup-signout]').addEventListener('click', function () { done = true; signOut(); });

    document.body.classList.add('is-setup');
    dlg.showModal();
    form.currentPassword.focus();

    function fail(message, field) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      if (field && form[field]) form[field].focus();
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      errorEl.hidden = true;

      var current = form.currentPassword.value;
      var next = form.newPassword.value;
      if (!current) return fail('Enter the temporary password you were given.', 'currentPassword');
      if (next.length < 8) return fail('Use at least 8 characters.', 'newPassword');
      if (next !== form.confirmPassword.value) return fail("The new passwords don't match.", 'confirmPassword');

      btn.disabled = true;
      fetch('/api/change-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next })
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
        })
        .then(function (r) {
          if (r.status === 401) { done = true; location.replace('login.html?next=' + encodeURIComponent(here)); return; }
          if (!r.data || !r.data.ok) {
            btn.disabled = false;
            var field = r.data && r.data.field;
            // This screen calls it the temporary password, so say that.
            var msg = field === 'currentPassword'
              ? 'That temporary password isn’t right.'
              : (r.data && r.data.error) || 'Could not save your password.';
            return fail(msg, field);
          }
          done = true;
          form.reset();
          dlg.close();
          dlg.remove();
          document.body.classList.remove('is-setup');
          toast('Password saved. You’re all set.');
        })
        .catch(function () {
          btn.disabled = false;
          fail('Could not reach the server. Try again.');
        });
    });
  }

  function toast(message) {
    var el = document.createElement('p');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('is-leaving'); }, 3200);
    setTimeout(function () { el.remove(); }, 3700);
  }

})();
