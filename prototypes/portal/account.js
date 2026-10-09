/* Elevated portal — Account: change password any time. A first sign-in on an
   issued password is handled by the dialog in portal-auth.js instead. */
(function () {
  var form = document.getElementById('pwForm');
  if (!form) return;

  var errorEl = document.getElementById('pwError');
  var okEl = document.getElementById('pwOk');
  var btn = form.querySelector('button[type="submit"]');

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
