# Elevated — Field Sales Recruiting Site

A static recruiting site for **Elevated Management Group**. Dark, cinematic,
monochrome identity with a sharp (0-radius) system and a single steel accent.
No build step, no bundler, no framework — HTML files with inline CSS, plus one
shared motion script and the image assets.

## Structure

- `index.html` — the landing page, entire (inline CSS + page-state script)
- `apply.html` — the interview booking funnel, 4 questions + confirmation
- `motion.js` — the shared motion engine for both pages (see below)
- `hero-bg.jpg` — hero plate: dawn dunes, deliberately text-free
- `wordmark-elevated.webp` — the wordmark, a separate layer over the plate
- `elevated-logo.webp` — the blackletter monogram (core-values section)
- `partner-*.png` — partner logos for the Partners grid
- `mockups/` — design exploration variants (local only, not deployed)
- `prototypes/` — rep portal and commission calculator (local only, not deployed)

Landing page sections, in order: sticky nav → hero → **The Ladder** (Your Growth,
EL/STL/STC/JP) → **Campaigns** (Fiber, Virtual High Ticket, Life Insurance) →
**Our movement** (the 5 core values) → **Our Partners** → **Become Elevated**
closing → footer.

## Motion

Animation is driven by [GSAP 3](https://gsap.com) + ScrollTrigger, loaded from
jsDelivr and pinned to an exact version. `motion.js` is shared by `index.html`
and `apply.html` and works out which page it is on from the DOM.

| Page | What moves |
|---|---|
| `index.html` | Hero load sequence and two-layer parallax; the ladder pins and the four rungs climb on scrub; headings unmask line by line (SplitText); the partner grid cascades in and reveals colour on hover |
| `apply.html` | Step transitions with a height tween, progress rail fill, chip press feedback, a drawn confirmation checkmark. No pinning or scrub — it is a conversion flow |

Three rules the motion code holds to, worth knowing before editing it:

1. **The resting state in the markup is the visible one.** Animation start
   states are applied from JS only after GSAP is confirmed present. Nothing
   authors `opacity: 0` in CSS. If jsDelivr is blocked or slow, the page still
   renders completely — an inline `<head>` timeout clears the `motion-pending`
   blindfold after 1.5s whether or not the CDN ever answered.
2. **`prefers-reduced-motion: reduce` is a hard stop**, not a softening.
   `motion.js` returns before building a single timeline.
3. **One motion system.** The landing page previously used an
   IntersectionObserver reveal and a `scroll-behavior: smooth` override; both
   were removed rather than kept alongside GSAP. Two systems writing `opacity`
   and `transform` to the same nodes fight, and CSS smooth scrolling makes
   ScrollTrigger's pinned sections jump.

Two structural constraints exist purely to keep the ladder pin working, and
will break it quietly if reverted:

- `body` uses `overflow-x: clip`, not `hidden` — `hidden` makes `body` a scroll
  container and ScrollTrigger then measures the pin against the wrong scroller.
- The pin is applied to `.ladder`, **never** to `#ladder`. The section also
  holds `#growthHead`, which the nav auto-hide observer watches; pinning a
  container freezes its children's viewport position and breaks the nav.

## Local preview

```bash
python -m http.server 8000
```

Then open http://localhost:8000.

## Deployment

Hosted on **Vercel**, connected to this repo. Pushing to `main` auto-deploys to
production. `.vercelignore` keeps `mockups/`, `prototypes/` and `.claude/` out
of deployments.

- Production: https://joinelevated.net
- Contact: partners@joinelevated.net
