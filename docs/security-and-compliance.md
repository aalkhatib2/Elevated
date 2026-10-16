# Security & compliance — what is in place, and what only the owners can do

Audit date: 2026-10-14. Covers the public site (`index.html`, `apply.html`),
the Rep Portal (`prototypes/portal/`), the API (`api/`), and the Discord and
monday.com jobs. **This is engineering work, not legal advice.** The legal
pages are drafts written from what the code and the business actually do;
have a Florida attorney review them before relying on them.

## Owner action items, most urgent first

These cannot be done from the code. Each is a real exposure until it is done.

1. **Make the Fiber Sales Google Sheet private.** It is shared "Anyone with
   the link → Viewer" (see `api/_lib/sheets.js`) and it holds customer names
   and every rep's commission. Production already authenticates with the
   service account, so the portal does not need link sharing any more.
   In the sheet: Share → General access → **Restricted**, then confirm the
   service account (the `GOOGLE_SERVICE_ACCOUNT_EMAIL` value) is listed as
   **Editor** (the Discord bot writes). Then load the portal Orders page to
   confirm it still reads.
2. **Run the sign-in throttle migration.** The address-based throttle in
   `api/_lib/auth.js` needs the `login_failures` table at the bottom of
   `scripts/schema.sql`. Until it exists, the throttle stays off (sign-in still
   works; the logs say why). Run that block once against the Neon database.
3. **Lawyer review** of `privacy.html`, `terms.html`, `disclosures.html`, and
   these open questions they deliberately do not answer:
   - Are reps independent contractors or employees? The site now avoids saying
     either. Pick one, document it, and make the pages match.
   - Earnings language on the landing page: "residual income" (Virtual High
     Ticket), "Make life-changing money" (core values), "Overrides, commission
     bonuses, and exclusive travel events". The disclosures page qualifies them;
     counsel should decide whether they stay. Florida's Sale of Business
     Opportunities Act and the FTC's earnings-claim guidance are the
     relevant frames.
   - Texting applicants. The form now records consent; whoever texts
     applicants must honour STOP and keep the consent emails.
   - Peptides. "Closing high-ticket peptide packages" is a regulated-product
     claim; make sure reps never make health claims.
4. **Fix site copy that no longer matches the business** (memory of
   2026-10-05: divisions are Fiber, Virtual High Ticket, Wireless):
   - DONE 2026-10-16: **Life Insurance** removed from the landing page and
     the apply form (it is no longer a division), along with the Equity
     Insurance Partners logo that backed it. Wireless is not on the site yet;
     it needs copy from the owner.
   - The Fiber card says "Fiber, solar, alarms, pest, autoglass"; the apply
     form says "Verizon fiber contracts", while the partner wall shows
     T-Mobile and the sales bot reads T-Mobile (`TMO…`) orders. Name only the
     carriers you are contracted to sell for.
   - The apply form calls the product "wellness solutions"; the landing page
     says "peptide packages". Use one honest description.
5. **Partner logos.** Get written permission (or follow published brand
   guidelines) for every logo on the partner wall. T-Mobile in particular
   restricts how dealers and agents use its marks. The footer now carries a
   no-endorsement notice, which helps but is not permission.
6. **Vercel secrets.** Vercel flags the Neon integration's variables
   (`DATABASE_URL`, `POSTGRES_PASSWORD`, `PGPASSWORD`, …) as *readable
   secrets*: anyone on the team can reveal them. Limit team access, and
   rotate the Neon password if anyone who has left could have read them.
   Preview deployments share the production database; keep Vercel
   Authentication on for previews.
7. **Web3Forms.** In its dashboard, restrict the form key to
   `joinelevated.net` and turn on its spam protection. The key in
   `apply.html` is public by design; the domain lock is what stops abuse.
8. **Add a mailing address** to the privacy page and footer once you have a
   business address you are willing to publish.
9. **Optional, recommended:** self-host the Oswald/Manrope fonts and GSAP so
   visitors' browsers stop contacting Google Fonts and jsDelivr (a known
   GDPR complaint pattern, and one less third party). Update the provider
   table in `privacy.html` and drop those hosts from the CSP when done.

