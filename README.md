# Elevated — Field Sales Recruiting Landing Page

A single-page, static recruiting site for **Elevated Management Group**. Dark,
cinematic, monochrome identity with a sharp (0-radius) system and a single steel
accent. No build step — it's one self-contained `index.html` plus image assets.

## Structure

- `index.html` — the entire site (inline CSS + a small scroll-reveal script)
- `hero-elevated.jpg` — hero plate: the Elevated wordmark over dawn dunes
- `elevated-logo.jpg` — the Elevated blackletter monogram (used in the Portal section)
- `mockups/` — design exploration variants (local only, not deployed)

Sections, in order: sticky nav → hero → figures band → **The Ladder** (Your Growth,
EL/STL/STC/JP) → **How it runs** → **Portal** → **Campaigns** (Fiber, Virtual High
Ticket, Life Insurance) → **Become Elevated** closing → footer.

The page mirrors the "Elevated Design System" project on Claude Design
(`templates/recruiting-page/RecruitingPage.dc.html`).

## Local preview

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deployment

Hosted on **Vercel**, connected to this repo. Pushing to `main` auto-deploys to
production. `.vercelignore` keeps `mockups/` and `.claude/` out of deployments.

- Production: https://elevated-eight.vercel.app
- Contact: careers@elevatedmgmt.co
