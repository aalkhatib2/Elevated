/* Elevated portal — prototype interactions.
   No framework, no state persistence. Enough to feel the thing.

   Motion note: GSAP is optional here. Every interaction below toggles its
   class first and only then asks the motion layer to animate the result, so
   the portal behaves identically - just without the tweening - when GSAP
   has not loaded. `html.gsap-on` is what tells portal.css to stand down and
   let GSAP own the transition instead of running its own keyframe.

   Dashboards are held to a much tighter motion budget than the marketing
   site: nothing here is pinned or scrubbed, and nothing runs past ~0.4s.
   A figure you are trying to read should never still be moving. */
(function () {

  var MOTION = !!window.gsap &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (MOTION) {
    document.documentElement.classList.add('gsap-on');
    if (window.ScrollTrigger) gsap.registerPlugin(ScrollTrigger);
  }

  /* expandable KPI cards */
  document.querySelectorAll('.kpi-bar').forEach(function (bar) {
    bar.addEventListener('click', function () {
      var card = bar.closest('.kpi');
      var fold = card.querySelector('.kpi-fold');
      var open = !card.classList.contains('is-open');

      if (!MOTION || !fold) {
        card.classList.toggle('is-open', open);
        bar.setAttribute('aria-expanded', String(open));
        return;
      }

      if (open) {
        card.classList.add('is-open');
        gsap.fromTo(fold,
          { height: 0, opacity: 0 },
          { height: 'auto', opacity: 1, duration: 0.3, ease: 'power2.out',
            clearProps: 'height,opacity' });
      } else {
        gsap.to(fold, {
          height: 0, opacity: 0, duration: 0.24, ease: 'power2.in',
          onComplete: function () {
            card.classList.remove('is-open');
            gsap.set(fold, { clearProps: 'height,opacity' });
          }
        });
      }
      bar.setAttribute('aria-expanded', String(open));
    });
  });

  /* segmented controls: time range, theme */
  document.querySelectorAll('.seg, .theme-seg').forEach(function (group) {
    group.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        group.querySelectorAll('button').forEach(function (b) {
          b.setAttribute('aria-pressed', String(b === btn));
        });
        var sub = document.querySelector('.topbar .sub');
        if (group.classList.contains('seg') && sub) {
          sub.textContent = btn.textContent + ' · Everything below respects this range';
          if (MOTION) gsap.fromTo(sub, { opacity: 0 }, { opacity: 1, duration: 0.25 });
        }
      });
    });
  });

  /* page-level tabs */
  document.querySelectorAll('.ptabs').forEach(function (group) {
    var tabs = group.querySelectorAll('button');
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) { t.setAttribute('aria-selected', String(t === tab)); });
        document.querySelectorAll('.ppane').forEach(function (p) {
          var on = p.dataset.pane === tab.dataset.pane;
          p.classList.toggle('on', on);
          if (on && MOTION) {
            gsap.fromTo(p, { opacity: 0, y: 8 },
              { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out',
                clearProps: 'opacity,transform' });
          }
        });
      });
    });
  });

  /* quick search affordance only */
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      var s = document.querySelector('.rail-search');
      if (s) { s.style.borderColor = 'var(--steel)'; setTimeout(function () { s.style.borderColor = ''; }, 600); }
    }
  });

  /* ------------------------------------------------------------------ *
   * Motion
   * ------------------------------------------------------------------ */
  if (!MOTION) return;

  /* Panels arrive on load rather than on scroll. A dashboard is a thing you
     scan, not a page you are walked through - reveal-on-scroll here would
     mean figures that are missing until you happen to look at them. */
  var panels = document.querySelectorAll('.kpi, .tbl-wrap, .road, .ppane.on');
  if (panels.length) {
    gsap.from(panels, {
      opacity: 0, y: 12, duration: 0.4, ease: 'power2.out', stagger: 0.05
    });
  }

  /* Count-ups. Only where the cell actually holds a number: several KPIs
     are still the "Add figure" placeholder, and those are left alone. */
  if (window.ScrollTrigger) {
    document.querySelectorAll('.kpi-v').forEach(function (el) {
      var raw = el.textContent.trim();
      var target = Number(raw.replace(/[^0-9.-]/g, ''));
      if (!raw || !isFinite(target) || !/[0-9]/.test(raw)) return;

      var prefix = raw.slice(0, raw.search(/[0-9]/));
      var suffix = raw.slice(raw.search(/[0-9]/) + String(target).length);
      var counter = { v: 0 };

      ScrollTrigger.create({
        trigger: el, start: 'top 92%', once: true,
        onEnter: function () {
          gsap.to(counter, {
            v: target, duration: 0.9, ease: 'power2.out',
            onUpdate: function () {
              el.textContent = prefix + Math.round(counter.v) + suffix;
            },
            onComplete: function () { el.textContent = raw; }
          });
        }
      });
    });
  }

})();
