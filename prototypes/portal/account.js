/* Elevated portal — Account: change password.
   With ?setup=1 the rep is here because their password was issued to them;
   once they pick their own they continue to wherever they were headed. */
(function () {
  var form = document.getElementById('pwForm');
  if (!form) return;

  var errorEl = document.getElementById('pwError');
  var okEl = document.getElementById('pwOk');
  var btn = form.querySelector('button[type="submit"]');
  var btnText = btn.querySelector('.btn-text');
  var params = new URLSearchParams(location.search);
  var setup = params.get('setup') === '1';

  if (setup) {
    document.getElementById('setupNote').hidden = false;
    btnText.textContent = 'Save and continue';
  }

  function nextUrl() {
    var next = params.get('next');
    // Same rule as login: only ever continue within the portal itself.
    return next && next.indexOf('/prototypes/portal/') === 0 && next.indexOf('account.html') === -1
      ? next : 'overview.html';
  }

  function showError(message, field) {
    okEl.hidden = true;
    errorEl.textContent = message;
    errorEl.hidden = false;
    if (field && form[field]) form[field].focus();
  }

  function setBusy(busy) {
    btn.disabled = busy;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    okEl.hidden = true;

    var current = form.currentPassword.value;
    var next = form.newPassword.value;
    var confirm = form.confirmPassword.value;

    if (!current) return showError('Enter your current password.', 'currentPassword');
    if (next.length < 8) return showError('Use at least 8 characters.', 'newPassword');
    if (next !== confirm) return showError("The new passwords don't match.", 'confirmPassword');

    setBusy(true);
    fetch('/api/change-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next })
    })
      .then(function (res) {
        return res.json().then(function (data) { return { status: res.status, data: data }; });
      })
      .then(function (r) {
        if (r.status === 401) { location.replace('login.html'); return; }
        if (!r.data || !r.data.ok) {
          setBusy(false);
          return showError((r.data && r.data.error) || 'Could not update your password.', r.data && r.data.field);
        }
        form.reset();
        if (setup) { location.replace(nextUrl()); return; }
        setBusy(false);
        okEl.textContent = 'Password updated. Other devices have been signed out.';
        okEl.hidden = false;
      })
      .catch(function () {
        setBusy(false);
        showError('Could not reach the server. Try again.');
      });
  });
})();