## What the code now does

### Response headers (`vercel.json`, generated)
- A **Content-Security-Policy per page**. Scripts may come only from this
  site, jsDelivr, or an inline block whose SHA-256 is pinned; no
  `unsafe-inline` or `eval` for scripts. Pages cannot be framed
  (clickjacking), cannot load plugins, and can only post forms to this site.
  The apply page alone may call `api.web3forms.com`.
- `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
  `Cross-Origin-Opener-Policy`, and a `Permissions-Policy` denying camera,
  mic, location, payment, USB and topics, on every response.
- API responses: `Cache-Control: no-store` (they were `public` before) and
  `noindex`. Portal pages: `noindex` header and meta tag.
- Images and fonts cache for 30 days; HTML and JS still revalidate per visit.

**Editing an inline `<script>` changes its hash.** Run
`node scripts/build-headers.mjs` (or `npm run headers`) after any page edit;
`npm test` fails until you do, which stops a stale hash from silently
disabling a script in production. `node scripts/dev-server.mjs` applies the
same headers locally, so CSP problems show up before deploy.

### Third-party scripts
Every GSAP file loaded from jsDelivr carries a Subresource Integrity hash, so
a tampered CDN file is refused instead of run. A test enforces this for every
page.

### API (`api/`)
- **CSRF:** every state-changing endpoint (login, logout, change-password,
  reps, close-week) refuses cross-origin browser requests
  (`api/_lib/http.js`), on top of the `SameSite=Lax` cookie.
- **Sign-in:** input types and lengths are checked; an unknown username now
  costs the same password hash as a wrong password, so timing no longer
  reveals which usernames exist; failed sign-ins are capped per address
  (20 per 15 minutes, needs migration 2 above) alongside the existing
  per-account lock.
- **Issued passwords:** a rep still on an owner-issued password can no longer
  pull orders, team, payroll or reps data through the API. They must set
  their own first. This was only enforced by the page before.
- **Cron endpoints:** secret comparison is constant-time for both jobs.
- **Payroll CSV:** text that starts like a spreadsheet formula (`=`, `+`,
  `-`, `@`) is defused, so a client name typed into the sheet cannot run
  as a formula on the owner's machine. Negative chargeback amounts stay
  numbers.
- **Discord bot:** screenshots are fetched only from Discord's CDN, with no
  redirects, a 10 MB cap and a timeout; a bad image sends that post to
  review instead of failing the whole run, which would otherwise retry it
  forever. Log cells written to the sheet are formula-safe.

### Legal & consent
- New `privacy.html`, `terms.html`, `disclosures.html`, linked from every
  public page's footer, the apply form and the portal sign-in.
- The apply form requires an explicit, unticked-by-default consent checkbox
  for calls, texts and email before the final button unlocks. The
  submission records that consent and when it was given.
- The apply confirmation no longer claims "You are booked" and "a calendar
  invite is on its way", or shows the same fake application number
  (EL-2026-0871) to everyone. It now says what actually happens.
- Footer notices: independent company, no earnings guarantee, partner marks
  belong to their owners and imply no endorsement.

### Search & housekeeping
- Canonical and social URLs point at `www.joinelevated.net`, where the apex
  domain redirects (they pointed at the redirecting apex).
- `robots.txt`, `sitemap.xml`, and `/.well-known/security.txt` added.
- No longer deployed: the test suite (it was publicly downloadable),
  `partner-palmetto-energy.png` (publicly served despite the decision to keep
  Palmetto off the site), and unused images and backups.

## Known, accepted limits
- Sessions are stateless signed cookies: signing out clears the cookie in that
  browser but does not revoke a copied cookie before its 14-day expiry. A
  password change or reset does revoke every session.
- Five wrong passwords lock an account for 15 minutes, which also means
  someone can deliberately lock a known username. The owner can unlock reps
  from the Reps page.
- The leaderboard shows every active rep's install count to every rep. That is
  a product choice, not a leak; mention it in onboarding.
- `npm audit` reported 0 vulnerabilities in production dependencies on
  2026-10-14.
