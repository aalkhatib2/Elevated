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
  -- Who recruited this rep, for the My Team downline/leaderboard. Nullable —
  -- most rows will have no recruiter (root of the org, or not tracked yet).
  -- set null on delete: losing the recruiter's own row should orphan their
  -- downline, not cascade-delete real people's accounts.
  recruited_by  uuid references reps(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

alter table reps add column if not exists recruited_by uuid references reps(id) on delete set null;

-- Weekly payroll. A row in pay_periods means that Mon–Sun week is CLOSED: its
-- payroll_lines are a frozen snapshot of what was paid, at the rates in force
-- then, so later RATES or sheet edits can't rewrite history. Open weeks are
-- computed live from the sheet and have no rows here.
create table if not exists pay_periods (
  period_start date primary key, -- the Monday
  period_end   date not null,
  closed_at    timestamptz not null default now(),
  closed_by    uuid references reps(id) on delete set null
);

create table if not exists payroll_lines (
  id             uuid primary key default gen_random_uuid(),
  period_start   date not null references pay_periods(period_start) on delete cascade,
  kind           text not null check (kind in ('order', 'chargeback', 'adjustment')),
  order_key      text not null,
  rep_id         uuid references reps(id) on delete set null,
  rep_name       text not null, -- as spelled in the sheet when it was paid
  order_id       text,
  client_name    text,
  gigs           integer,
  install_date   date,
  rep_commission numeric(10, 2),
  office_pay     numeric(10, 2),
  late           boolean not null default false,
  -- An order is paid once and clawed back once, no matter how often a week
  -- is recomputed or a close is retried.
  unique (order_key, kind)
);

create index if not exists payroll_lines_period_idx on payroll_lines (period_start);
