# Elevated — Field Sales Recruiting Landing Page

## Cursor Cloud specific instructions

This repo is a single static site: `index.html` (inline CSS + a little vanilla JS) plus two image assets. There is **no package manager, no build step, no backend, no tests**. Deployment is handled by Vercel on push to `main`.

- **Run the dev server:** serve the repo root with any static file server. Note that only `python3` is available on this VM — the `python` command is **not** aliased, so the README/`.claude/launch.json` commands must be run as `python3 -m http.server 5173` (not `python -m http.server`).
- **Landing page:** `python3 -m http.server 5173` from `/workspace`, then open `http://localhost:5173/`.
- **Mockups (optional, not deployed):** `python3 -m http.server 5174` serves the `mockups/` design variants. `prototypes/` (portal/calculator/apply) are also local-only and excluded from deploy.
- **No build/lint/test:** there is nothing to compile, lint, or test. "Testing" means visual/manual verification in a browser (responsive breakpoints, scroll-reveal animations, mobile hamburger menu, `mailto:careers@elevatedmgmt.co` CTAs).
- `.claude/`, `mockups/`, and `prototypes/` are excluded from Vercel deploys via `.vercelignore`.
