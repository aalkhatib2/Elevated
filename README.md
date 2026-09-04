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
- `prototypes/portal/` — the rep-facing agent portal. Deployed at `/prototypes/portal/`.
  Orders is wired to live data (see "Agent portal" below); Overview, Commission,
  and Team are still mockups with sample figures.
- `prototypes/apply.html`, `prototypes/calculator.html` — early drafts, superseded
  by the real `apply.html` above (local only, not deployed)
- `api/` — Vercel Functions backing the portal: session-cookie auth against a
  Postgres `reps` table, and a Google Sheets read pipeline for Orders

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

## Agent portal

`prototypes/portal/` — reps sign in and see their own orders, pulled live from
the team's weekly Google Sheets sales tracker. Nothing here is a CRM; it reads
a spreadsheet the team already keeps.

- **Auth**: username + password (username is first initial + last name, e.g.
  `AAlkhatib`), a signed httpOnly session cookie (`api/_lib/session.js`), reps
  stored in a Postgres `reps` table (`scripts/schema.sql`). No self-serve
  signup — `scripts/seed-reps.mjs` creates or resets a rep's login; only reps
  marked `active: true` in its `ROSTER` actually get seeded, so the rest of
  the team can be added one line at a time. Re-run it anytime to reset a
  password.
- **Data**: `api/_lib/sheets.js` reads the spreadsheet via a restricted
  Sheets-API-only API key (a service account was the original plan, but the
  GCP project's org policy blocks service-account key creation), discovering
  weekly tabs by name pattern (new tabs need no code change) rather than
  trusting the sheet's own hand-maintained Summary tab. **API-key auth only
  works against a link-readable sheet** — the spreadsheet is shared "Anyone
  with the link → Viewer", a deliberate tradeoff accepted while it holds no
  dollar amounts. Revisit (a real service account once the org policy allows
  it, or a personal OAuth refresh token — either keeps the sheet private)
  before anything sensitive lands in it.
- **Scope**: only Orders is wired. Overview/Commission/Team stay mockups until
  their underlying data (commission $, team hierarchy, milestones) exists
  somewhere real.
- **Env vars** (`vercel env add`): `GOOGLE_SHEETS_API_KEY`, `GOOGLE_SHEET_ID`,
  `DATABASE_URL` (from the Neon Marketplace integration), `SESSION_SECRET`.
- **Local dev**: `npm i -g vercel`, `vercel link`, `vercel env pull .env.development.local`,
  `vercel dev` — the plain Python static server (`elevated-landing`/`elevated-mockups`
  in `.claude/launch.json`) can't run `/api`.

## Deployment

Hosted on **Vercel**, connected to this repo. Pushing to `main` auto-deploys to
production. `.vercelignore` keeps `mockups/`, `scripts/`, `.claude/`, and most
of `prototypes/` out of deployments — `prototypes/portal/` and
`prototypes/elevated.css` are the exceptions, since the portal ships.

- Production: https://joinelevated.net
- Contact: partners@joinelevated.net
