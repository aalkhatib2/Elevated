/* ==========================================================================
   ELEVATED - motion engine
   Shared by index.html and apply.html. Expects GSAP 3 + ScrollTrigger (and
   optionally SplitText / ScrollToPlugin) to be loaded from the CDN with
   `defer`, immediately ahead of this file.

   Two rules govern everything here:

   1. The DOM's resting state is the VISIBLE one. Start states are set from
      JS (gsap.set) only after GSAP is confirmed present - never authored as
      `opacity: 0` in CSS. If the CDN is blocked, the page renders normally.
   2. `html.motion-pending` hides reveal targets for the handful of frames
      between first paint and init. An inline <head> timeout clears it
      regardless of whether this file ever runs.

   Element contract (set in the markup, read here):
     [data-reveal]  generic rise + fade, batched with a proximity stagger
     [data-split]   heading / lede unmasked line by line
   Hero, ladder and partner grid are addressed by their own classes.
   ========================================================================== */
(function () {
  'use strict';

  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function showPage() { root.classList.remove('motion-pending'); }

  /* No GSAP (blocked CDN, offline, ancient browser), or the user asked for
     less motion: render the page exactly as authored and stop. Nothing below
     this line runs, so there is no partly-initialised state to clean up. */
  if (reduce || !window.gsap || !window.ScrollTrigger) { showPage(); return; }

  gsap.registerPlugin(ScrollTrigger);
  if (window.ScrollToPlugin) gsap.registerPlugin(ScrollToPlugin);
  var hasSplit = !!window.SplitText;
  if (hasSplit) gsap.registerPlugin(SplitText);

  gsap.defaults({ ease: 'power3.out', duration: 0.85 });

  var q = function (s, c) { return (c || document).querySelector(s); };
  var qa = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ------------------------------------------------------------------ *
   * 1. Generic reveals
   *
   * Start states are set before motion-pending is dropped, so nothing is
   * painted in its resting position and then yanked back. ScrollTrigger.batch
   * groups the elements that cross the trigger line in the same frame, which
   * produces a natural stagger without hand-assigning the per-sibling delays
   * the old IntersectionObserver had to compute.
   * ------------------------------------------------------------------ */
  var revealTargets = qa('[data-reveal]');
  if (revealTargets.length) gsap.set(revealTargets, { opacity: 0, y: 24 });

  showPage();

  if (revealTargets.length) {
    ScrollTrigger.batch(revealTargets, {
      start: 'top 88%',
      once: true,
      onEnter: function (batch) {
        gsap.to(batch, { opacity: 1, y: 0, duration: 0.85, stagger: 0.08, overwrite: true });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 2. Masked line reveals
   *
   * SplitText's `mask: 'lines'` wraps each line in an overflow:hidden box,
   * so lines slide up out of nothing instead of fading. `autoSplit` re-splits
   * on font load and on resize, so `onSplit` has to be idempotent: once an
   * element has played, later re-splits jump straight to the resting state
   * rather than replaying the reveal at the new width.
   * ------------------------------------------------------------------ */
  var played = typeof WeakSet === 'function' ? new WeakSet() : null;
  function hasPlayed(el) { return played ? played.has(el) : el.getAttribute('data-split-done') === '1'; }
  function markPlayed(el) { played ? played.add(el) : el.setAttribute('data-split-done', '1'); }

  qa('[data-split]').forEach(function (el) {
    if (!hasSplit) {
      /* SplitText missing: move the whole block instead of its lines. */
      gsap.set(el, { opacity: 0, y: 20 });
      ScrollTrigger.create({
        trigger: el, start: 'top 85%', once: true,
        onEnter: function () { gsap.to(el, { opacity: 1, y: 0, duration: 0.9 }); }
      });
      return;
    }

    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      linesClass: 'split-line',
      onSplit: function (self) {
        if (hasPlayed(el)) return gsap.set(self.lines, { yPercent: 0, opacity: 1 });
        return gsap.from(self.lines, {
          yPercent: 115,
          opacity: 0,
          duration: 0.95,
          ease: 'power4.out',
          stagger: 0.08,
          scrollTrigger: {
            trigger: el,
            start: 'top 85%',
            once: true,
            onEnter: function () { markPlayed(el); }
          }
        });
      }
    });
  });

  /* ------------------------------------------------------------------ *
   * 3. Hero (index.html only)
   *
   * The hero is two genuinely separate layers - a text-free dune plate and
   * the wordmark as its own element - so the intro and the parallax can move
   * them independently. Gated on the plate having decoded, otherwise the
   * image pops in halfway through its own reveal.
   * ------------------------------------------------------------------ */
  var heroArt = q('.hero-art');
  if (heroArt) {
    var heroBg = q('.hero-bg-img', heroArt);
    var wordmark = q('.hero-wordmark', heroArt);
    var tagline = q('.hero-tagline');
    var heroBtns = qa('.hero-cta-wrap .btn');

    gsap.set(heroArt, { opacity: 0, scale: 1.06, clipPath: 'inset(6% 6% 6% 6%)' });
    if (wordmark) gsap.set(wordmark, { opacity: 0, y: 18, scale: 1.04 });
    if (tagline) gsap.set(tagline, { opacity: 0 });
    if (heroBtns.length) gsap.set(heroBtns, { opacity: 0, y: 14 });

    var playHero = function () {
      var tl = gsap.timeline({ defaults: { ease: 'power3.out' } });

      tl.to(heroArt, { opacity: 1, scale: 1, clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1 });

      if (wordmark) tl.to(wordmark, { opacity: 1, y: 0, scale: 1, duration: 1 }, '-=0.7');

      if (tagline) {
        tl.set(tagline, { opacity: 1 }, '-=0.45');
        if (hasSplit) {
          /* Per-character, which suits the wide-tracked Cinzel caps: the
             letters are already visually separated at 0.34em, so the stagger
             reads as the line assembling rather than as text jittering. */
          var t = SplitText.create(tagline, { type: 'chars' });
          tl.from(t.chars, { opacity: 0, y: 8, duration: 0.5, stagger: 0.02 }, '-=0.45');
        } else {
          tl.from(tagline, { opacity: 0, y: 8, duration: 0.6 }, '-=0.45');
        }
      }

      if (heroBtns.length) tl.to(heroBtns, { opacity: 1, y: 0, duration: 0.6, stagger: 0.08 }, '-=0.3');
      return tl;
    };

    if (heroBg && heroBg.decode) heroBg.decode().then(playHero).catch(playHero);
    else playHero();

    /* Parallax. The plate is pre-scaled so the translation can never expose
       the container edge: scale 1.18 leaves 9% of headroom on each side and
       the shift tops out at 8% (GSAP applies translate in unscaled parent
       units, so 8% really is 8% of the element's own height). will-change is
       attached only while the trigger is live - a permanent compositor layer
       for a 268KB image is a real memory cost on phones. */
    if (heroBg) {
      gsap.set(heroBg, { scale: 1.18, transformOrigin: '50% 50%' });
      gsap.to(heroBg, {
        yPercent: 8,
        ease: 'none',
        scrollTrigger: {
          trigger: heroArt,
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          onToggle: function (self) { heroBg.style.willChange = self.isActive ? 'transform' : ''; }
        }
      });
    }

    if (wordmark) {
      /* Translate only, no opacity fade. An earlier version faded this to
         opacity 0.1 over the scroll range to sell the parallax depth, but
         in practice that reads as the wordmark vanishing almost as soon as
         you start scrolling, well before it has actually left the viewport
         - the fade badly outpaces the scroll. The lag from yPercent alone
         (wordmark moves 42% of its own height while the page scrolls the
         full hero) already sells the depth cue on its own. */
      gsap.to(wordmark, {
        yPercent: 42,
        ease: 'none',
        scrollTrigger: { trigger: heroArt, start: 'top top', end: 'bottom top', scrub: true }
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * 4. The ladder (index.html only)
   *
   * On desktop the rung list is pinned and scrubbed, so the four rungs are
   * experienced as a climb rather than as four rows that happen to fade in.
   * `.ladder` is what gets pinned - never `#ladder` - because the section
   * also contains #growthHead, which the nav auto-hide observer watches;
   * pinning a container freezes its children's viewport position and would
   * silently break the nav.
   * ------------------------------------------------------------------ */
  var ladder = q('.ladder');
  if (ladder) {
    var rungs = qa('.rung', ladder);
    var ladderRail = q('.ladder-line', ladder);
    var codes = qa('.rung-code', ladder);
    var mm = gsap.matchMedia();

    /* --- desktop: pinned and scrubbed --- */
    mm.add('(min-width: 861px)', function () {
      gsap.set(rungs, { opacity: 0, x: -44 });
      if (ladderRail) gsap.set(ladderRail, { scaleY: 0, transformOrigin: '50% 0%' });

      var tl = gsap.timeline({
        scrollTrigger: {
          trigger: ladder,
          /* Just below the 68px nav. Anything lower leaves a conspicuous
             band of empty section above the rungs once the heading has
             scrolled away, since the pinned box holds its full height for
             all four rungs from the start. */
          start: 'top 18%',
          end: '+=' + (rungs.length * 200),
          pin: true,
          pinSpacing: true,
          anticipatePin: 1,
          scrub: 0.6
        }
      });

      /* The rail draws downward as the rungs arrive. Downward on screen is
         upward in rank: EL is the first rung in the DOM, JP is the last. */
      if (ladderRail) tl.to(ladderRail, { scaleY: 1, ease: 'none', duration: rungs.length }, 0);

      rungs.forEach(function (rung, i) {
        tl.to(rung, { opacity: 1, x: 0, duration: 0.75, ease: 'power2.out' }, i * 0.9);

        /* A highlight travels up the ladder with the scroll. The last rung
           (JP) is already steel at rest, so it is left alone rather than
           being flashed and returned to white. */
        var code = codes[i];
        if (code && !rung.classList.contains('rung-4')) {
          tl.fromTo(code,
            { color: '#F4F5F6' },
            { color: '#9DB6CE', duration: 0.4, ease: 'none', yoyo: true, repeat: 1 },
            i * 0.9 + 0.2);
        }
      });

      return function () {
        gsap.set(rungs, { clearProps: 'all' });
        if (ladderRail) gsap.set(ladderRail, { clearProps: 'all' });
        gsap.set(codes, { clearProps: 'color' });
      };
    });

    /* --- mobile: no pin. Below 861px the rungs collapse to one column with
       no indent left to travel from, and pinning on touch is where
       ScrollTrigger feels worst. Plain staggered entrances instead. --- */
    mm.add('(max-width: 860px)', function () {
      gsap.set(rungs, { opacity: 0, y: 26 });
      if (ladderRail) gsap.set(ladderRail, { scaleY: 0, transformOrigin: '50% 0%' });

      var triggers = rungs.map(function (rung) {
        return ScrollTrigger.create({
          trigger: rung, start: 'top 88%', once: true,
          onEnter: function () { gsap.to(rung, { opacity: 1, y: 0, duration: 0.8 }); }
        });
      });

      var railTween = ladderRail && gsap.to(ladderRail, {
        scaleY: 1, ease: 'none',
        scrollTrigger: { trigger: ladder, start: 'top 80%', end: 'bottom 70%', scrub: 0.5 }
      });

      return function () {
        triggers.forEach(function (t) { t.kill(); });
        if (railTween) railTween.kill();
        gsap.set(rungs, { clearProps: 'all' });
        if (ladderRail) gsap.set(ladderRail, { clearProps: 'all' });
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * 5. Partner grid (index.html only)
   *
   * `grid: 'auto'` measures the cells' real positions, so the cascade stays
   * diagonal whether the grid is at 4, 2 or 1 columns.
   * ------------------------------------------------------------------ */
  var partnersGrid = q('.partners-grid');
  if (partnersGrid) {
    var cells = qa('.partner-cell', partnersGrid);
    gsap.set(cells, { opacity: 0, y: 28 });
    ScrollTrigger.create({
      trigger: partnersGrid,
      start: 'top 82%',
      once: true,
      onEnter: function () {
        gsap.to(cells, {
          opacity: 1, y: 0, duration: 0.8,
          stagger: { grid: 'auto', from: 'start', amount: 0.6 }
        });
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. In-page anchors
   *
   * CSS `scroll-behavior: smooth` fights ScrollTrigger's scrub and pin (it
   * makes pinned sections jump), so the old documentElement override is gone
   * and ScrollToPlugin drives anchors instead. offsetY clears the 68px
   * sticky header.
   * ------------------------------------------------------------------ */
  if (window.ScrollToPlugin) {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute('href');
      if (!id || id === '#' || !document.querySelector(id)) return;
      e.preventDefault();
      gsap.to(window, {
        duration: 0.8,
        ease: 'power2.inOut',
        scrollTo: { y: id, offsetY: 68, autoKill: true }
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. Apply funnel (apply.html only)
   *
   * Deliberately no pinning and no scrub here - this is a conversion flow,
   * and nothing should stand between a candidate and the next field. The
   * step state machine in apply.html still owns all the class toggling; this
   * only animates what it has already decided, and the funnel keeps working
   * untouched when this file never loads.
   * ------------------------------------------------------------------ */
  var railEl = q('#rail');
  if (railEl) {
    var railFill = q('.rail-fill', railEl);
    var railSteps = qa('.rail-step', railEl);
    var firstStep = q('.step');
    var stepHost = firstStep && firstStep.parentElement;

    if (railFill) gsap.set(railFill, { scaleX: 0.25, transformOrigin: '0% 50%' });

    window.ElevatedMotion = {
      stepChange: function (incoming, index) {
        if (!incoming) return;
        var tl = gsap.timeline();

        /* Tween the host's height so the card doesn't snap between steps of
           very different lengths. The outgoing step is already display:none
           by the time this runs, so `from` is the height the host still
           reports and `to` is what it becomes once laid out. */
        if (stepHost) {
          var from = stepHost.offsetHeight;
          gsap.set(stepHost, { height: 'auto' });
          var to = stepHost.offsetHeight;
          if (from && to && Math.abs(from - to) > 8) {
            tl.fromTo(stepHost, { height: from }, {
              height: to, duration: 0.35, ease: 'power2.out',
              onComplete: function () { gsap.set(stepHost, { clearProps: 'height' }); }
            }, 0);
          } else {
            gsap.set(stepHost, { clearProps: 'height' });
          }
        }

        var bits = qa('h2, .lede, .field, .choices, .slots, .actions', incoming)
          .filter(function (el) { return el.offsetParent !== null; })
          .slice(0, 10);

        tl.fromTo(incoming, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.35 }, 0);
        if (bits.length) {
          tl.fromTo(bits, { opacity: 0, y: 10 },
            { opacity: 1, y: 0, duration: 0.4, stagger: 0.045, clearProps: 'opacity,transform' }, 0.06);
        }

        if (railFill && railSteps.length) {
          var pct = Math.min(index, railSteps.length) / railSteps.length;
          gsap.to(railFill, { scaleX: pct, duration: 0.5, ease: 'power2.out' });
        }

        /* Step 5 is the confirmation. Draw the check rather than fading it,
           so the end of the funnel actually lands. */
        var check = q('.confirm-check path', incoming);
        if (check) {
          var len = check.getTotalLength ? check.getTotalLength() : 60;
          tl.fromTo(check,
            { strokeDasharray: len, strokeDashoffset: len },
            { strokeDashoffset: 0, duration: 0.6, ease: 'power2.inOut' }, 0.25);
        }
      },

      error: function (el) {
        if (!el) return;
        gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.25 });
        gsap.fromTo(el, { x: -6 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.35)' });
      }
    };

    /* Press feedback on choice chips and interview slots. */
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.choice, .slot');
      if (!chip) return;
      gsap.fromTo(chip, { scale: 0.985 }, { scale: 1, duration: 0.35, ease: 'power2.out' });
    });
  }

  /* ------------------------------------------------------------------ *
   * 8. Recalculate once the page has actually settled.
   *
   * Every trigger's start/end is derived from layout. The webfonts
   * (Montserrat, Cinzel) and the hero plate both change layout after first
   * paint, so without these refreshes the triggers fire against stale
   * positions.
   * ------------------------------------------------------------------ */
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { ScrollTrigger.refresh(); });
  }
  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
