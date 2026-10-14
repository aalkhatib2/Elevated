/* Elevated portal — owner's Reps page.
   Lists every login and every sheet name with no login, and drives
   /api/reps for create, edit, password reset, unlock and (de)activation.
   The server enforces owner-only; this page just says so when it isn't. */
(function () {

  var body = document.querySelector('[data-rp-body]');
  if (!body) return;

  var $ = function (sel) { return document.querySelector(sel); };
  var state = { reps: [], unmatched: [], viewerId: null, query: '' };

  var formDlg = $('[data-rp-form-dlg]');
  var form = $('[data-rp-form]');
  var confirmDlg = $('[data-rp-confirm-dlg]');
  var pwDlg = $('[data-rp-pw-dlg]');
  var editing = null;
  var usernameTouched = false;

  load();

  function load() {
    return api('GET').then(function (data) {
      state.reps = data.reps || [];
      state.unmatched = data.unmatched || [];
      state.viewerId = data.viewerId;
      $('[data-rp-add]').hidden = false;
      $('[data-rp-kpis]').hidden = false;
      render();
    }).catch(function (err) {
      if (err.status === 403) return renderBlocked();
      body.innerHTML = emptyRow(6, 'Could not load reps', escapeHtml(err.message || 'Try again in a moment.'));
    });
  }

  function api(method, payload) {
    return fetch('/api/reps', {
      method: method,
      credentials: 'same-origin',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.status === 401) { location.replace('login.html?next=' + encodeURIComponent(location.pathname)); }
        if (!res.ok || !data.ok) {
          var e = new Error(data.error || 'Something went wrong.');
          e.status = res.status; e.field = data.field;
          throw e;
        }
        return data;
      });
    });
  }

  /* ---------------- render ---------------- */

  function render() {
    var active = state.reps.filter(function (r) { return !r.disabled; });
    setText('active', active.length);
    setText('deactivated', state.reps.length - active.length);
    setText('temp', active.filter(function (r) { return r.mustChangePassword; }).length);
    setText('never', active.filter(function (r) { return !r.lastLoginAt; }).length);
    setText('unmatched', state.unmatched.length);

    renderUnmatched();
    renderReps();
    fillSheetNames();
  }

  function renderUnmatched() {
    var wrap = $('[data-rp-unmatched-wrap]');
    wrap.hidden = !state.unmatched.length;
    $('[data-rp-unmatched]').innerHTML = state.unmatched.map(function (u, i) {
      return '<tr>' +
        '<td class="td-strong">' + escapeHtml(u.name) + '</td>' +
        '<td class="td-mono td-r">' + u.orders + '</td>' +
        '<td class="td-mono">' + (u.lastOrderDate ? formatDate(u.lastOrderDate) : '—') + '</td>' +
        '<td class="td-r"><button class="row-btn" type="button" data-create-from="' + i + '">Create login</button></td>' +
      '</tr>';
    }).join('');
  }

  function visibleReps() {
    if (!state.query) return state.reps;
    return state.reps.filter(function (r) {
      return (r.fullName + ' ' + r.username).toLowerCase().indexOf(state.query) !== -1;
    });
  }

  function renderReps() {
    var rows = visibleReps();
    $('[data-rp-count]').textContent = rows.length + (rows.length === 1 ? ' rep' : ' reps');
    if (!rows.length) {
      body.innerHTML = emptyRow(6, 'No matches', 'Nobody matches “' + escapeHtml(state.query) + '”.');
      return;
    }
    body.innerHTML = rows.map(function (r) {
      var you = r.id === state.viewerId;
      // Payroll first and for everyone, deactivated too: their history still matters.
      var actions = ['<a class="row-btn" href="payroll.html?rep=' + escapeHtml(encodeURIComponent(r.fullName)) +
        '" title="View ' + escapeHtml(r.fullName) + '’s payroll">Payroll</a>'];
      if (!r.disabled) actions.push(btn('edit', r.id, 'Edit'));
      if (r.locked) actions.push(btn('unlock', r.id, 'Unlock'));
      if (!r.disabled && !you) actions.push(btn('reset', r.id, 'Reset', 'Reset password'));
      if (!you && r.role !== 'owner') actions.push(r.disabled ? btn('enable', r.id, 'Reactivate') : btn('disable', r.id, 'Deactivate'));
      return '<tr' + (r.disabled ? ' class="tr-off"' : '') + '>' +
        '<td><span class="td-strong">' + escapeHtml(r.fullName) + (you ? ' <span class="you-tag">You</span>' : '') + '</span>' +
          '<span class="td-sub">' + escapeHtml(r.username) + (r.role === 'owner' ? ' &middot; owner' : '') +
            (r.market ? ' &middot; ' + escapeHtml(r.market) : '') + (r.repCode ? ' &middot; #' + escapeHtml(r.repCode) : '') + '</span></td>' +
        '<td class="td-mono">' + (r.recruitedByName ? escapeHtml(r.recruitedByName) : '—') + '</td>' +
        '<td class="td-mono td-r">' + r.orders + '</td>' +
        '<td class="td-mono">' + (r.lastLoginAt ? relative(r.lastLoginAt) : 'Never') + '</td>' +
        '<td>' + statusPill(r) + '</td>' +
        '<td class="td-r"><div class="row-actions">' + actions.join('') + '</div></td>' +
      '</tr>';
    }).join('');
  }

  function statusPill(r) {
    if (r.disabled) return '<span class="pill" data-tone="mute">Deactivated</span>';
    if (r.locked) return '<span class="pill" data-tone="neg">Locked</span>';
    if (r.mustChangePassword) return '<span class="pill" data-tone="warn">Temp password</span>';
    return '<span class="pill" data-tone="pos">Active</span>';
  }

  function btn(action, id, label, title) {
    return '<button class="row-btn" type="button" data-act="' + action + '" data-id="' + escapeHtml(id) + '"' +
      (title ? ' title="' + title + '" aria-label="' + title + '"' : '') + '>' + label + '</button>';
  }

  function renderBlocked() {
    $('[data-rp-kpis]').hidden = true;
    body.closest('.tbl-wrap').innerHTML =
      '<div class="empty"><div class="box"><i></i></div><h3>Owners only</h3>' +
      '<p>Managing logins is limited to the owner. Ask them if your details need changing.</p></div>';
  }

  function fillSheetNames() {
    $('#rpSheetNames').innerHTML = state.unmatched.map(function (u) {
      return '<option value="' + escapeHtml(u.name) + '"></option>';
    }).join('');
  }

  /* ---------------- events ---------------- */

  $('[data-rp-search]').addEventListener('input', function (e) {
    state.query = e.target.value.trim().toLowerCase();
    renderReps();
  });

  $('[data-rp-add]').addEventListener('click', function () { openForm(null); });

  $('[data-rp-unmatched]').addEventListener('click', function (e) {
    var b = e.target.closest('[data-create-from]');
    if (!b) return;
    var u = state.unmatched[Number(b.dataset.createFrom)];
    openForm(null, { fullName: u.name, username: u.suggestedUsername });
  });

  body.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var rep = state.reps.find(function (r) { return r.id === b.dataset.id; });
    if (!rep) return;
    var act = b.dataset.act;
    if (act === 'edit') return openForm(rep);
    if (act === 'unlock') return run({ action: 'unlock', id: rep.id });
    if (act === 'enable') return run({ action: 'enable', id: rep.id });
    if (act === 'disable') {
      return confirmThen('Deactivate ' + rep.fullName + '?',
        'They’re signed out straight away and can’t sign back in. Their orders and payroll history stay, and you can reactivate them any time.',
        'Deactivate', function () { return run({ action: 'disable', id: rep.id }); });
    }
    if (act === 'reset') {
      return confirmThen('Reset ' + rep.fullName + '’s password?',
        'Their current password stops working and they’re signed out everywhere. You’ll get a temporary one to send them.',
        'Reset password', function () {
          return run({ action: 'reset', id: rep.id }).then(function (d) { if (d) showPassword(d.rep, d.tempPassword, 'New temporary password'); });
        });
    }
  });

  form.fullName.addEventListener('input', function () {
    if (!editing && !usernameTouched) form.username.value = suggest(form.fullName.value);
    nameHint();
  });
  form.username.addEventListener('input', function () { usernameTouched = true; });
  $('[data-rp-cancel]').addEventListener('click', function () { formDlg.close(); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('[data-rp-form-error]');
    err.hidden = true;
    var payload = {
      market: form.market.value,
      repCode: form.repCode.value,
      recruitedBy: form.recruitedBy.value || null
    };
    if (editing) {
      payload.action = 'update';
      payload.id = editing.id;
    } else {
      payload.action = 'create';
      payload.fullName = form.fullName.value;
      payload.username = form.username.value;
      if (!payload.fullName.trim()) return fail('Enter their full name.', 'fullName');
      if (!payload.username.trim()) return fail('Pick a username.', 'username');
    }
    var submit = $('[data-rp-form-submit]');
    submit.disabled = true;
    api('POST', payload).then(function (d) {
      formDlg.close();
      return load().then(function () { if (d.tempPassword) showPassword(d.rep, d.tempPassword, 'Login ready'); });
    }).catch(function (e2) {
      fail(e2.message, e2.field);
    }).then(function () { submit.disabled = false; });

    function fail(msg, field) {
      err.textContent = msg;
      err.hidden = false;
      if (field && form[field]) form[field].focus();
    }
  });

  $('[data-rp-pw-copy]').addEventListener('click', function () {
    var text = 'Elevated portal: ' + location.origin + '/prototypes/portal/login.html\n' +
      'Username: ' + $('[data-rp-pw-user]').textContent + '\n' +
      'Temporary password: ' + $('[data-rp-pw-pass]').textContent;
    navigator.clipboard.writeText(text).then(function () { $('[data-rp-pw-copied]').hidden = false; });
  });
  // Don't leave a password sitting in the page once the owner is done with it.
  pwDlg.addEventListener('close', function () {
    $('[data-rp-pw-pass]').textContent = '';
    $('[data-rp-pw-copied]').hidden = true;
  });

  /* ---------------- dialogs ---------------- */

  function openForm(rep, prefill) {
    editing = rep;
    usernameTouched = Boolean(prefill && prefill.username);
    form.reset();
    $('[data-rp-form-error]').hidden = true;
    $('[data-rp-form-title]').textContent = rep ? 'Edit ' + rep.fullName : 'Add rep';
    $('[data-rp-form-lede]').textContent = rep
      ? 'Name and username can’t change here — they tie the login to the sheet.'
      : 'They’ll get a temporary password to change on first sign-in.';
    $('[data-rp-form-submit]').textContent = rep ? 'Save' : 'Create login';
    form.fullName.readOnly = form.username.readOnly = Boolean(rep);

    var src = rep || prefill || {};
    form.fullName.value = src.fullName || '';
    form.username.value = src.username || '';
    form.market.value = (rep && rep.market) || '';
    form.repCode.value = (rep && rep.repCode) || '';

    form.recruitedBy.innerHTML = '<option value="">Not recorded</option>' + state.reps
      .filter(function (r) { return !r.disabled && (!rep || r.id !== rep.id); })
      .map(function (r) {
        return '<option value="' + escapeHtml(r.id) + '"' + (rep && rep.recruitedBy === r.id ? ' selected' : '') + '>' + escapeHtml(r.fullName) + '</option>';
      }).join('');

    nameHint();
    formDlg.showModal();
    (rep ? form.market : form.fullName).focus();
  }

  // Warn, don't block: a brand-new rep legitimately has no orders yet.
  function nameHint() {
    var hint = $('[data-rp-name-hint]');
    if (editing) { hint.textContent = 'Matched to the sheet by this exact name.'; return; }
    var typed = form.fullName.value.trim().toLowerCase().replace(/\s+/g, ' ');
    var inSheet = state.unmatched.some(function (u) { return u.name.toLowerCase().replace(/\s+/g, ' ') === typed; });
    hint.textContent = !typed
      ? 'Spell it exactly as it appears in the sheet’s Sales Rep column.'
      : inSheet
        ? 'Matches a name in the sheet — their existing orders will show up.'
        : 'No orders under this exact name yet. Fine for a new rep — just make sure the sheet uses the same spelling.';
  }

  function confirmThen(title, text, okLabel, fn) {
    $('[data-rp-confirm-title]').textContent = title;
    $('[data-rp-confirm-text]').textContent = text;
    $('[data-rp-confirm-ok]').textContent = okLabel;
    confirmDlg.returnValue = '';
    confirmDlg.addEventListener('close', function onClose() {
      confirmDlg.removeEventListener('close', onClose);
      if (confirmDlg.returnValue === 'ok') fn();
    });
    confirmDlg.showModal();
  }

  function showPassword(rep, password, title) {
    $('[data-rp-pw-title]').textContent = title;
    $('[data-rp-pw-name]').textContent = rep.fullName;
    $('[data-rp-pw-user]').textContent = rep.username;
    $('[data-rp-pw-pass]').textContent = password;
    pwDlg.showModal();
  }

  function run(payload) {
    return api('POST', payload)
      .then(function (d) { return load().then(function () { return d; }); })
      .catch(function (err) { alertRow(err.message); });
  }

  function alertRow(message) {
    var wrap = body.closest('.tbl-wrap');
    var note = wrap.querySelector('.tbl-alert') || wrap.insertBefore(document.createElement('p'), wrap.firstChild);
    note.className = 'form-msg tbl-alert';
    note.setAttribute('data-tone', 'error');
    note.setAttribute('role', 'alert');
    note.textContent = message;
  }

  /* ---------------- helpers ---------------- */

  function suggest(fullName) {
    var parts = fullName.trim().split(/\s+/).filter(Boolean);
    var clean = function (s) { return s.replace(/[^A-Za-z0-9]/g, ''); };
    if (parts.length < 2) return clean(parts[0] || '');
    return clean(parts[0][0].toUpperCase() + parts[parts.length - 1]);
  }

  function setText(key, value) {
    var el = document.querySelector('[data-rp="' + key + '"]');
    if (el) el.textContent = value;
  }

  function relative(iso) {
    var days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 30) return days + ' days ago';
    return formatDate(String(iso).slice(0, 10));
  }

  function formatDate(iso) {
    var p = String(iso).slice(0, 10).split('-');
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return (months[Number(p[1]) - 1] || p[1]) + ' ' + p[2];
  }

  function emptyRow(cols, title, text) {
    return '<tr><td colspan="' + cols + '" style="padding:0;border:none"><div class="empty">' +
      '<div class="box"><i></i></div><h3>' + escapeHtml(title) + '</h3><p>' + text + '</p></div></td></tr>';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

})();
