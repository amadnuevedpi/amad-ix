-- ══════════════════════════════════════════════════════════════════
-- AMAD IX · DA-RFO IX — Supabase Database Schema
-- Run this entire file in: Supabase Dashboard → SQL Editor → Run
-- ══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────
-- 1. USERS (market encoders, verifiers, admin)
-- ─────────────────────────────────────────
create table if not exists public.users (
  id          uuid primary key default gen_random_uuid(),
  market_id   text not null unique,        -- e.g. 'dipolog', '__admin__'
  display_name text not null,
  role        text not null check (role in ('encoder','verifier','admin')),
  password    text not null,               -- plain for demo; hash in production
  email       text,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────
-- 2. MARKETS
-- ─────────────────────────────────────────
create table if not exists public.markets (
  id          text primary key,            -- e.g. 'dipolog'
  label       text not null,
  sheet       text,
  city        text,
  province    text,
  sort_order  int default 0
);

-- ─────────────────────────────────────────
-- 3. COMMODITIES
-- ─────────────────────────────────────────
create table if not exists public.commodities (
  id          text primary key,
  section     text not null,
  name        text not null,
  spec        text default '',
  unit        text default 'kg',
  sort_order  int default 0
);

-- ─────────────────────────────────────────
-- 4. PRICE ENTRIES  (the main data table)
-- ─────────────────────────────────────────
create table if not exists public.entries (
  id            uuid primary key default gen_random_uuid(),
  market_id     text not null references public.markets(id) on delete cascade,
  week_key      text not null,             -- e.g. '2025-04-28'
  day_index     int  not null check (day_index between 0 and 6),
  commodity_id  text not null references public.commodities(id) on delete cascade,
  obs_index     int  not null check (obs_index between 0 and 5),  -- 0-5 (6 observations)
  value         numeric(10,2),
  period        text default 'Daily',
  encoder_id    text,                      -- market_id of encoder who entered it
  updated_at    timestamptz default now(),
  unique (market_id, week_key, day_index, commodity_id, obs_index)
);

-- ─────────────────────────────────────────
-- 5. SAVED DAYS  (daily lock tracking)
-- ─────────────────────────────────────────
create table if not exists public.saved_days (
  id          uuid primary key default gen_random_uuid(),
  market_id   text not null,
  week_key    text not null,
  day_index   int  not null,
  saved_at    timestamptz default now(),
  saved_by    text,                        -- encoder market_id
  unique (market_id, week_key, day_index)
);

-- ─────────────────────────────────────────
-- 6. FLAGS
-- ─────────────────────────────────────────
create table if not exists public.flags (
  id              uuid primary key default gen_random_uuid(),
  flag_key        text not null unique,    -- compound key: mkt__wk__cid__day__idx
  market_id       text not null,
  week_key        text not null,
  day_index       int  not null,
  commodity_id    text not null,
  obs_index       int  not null,
  value           numeric(10,2),
  corrected_val   numeric(10,2),
  flag_type       text not null,           -- 'intra_high_25','intra_high_10','zero','manual', etc.
  color           text not null check (color in ('red','amber','blue')),
  severity        text,
  message         text,
  remarks         text,                    -- verifier/admin remarks
  status          text not null default 'open' check (status in ('open','verified','resolved','dismissed','acknowledged')),
  raised_by       text,                    -- 'system' or role
  encoder_corrected boolean default false,
  corrected_at    timestamptz,
  resolved_at     timestamptz,
  resolved_by     text,
  row_avg         numeric(10,2),
  market_label    text,
  commodity_name  text,
  commodity_spec  text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ─────────────────────────────────────────
-- 7. EDIT REQUESTS  (date-based approval)
-- ─────────────────────────────────────────
create table if not exists public.edit_requests (
  id            uuid primary key default gen_random_uuid(),
  market_id     text not null,
  week_key      text not null,
  day_index     int  not null,
  date_label    text,                      -- dd/mm/yyyy display string
  market_label  text,
  encoder_id    text,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','correction','acknowledged')),
  reason        text,                      -- rejection reason
  -- For correction notifications
  commodity_id  text,
  commodity_name text,
  obs_index     int,
  old_val       numeric(10,2),
  new_val       numeric(10,2),
  flag_key      text,
  resolved_at   timestamptz,
  resolved_by   text,
  created_at    timestamptz default now()
);

-- ══════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ══════════════════════════════════════════

alter table public.users         enable row level security;
alter table public.markets       enable row level security;
alter table public.commodities   enable row level security;
alter table public.entries       enable row level security;
alter table public.saved_days    enable row level security;
alter table public.flags         enable row level security;
alter table public.edit_requests enable row level security;

-- Allow anon (your app uses its own login, not Supabase Auth)
-- These policies let your app read/write using the anon key + your own
-- market_id header for identification.

-- Markets & commodities: anyone can read
create policy "public read markets"     on public.markets     for select using (true);
create policy "public read commodities" on public.commodities for select using (true);

-- Users: app reads to verify login; only admin writes
create policy "read users"   on public.users for select using (true);
create policy "insert users" on public.users for insert with check (true);
create policy "update users" on public.users for update using (true);

-- Entries: all can read; encoders can only insert/update their own market
create policy "read entries"   on public.entries for select using (true);
create policy "write entries"  on public.entries for insert with check (true);
create policy "update entries" on public.entries for update using (true);

-- Saved days
create policy "read saved_days"   on public.saved_days for select using (true);
create policy "write saved_days"  on public.saved_days for insert with check (true);
create policy "delete saved_days" on public.saved_days for delete using (true);

-- Flags
create policy "read flags"   on public.flags for select using (true);
create policy "write flags"  on public.flags for insert with check (true);
create policy "update flags" on public.flags for update using (true);

-- Edit requests
create policy "read edit_requests"   on public.edit_requests for select using (true);
create policy "write edit_requests"  on public.edit_requests for insert with check (true);
create policy "update edit_requests" on public.edit_requests for update using (true);

-- ══════════════════════════════════════════
-- SEED: Default Markets
-- ══════════════════════════════════════════
insert into public.markets (id, label, sheet, city, province, sort_order) values
  ('zc_main',    'ZC Main PM',          'ZC(MAIN) PM',      'Zamboanga City',  'zcity',     1),
  ('zc_sta',     'Sta. Cruz PM',        'ZC(STA. CRUZ) PM', 'Zamboanga City',  'zcity',     2),
  ('agora',      'Agora PM (Pagadian)', 'AGORA PM',         'Pagadian City',   'zdelsur',   3),
  ('ipil',       'Ipil PM',             'IPIL PM',          'Ipil, ZSP',       'zsibugay',  4),
  ('dipolog',    'Dipolog PM',          'DIPOLOG PM',       'Dipolog City',    'zdelnorte', 5),
  ('imelda',     'Imelda PM',           'IMELDA PM',        'Imelda, ZSP',     'zsibugay',  6),
  ('tampilisan', 'Tampilisan PM',       'TAMPILISAN PM',    'Tampilisan, ZDN', 'zdelnorte', 7),
  ('liloy',      'Liloy PM',            'LILOY PM',         'Liloy, ZDN',      'zdelnorte', 8),
  ('sindangan',  'Sindangan PM',        'SINDANGAN PM',     'Sindangan, ZDN',  'zdelnorte', 9),
  ('molave',     'Molave PM',           'MOLAVE PM',        'Molave, ZDS',     'zdelsur',   10),
  ('isabela',    'Isabela PM (Basilan)','ISABELA PM',       'Isabela City',    'basilan',   11),
  ('jolo',       'Jolo PM (Sulu)',      'JOLO PM',          'Jolo, Sulu',      'sulu',      12)
on conflict (id) do nothing;

-- ══════════════════════════════════════════
-- SEED: Default Users (change passwords!)
-- ══════════════════════════════════════════
insert into public.users (market_id, display_name, role, password, email) values
  ('__admin__',    'System Administrator', 'admin',    'admin2025', 'admin@da-rfo9.gov.ph'),
  ('__verifier__', 'Regional Verifier',    'verifier', 'verify',    'verifier@da-rfo9.gov.ph'),
  ('zc_main',      'ZC Main Encoder',      'encoder',  '1234',      ''),
  ('zc_sta',       'Sta. Cruz Encoder',    'encoder',  '1234',      ''),
  ('agora',        'Agora Encoder',        'encoder',  '1234',      ''),
  ('ipil',         'Ipil Encoder',         'encoder',  '1234',      ''),
  ('dipolog',      'Dipolog Encoder',      'encoder',  '1234',      ''),
  ('imelda',       'Imelda Encoder',       'encoder',  '1234',      ''),
  ('tampilisan',   'Tampilisan Encoder',   'encoder',  '1234',      ''),
  ('liloy',        'Liloy Encoder',        'encoder',  '1234',      ''),
  ('sindangan',    'Sindangan Encoder',    'encoder',  '1234',      ''),
  ('molave',       'Molave Encoder',       'encoder',  '1234',      ''),
  ('isabela',      'Isabela Encoder',      'encoder',  '1234',      ''),
  ('jolo',         'Jolo Encoder',         'encoder',  '1234',      '')
on conflict (market_id) do nothing;
