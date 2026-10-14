-- Sponsor pipeline ("Pitching Machine"): prospects and their notes/history,
-- scoped to an event year. Links to contacts, transactions, and in-kind
-- donations once a sponsor commits and delivers.
-- Run in the Supabase SQL editor after 001–004. Safe to run more than once.

create table if not exists public.sponsor_prospects (
  id uuid primary key default gen_random_uuid(),
  event_year_id uuid not null references public.event_years (id) on delete restrict,
  name text not null,
  category text not null default 'Other' check (category in (
    'Rum', 'Vodka', 'Whiskey', 'Other spirits', 'Local distillery', 'Distributor',
    'Beer, cider & mead', 'Seltzer & RTD', 'Water & NA', 'Mixers & serveware', 'Other')),
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  status text not null default 'research' check (status in (
    'research', 'to_contact', 'contacted', 'talks', 'committed', 'received',
    'declined', 'parked', 'dnp')),
  tier text check (tier in ('Admiral', 'Captain', 'Quartermaster', 'Crew')),
  -- Free-text contact details while it's still a prospect; link a real
  -- contact (type 'donor') once there is one.
  contact_id uuid references public.contacts (id) on delete set null,
  contact_name text,
  contact_title text,
  email text,
  phone text,
  website text,
  ask text,
  cash_committed numeric(12,2) check (cash_committed is null or cash_committed >= 0),
  cases_committed int check (cases_committed is null or cases_committed >= 0),
  next_step text,
  follow_up date,
  owner_id uuid references public.profiles (id) on delete set null,
  -- Set when the money or product actually arrives.
  transaction_id uuid references public.transactions (id) on delete set null,
  in_kind_donation_id uuid references public.in_kind_donations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references public.profiles (id) on delete set null
);
create index if not exists sponsor_prospects_year_status on public.sponsor_prospects (event_year_id, status);
create index if not exists sponsor_prospects_year_follow_up on public.sponsor_prospects (event_year_id, follow_up);

create table if not exists public.sponsor_activity (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.sponsor_prospects (id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'status')),
  body text not null,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  -- For rows with no crew author (seeded research notes).
  author_label text,
  created_at timestamptz not null default now()
);
create index if not exists sponsor_activity_prospect_created on public.sponsor_activity (prospect_id, created_at desc);

-- Stamp who edited a prospect and when, on every edit.
create or replace function public.sponsor_prospects_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end
$$;

drop trigger if exists sponsor_prospects_touch on public.sponsor_prospects;
create trigger sponsor_prospects_touch
  before update on public.sponsor_prospects
  for each row execute function public.sponsor_prospects_touch();

create or replace function public.sponsor_status_label(s text)
returns text
language sql immutable
as $$
  select case s
    when 'research' then 'Research' when 'to_contact' then 'To contact'
    when 'contacted' then 'Contacted' when 'talks' then 'In talks'
    when 'committed' then 'Committed' when 'received' then 'Received'
    when 'declined' then 'Declined' when 'parked' then 'Parked'
    when 'dnp' then 'Do not pitch' else s end
$$;

-- Log stage changes automatically so the history is complete no matter
-- which screen (or the SQL editor) changed the status. Clients must not log
-- stage changes themselves.
create or replace function public.log_sponsor_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into sponsor_activity (prospect_id, kind, body, created_by)
    values (new.id, 'status', 'Added at stage: ' || sponsor_status_label(new.status), auth.uid());
  elsif new.status is distinct from old.status then
    insert into sponsor_activity (prospect_id, kind, body, created_by)
    values (new.id, 'status', 'Stage: ' || sponsor_status_label(old.status) || ' → ' || sponsor_status_label(new.status), auth.uid());
  end if;
  return new;
end
$$;

drop trigger if exists sponsor_prospects_status_log on public.sponsor_prospects;
create trigger sponsor_prospects_status_log
  after insert or update of status on public.sponsor_prospects
  for each row execute function public.log_sponsor_status();

-- RLS: same pattern as contacts — all crew read/create/edit, hard delete admin-only.
alter table public.sponsor_prospects enable row level security;
alter table public.sponsor_activity enable row level security;

drop policy if exists "sponsor_prospects read" on public.sponsor_prospects;
drop policy if exists "sponsor_prospects insert" on public.sponsor_prospects;
drop policy if exists "sponsor_prospects update" on public.sponsor_prospects;
drop policy if exists "sponsor_prospects delete" on public.sponsor_prospects;
create policy "sponsor_prospects read" on public.sponsor_prospects for select to authenticated using (true);
create policy "sponsor_prospects insert" on public.sponsor_prospects for insert to authenticated with check (true);
create policy "sponsor_prospects update" on public.sponsor_prospects for update to authenticated using (true);
create policy "sponsor_prospects delete" on public.sponsor_prospects for delete to authenticated using (public.is_admin());

-- Crew add notes under their own name only (stage lines come from the
-- trigger). Authors can fix or remove their own notes; admins can remove any.
drop policy if exists "sponsor_activity read" on public.sponsor_activity;
drop policy if exists "sponsor_activity insert" on public.sponsor_activity;
drop policy if exists "sponsor_activity update" on public.sponsor_activity;
drop policy if exists "sponsor_activity delete" on public.sponsor_activity;
create policy "sponsor_activity read" on public.sponsor_activity for select to authenticated using (true);
create policy "sponsor_activity insert" on public.sponsor_activity for insert to authenticated
  with check (kind = 'note' and created_by = auth.uid() and author_label is null);
create policy "sponsor_activity update" on public.sponsor_activity for update to authenticated
  using (kind = 'note' and created_by = auth.uid())
  with check (kind = 'note' and created_by = auth.uid() and author_label is null);
create policy "sponsor_activity delete" on public.sponsor_activity for delete to authenticated
  using ((kind = 'note' and created_by = auth.uid()) or public.is_admin());

-- Start a year's pipeline from another year's: copies every prospect with its
-- contact details and ask, resets the stage to Research (rows marked "do not
-- pitch" stay that way), and leaves out commitments, follow-ups and links to
-- money received. Notes and history stay with the old year.
create or replace function public.sponsor_copy_year(p_from uuid, p_to uuid)
returns int
language plpgsql security invoker set search_path = public
as $$
declare n int;
begin
  if exists (select 1 from sponsor_prospects where event_year_id = p_to) then
    raise exception 'That event year already has sponsor prospects.';
  end if;
  insert into sponsor_prospects (event_year_id, name, category, priority, status, tier,
    contact_id, contact_name, contact_title, email, phone, website, ask, owner_id)
  select p_to, name, category, priority,
         case when status = 'dnp' then 'dnp' else 'research' end,
         tier, contact_id, contact_name, contact_title, email, phone, website, ask, owner_id
  from sponsor_prospects where event_year_id = p_from;
  get diagnostics n = row_count;
  return n;
end
$$;
