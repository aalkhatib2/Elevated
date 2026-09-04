-- Elevated portal — reps table.
--
-- full_name is the join key against the spreadsheet's free-typed "Sales Rep"
-- column, so it's the system's main data-quality risk: seed it with the exact
-- spelling used in the sheet, and apply a Data Validation dropdown to the
-- sheet's Sales Rep column (bound to this same list) so future entries can't
-- drift. gen_random_uuid() is built into Postgres 13+ directly — no extension
-- needed on Neon.

create table if not exists reps (
  id            uuid primary key default gen_random_uuid(),
  full_name     text not null unique,
  username      text not null unique, -- the login identifier; first initial + lastname
  email         text unique, -- not collected yet, not required for login
  password_hash text not null,
  rep_code      text unique, -- display-only (sidebar), not used for login — fine to leave blank
  team          text not null default 'Elevated',
  division      text not null default 'Fiber',
  market        text,
  role          text not null default 'rep',
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);
